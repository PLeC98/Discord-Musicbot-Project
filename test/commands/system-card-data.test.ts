// src/discord/commands/system.ts의 cardDataOf: 대시보드와 같은 상태 값에서 /system 이미지에 그릴 값

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discord.js";
import { cardDataOf } from "../../src/discord/commands/system.ts";
import type { StatusCore } from "../../src/dashboard/status/index.ts";
import { fakeWith } from "../helpers/fake.ts";

const MB = 1024 * 1024;

function core(over: { loopP99?: number; loopSeries?: number[]; rtt?: number; heapUsed?: number; cpuModel?: string } = {}) {
  return {
    bot: { ping: 40, uptime: 3600 },
    node: { memory: { heapUsed: over.heapUsed ?? 50, heapTotal: 80, heapLimit: 1000, rss: 200 } },
    system: { cpus: 8, cpuModel: over.cpuModel ?? "Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz", uptime: 86_400 },
    cpu: { bot: 3, system: 20 },
    loop: { p99: over.loopP99 ?? 5, max: 9 },
    processes: { stray: [], strayMore: 0, ytdlp: { nearLimit: false } },
    youtube: { clients: [] },
    links: [],
    storage: { cache: { bytes: 2 * MB, maxBytes: 10 * MB }, disk: { drive: "C:", usedBytes: 95, totalBytes: 100, minFreeBytes: 0 } },
    recent: { warn: 1, error: 2, lines: [] },
    encoding: { maxDepth: 4, workers: [{ depth: 0, rttP99: over.rtt ?? 2 }] },
    history: { stepMs: 15_000, cpuBot: [1, 2, 3, 4], cpuSystem: [10, 20, 30, 40], loopP99: over.loopSeries ?? [3, 4, 5, 6], encodeRtt: [1, 2, 3, 70] },
  } as unknown as StatusCore;
}
const client = fakeWith<Client>()({
  guilds: {
    cache: Object.assign(
      new Map([
        ["g1", { memberCount: 5 }],
        ["g2", { memberCount: 7 }],
      ]),
      { reduce: (fn: (a: number, g: { memberCount: number }) => number, init: number) => [5, 7].reduce((a, n) => fn(a, { memberCount: n }), init) },
    ),
  },
});
const bot = { client, players: new Map() } as unknown as Parameters<typeof cardDataOf>[1];

test("값과 단계: heap 은 상한 대비, 디스크 95% 는 주의, 주의 항목 수, 서버와 사용자 수, 바이트 단위", () => {
  const d = cardDataOf(core(), bot);
  assert.deepEqual(d.heap, { used: 50 * MB, limit: 1000 * MB, rss: 200 * MB, percent: 5, level: "ok" });
  assert.equal(d.disk.level, "warn");
  assert.deepEqual(d.overall, { level: "warn", count: 1 });
  assert.deepEqual(d.recent, { warn: 1, error: 2 });
  assert.deepEqual(d.overview, { guilds: 2, playing: 0, users: 12 });
  assert.deepEqual(d.uptime, { bot: 3600, os: 86_400 });
});

test("CPU 모델은 상표 기호와 뒤쪽 클럭 표기를 뺀다", () => {
  assert.equal(cardDataOf(core(), bot).cpu.model, "Intel Core i7-8700");
  assert.equal(cardDataOf(core({ cpuModel: "AMD Ryzen 7 5800X 8-Core Processor" }), bot).cpu.model, "AMD Ryzen 7 5800X 8-Core Processor");
});

test("그래프: 기록 구간(분), 세로축은 대시보드와 같은 하한과 최댓값 중 큰 쪽, 현재 값", () => {
  const d = cardDataOf(core({ loopSeries: [3, 150], loopP99: 150, rtt: 9 }), bot);
  assert.equal(d.history.minutes, 1);
  assert.equal(d.history.cpuBot.max, 100);
  assert.equal(d.history.loop.max, 150, "최댓값이 하한(100ms)보다 크면 최댓값");
  assert.equal(d.history.loop.level, "bad");
  assert.equal(d.history.encoding.max, 70, "응답 예산(3 × 20ms)보다 큰 최댓값");
  assert.equal(d.history.encoding.now, 9);
  assert.equal(cardDataOf(core(), bot).history.loop.max, 100);
});
