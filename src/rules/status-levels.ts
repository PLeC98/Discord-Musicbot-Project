// 봇 상태의 판정: 값별 주의, 문제 기준과 단계, 주의 항목 목록, 전체 단계. 대시보드 봇 상태 탭과 /system이 함께 쓴다(화면도 쓰므로 Node 모듈을 부르지 않는다)
// 이름과 말은 쓰는 쪽 문구표가 붙인다. 항목 순서는 화면의 칩 순서와 같다

import type { AdminStatus, LinkRow, LinkState, ProcessRow } from "../dashboard/contract/admin.ts";
import type { ClientStatus } from "../sources/youtube/status-types.ts";

type Level = "ok" | "warn" | "bad";

/** 기준(주의, 문제). 핑 ms, 루프 지연 ms, heap %, 봇 CPU %, 디스크 % */
// 핑(게이트웨이, 음성 게이트웨이의 하트비트 왕복): 거리로 정해지는 값이라(한국에서 게이트웨이는 190ms 안팎) 통화 지연 기준 ITU-T G.114의
// 편도 150ms(대부분 지장 없음), 400ms(받아들이기 어려움)를 왕복으로 바꾼 값. 평소 값과 비교하지 않아 하루 내내 나쁜 날도 드러난다
const LIMITS = { ping: [300, 800], loop: [50, 100], heap: [80, 95], cpu: [70, 90], disk: [90, 98] } as const;

const levelOf = (v: number, warn: number, bad: number): Level => (v >= bad ? "bad" : v >= warn ? "warn" : "ok");

/** heap 사용률(%): V8 상한 대비(heapTotal은 지금 잡아 둔 크기라 늘 사용량 가까이 붙어 있다) */
const heapPercent = (memory: { heapUsed: number; heapLimit: number }) => (memory.heapUsed / memory.heapLimit) * 100;

/** 한 프레임(ms). 인코딩 워커의 응답 시간 한도는 (큐 깊이 − 1) × FRAME_MS */
const FRAME_MS = 20;
type Encoding = { maxDepth: number; workers: Array<{ depth: number; rttP99: number }> };
/** 큐 깊이를 상한까지 올린 워커의 응답 시간이 한도의 80%를 넘으면 주의, 한도를 넘으면 문제(누락 프레임) */
function encodingLevel(e: Encoding): Level {
  const budget = (e.maxDepth - 1) * FRAME_MS;
  const worstAtMax = Math.max(0, ...e.workers.filter((w) => w.depth >= e.maxDepth).map((w) => w.rttP99));
  return levelOf(worstAtMax, budget * 0.8, budget);
}

/** 연결 묶음의 순서와 재생에 꼭 필요한지 여부(critical이면 실패가 문제, 아니면 주의) */
const LINK_GROUPS = [
  { group: "play", critical: true },
  { group: "youtube", critical: true },
  { group: "autoplay", critical: false },
] as const satisfies ReadonlyArray<{ group: LinkRow["group"]; critical: boolean }>;
const linkLevel = (state: LinkState, critical: boolean): Level => (state === "fail" ? (critical ? "bad" : "warn") : state === "slow" ? "warn" : "ok");

/** 유튜브 클라이언트: 실행 중 제외됐으면 주의, 아니면 실패율 10% 이상 주의, 50% 이상 문제 */
const clientLevel = (c: Pick<ClientStatus, "excluded" | "tried" | "failed">): Level => (c.excluded ? "warn" : levelOf(c.tried ? c.failed / c.tried : 0, 0.1, 0.5));

/** 판정에 쓰는 값(상태 응답의 일부) */
type StatusInput = {
  ping: number;
  loopP99: number;
  encoding: Encoding;
  cpuBot: number;
  heap: { heapUsed: number; heapLimit: number };
  links: Array<Pick<LinkRow, "id" | "group" | "state">>;
  clients: ClientStatus[];
  disk: { drive: string; usedBytes: number; totalBytes: number };
  stray: Array<Pick<ProcessRow, "pid" | "label">>;
  strayMore: number;
  extractionsNearLimit: boolean;
};

/** 상태 응답에서 판정에 쓰는 값만 꺼낸다 */
function statusInputOf(s: Pick<AdminStatus, "bot" | "loop" | "encoding" | "cpu" | "node" | "links" | "youtube" | "storage" | "processes">): StatusInput {
  return {
    ping: s.bot.ping,
    loopP99: s.loop.p99,
    encoding: s.encoding,
    cpuBot: s.cpu.bot,
    heap: s.node.memory,
    links: s.links,
    clients: s.youtube.clients,
    disk: s.storage.disk,
    stray: s.processes.stray,
    strayMore: s.processes.strayMore,
    extractionsNearLimit: s.processes.ytdlp.nearLimit,
  };
}

type Metric = "ping" | "loop" | "encoding" | "cpu" | "heap";
/** 주의 항목 하나. count: 이 항목에 묶인 수(칩으로 따로 보이지 않은 남은 프로세스), 없으면 1 */
type Attention = { level: Exclude<Level, "ok">; count?: number } & ({ kind: "metric"; metric: Metric } | { kind: "link"; id: string; state: LinkState } | { kind: "client"; name: string; excluded: boolean } | { kind: "disk"; drive: string } | { kind: "stray"; label: string; pid: number } | { kind: "strayMore" } | { kind: "extractions" });

/** 지표별 단계(화면 지표 카드 순서) */
function metricLevels(s: StatusInput): Record<Metric, Level> {
  return {
    ping: levelOf(s.ping, ...LIMITS.ping),
    loop: levelOf(s.loopP99, ...LIMITS.loop),
    encoding: encodingLevel(s.encoding),
    cpu: levelOf(s.cpuBot, ...LIMITS.cpu),
    heap: levelOf(heapPercent(s.heap), ...LIMITS.heap),
  };
}

const diskLevel = (disk: StatusInput["disk"]) => levelOf((disk.usedBytes / disk.totalBytes) * 100, ...LIMITS.disk);

/** 주의, 문제 단계인 항목(지표, 연결, 유튜브 클라이언트, 디스크, 남은 프로세스, 추출 한도 순) */
function attentionOf(s: StatusInput): Attention[] {
  const out: Attention[] = [];
  for (const [metric, level] of Object.entries(metricLevels(s)) as Array<[Metric, Level]>) if (level !== "ok") out.push({ kind: "metric", metric, level });
  for (const { group, critical } of LINK_GROUPS) {
    for (const link of s.links.filter((l) => l.group === group)) {
      const level = linkLevel(link.state, critical);
      if (level !== "ok") out.push({ kind: "link", id: link.id, state: link.state, level });
    }
  }
  for (const c of s.clients) {
    const level = clientLevel(c);
    if (level !== "ok") out.push({ kind: "client", name: c.name, excluded: c.excluded, level });
  }
  const disk = diskLevel(s.disk);
  if (disk !== "ok") out.push({ kind: "disk", drive: s.disk.drive, level: disk });
  for (const p of s.stray) out.push({ kind: "stray", label: p.label, pid: p.pid, level: "warn" });
  if (s.strayMore) out.push({ kind: "strayMore", count: s.strayMore, level: "warn" });
  if (s.extractionsNearLimit) out.push({ kind: "extractions", level: "warn" });
  return out;
}

/** 전체: 가장 심각한 단계와 항목 수(묶어 보인 남은 프로세스는 실제 수만큼 센다) */
function overallOf(items: Attention[]): { level: Level; count: number } {
  const level: Level = items.some((a) => a.level === "bad") ? "bad" : items.length ? "warn" : "ok";
  return { level, count: items.reduce((n, a) => n + (a.count ?? 1), 0) };
}

export { LIMITS, FRAME_MS, LINK_GROUPS, levelOf, heapPercent, encodingLevel, linkLevel, clientLevel, metricLevels, diskLevel, statusInputOf, attentionOf, overallOf };
export type { Level, StatusInput, Attention, Metric };
