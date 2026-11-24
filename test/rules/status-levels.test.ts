// src/rules/status-levels.ts: 봇 상태 판정(기준과 단계, 주의 항목의 종류와 순서, 전체 단계와 개수). 대시보드와 /system이 같은 기준으로 판정하는 근거
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, attentionOf, clientLevel, diskLevel, encodingLevel, heapPercent, levelOf, linkLevel, metricLevels, overallOf, statusInputOf, type StatusInput } from "../../src/rules/status-levels.ts";

/** 모두 괜찮은 입력. 바꿀 것만 덮어 쓴다 */
const calm = (over: Partial<StatusInput> = {}): StatusInput => ({
  ping: 190,
  loopP99: 3,
  encoding: { maxDepth: 4, workers: [{ depth: 2, rttP99: 5 }] },
  cpuBot: 3,
  heap: { heapUsed: 100, heapLimit: 4000 },
  links: [{ id: "discord", group: "play", state: "ok" }],
  clients: [{ name: "web_safari", excluded: false, tried: 10, failed: 0, needsPot: false, known: true }],
  disk: { drive: "F:", usedBytes: 50, totalBytes: 100 },
  stray: [],
  strayMore: 0,
  extractionsNearLimit: false,
  ...over,
});

test("기준값: 주의 기준 이상이면 주의, 문제 기준 이상이면 문제(기준과 같으면 그 단계)", () => {
  assert.deepEqual([levelOf(69.9, ...LIMITS.cpu), levelOf(70, ...LIMITS.cpu), levelOf(90, ...LIMITS.cpu)], ["ok", "warn", "bad"]);
  assert.deepEqual([levelOf(299, ...LIMITS.ping), levelOf(300, ...LIMITS.ping), levelOf(800, ...LIMITS.ping)], ["ok", "warn", "bad"]);
});

test("heap 사용률은 V8 상한을 기준으로 잰다", () => {
  assert.equal(heapPercent({ heapUsed: 40, heapLimit: 4000 }), 1);
  assert.equal(metricLevels(calm({ heap: { heapUsed: 3400, heapLimit: 4000 } })).heap, "warn");
});

test("인코딩: 큐 깊이를 상한까지 올린 워커만 보며, 응답 시간이 한도((깊이 − 1) 프레임)의 80%를 넘으면 주의, 한도를 넘으면 문제", () => {
  // 상한 4 → 한도 60ms, 주의 48ms
  assert.equal(encodingLevel({ maxDepth: 4, workers: [{ depth: 3, rttP99: 200 }] }), "ok", "상한 아래 워커는 늦어도 깊이를 올릴 여유가 있다");
  assert.equal(encodingLevel({ maxDepth: 4, workers: [{ depth: 4, rttP99: 48 }] }), "warn");
  assert.equal(encodingLevel({ maxDepth: 4, workers: [{ depth: 4, rttP99: 60 }] }), "bad");
  assert.equal(encodingLevel({ maxDepth: 4, workers: [] }), "ok");
});

test("연결: 재생에 꼭 필요한 묶음의 실패는 문제, 자동재생 실패와 느림은 주의", () => {
  assert.deepEqual([linkLevel("fail", true), linkLevel("fail", false), linkLevel("slow", true), linkLevel("idle", true), linkLevel("off", true)], ["bad", "warn", "warn", "ok", "ok"]);
});

test("유튜브 클라이언트: 실행 중 제외됐으면 주의, 아니면 실패율 10% 이상 주의, 50% 이상 문제, 시도 없으면 정상", () => {
  assert.equal(clientLevel({ excluded: true, tried: 0, failed: 0 }), "warn");
  assert.deepEqual([clientLevel({ excluded: false, tried: 10, failed: 1 }), clientLevel({ excluded: false, tried: 10, failed: 5 }), clientLevel({ excluded: false, tried: 0, failed: 0 })], ["warn", "bad", "ok"]);
});

test("디스크: 사용률 90% 이상 주의, 98% 이상 문제", () => {
  assert.deepEqual([diskLevel({ drive: "/", usedBytes: 89, totalBytes: 100 }), diskLevel({ drive: "/", usedBytes: 90, totalBytes: 100 }), diskLevel({ drive: "/", usedBytes: 98, totalBytes: 100 })], ["ok", "warn", "bad"]);
});

test("주의 항목 순서: 지표, 연결(재생, 유튜브, 자동재생 묶음 순), 유튜브 클라이언트, 디스크, 남은 프로세스, 추출 한도", () => {
  const items = attentionOf(
    calm({
      ping: 350,
      cpuBot: 95,
      links: [
        { id: "vocadb", group: "autoplay", state: "fail" },
        { id: "spotify", group: "play", state: "slow" },
        { id: "potoken", group: "youtube", state: "fail" },
      ],
      clients: [{ name: "tv", excluded: true, tried: 0, failed: 0, needsPot: false, known: true }],
      disk: { drive: "F:", usedBytes: 95, totalBytes: 100 },
      stray: [{ pid: 21377, label: "ffmpeg" }],
      strayMore: 3,
      extractionsNearLimit: true,
    }),
  );
  assert.deepEqual(
    items.map((a) => [a.kind, a.level, "metric" in a ? a.metric : "id" in a ? a.id : "name" in a ? a.name : "drive" in a ? a.drive : ""]),
    [
      ["metric", "warn", "ping"],
      ["metric", "bad", "cpu"],
      ["link", "warn", "spotify"],
      ["link", "bad", "potoken"],
      ["link", "warn", "vocadb"],
      ["client", "warn", "tv"],
      ["disk", "warn", "F:"],
      ["stray", "warn", ""],
      ["strayMore", "warn", ""],
      ["extractions", "warn", ""],
    ],
  );
  assert.deepEqual(overallOf(items), { level: "bad", count: 9 + 3 }, "묶어 보인 남은 프로세스는 실제 수만큼 센다");
});

test("전체: 항목이 없으면 정상 0개, 주의만 있으면 주의", () => {
  assert.deepEqual(overallOf(attentionOf(calm())), { level: "ok", count: 0 });
  assert.deepEqual(overallOf(attentionOf(calm({ loopP99: 60 }))), { level: "warn", count: 1 });
});

test("상태 응답에서 판정에 쓰는 값을 꺼낸다", () => {
  const input = statusInputOf({
    bot: { ping: 41 },
    loop: { p99: 2.5 },
    encoding: { maxDepth: 8, workers: [] },
    cpu: { bot: 3, system: 20 },
    node: { memory: { heapUsed: 50, heapLimit: 4000 } },
    links: [],
    youtube: { clients: [] },
    storage: { disk: { drive: "/", usedBytes: 1, totalBytes: 2, minFreeBytes: 0 } },
    processes: { stray: [], strayMore: 0, ytdlp: { nearLimit: false } },
  } as unknown as Parameters<typeof statusInputOf>[0]);
  assert.deepEqual([input.ping, input.loopP99, input.cpuBot, input.heap.heapLimit, input.disk.drive, input.extractionsNearLimit], [41, 2.5, 3, 4000, "/", false]);
});
