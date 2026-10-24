// 봇 상태 탭의 자식 프로세스(ffmpeg · yt-dlp · 헬퍼): 어느 서버의 무슨 일인지와 메모리.
// 메모리는 프로그램을 실행해 읽으므로 15초 구간마다 한 번 재 둔다

import type { Client } from "discord.js";
import * as procRegistry from "../../infra/process-registry.ts";
import { ytdlpLoad } from "../../sources/ytdlp-spawn.ts";
import { reuseLoad } from "../../sources/youtube/recent-info.ts";
import { processMemory } from "../../infra/process-memory.ts";
import { onWindow } from "../../infra/vitals.ts";
import type { AdminStatus, ProcessRow } from "../contract/admin.ts";

let memory = new Map<number, number>();
let measuring = false;

async function measure() {
  if (measuring) return;
  measuring = true;
  try {
    // 못 읽었으면 지난 값을 둔다(그사이 끝난 pid 의 값은 목록에 나오지 않는다)
    memory = (await processMemory(procRegistry.list().map((p) => p.pid))) ?? memory;
  } finally {
    measuring = false;
  }
}

/** 구간마다 메모리를 잰다. 끊는 함수를 돌려준다 */
function watchProcesses() {
  return onWindow(() => void measure());
}

// 재생 · 다음 곡 일인데 그 서버에 플레이어가 없으면 남은 것일 수 있다
const STRAY_JOBS = new Set(["play", "prefetch"]);

/** 오래된 것부터 전부. byLabel 은 프로그램마다의 수, ytdlp 는 yt-dlp 줄과 추출 수 */
function processSummary(client: Client, players: { has(guildId: string): boolean }): AdminStatus["processes"] {
  const all = procRegistry.list();
  const oldest: ProcessRow[] = all.map((p) => ({
    pid: p.pid,
    label: p.program,
    ageMs: p.ageMs,
    memMb: memory.get(p.pid) ?? null,
    guildId: p.guildId,
    guildName: (p.guildId && client.guilds.cache.get(p.guildId)?.name) || null,
    job: p.job,
    stray: Boolean(p.guildId && p.job && STRAY_JOBS.has(p.job) && !players.has(p.guildId)),
  }));
  const byLabel = new Map<string, number>();
  for (const p of oldest) byLabel.set(p.label, (byLabel.get(p.label) ?? 0) + 1);
  return {
    total: oldest.length,
    byLabel: [...byLabel].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    oldest,
    ytdlp: { ...ytdlpLoad(), ...reuseLoad() },
  };
}

/** 테스트: 잰 값을 바로 채운다 */
const _measure = measure;

export { watchProcesses, processSummary, _measure };
