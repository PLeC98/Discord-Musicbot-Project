// src/infra/vitals.ts · version.ts — 봇 상태 탭의 측정: CPU 사용률 · 이벤트 루프 지연(15초 칸) · heap 한도, 돌고 있는 버전

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { _tick, onWindow, startVitals, stopVitals, vitals, type Window } from "../../src/infra/vitals.ts";
import { BOT_VERSION } from "../../src/infra/version.ts";

afterEach(stopVitals);

const busy = (ms: number) => {
  const until = performance.now() + ms;
  while (performance.now() < until);
};

test("다섯 번 잴 때마다 15초 칸을 닫고 알린다: 그 칸의 CPU 평균 · 루프 지연 p99 와 최대", async () => {
  startVitals();
  const windows: Window[] = [];
  onWindow((window) => windows.push(window));

  for (let i = 0; i < 4; i++) {
    busy(60); // 루프를 막아 지연을 만든다
    await nextTurn();
    _tick();
  }
  assert.equal(windows.length, 0, "아직 칸이 열려 있다");
  _tick();
  assert.equal(windows.length, 1);

  const [{ cpu, loop }] = windows;
  assert.ok(loop.max >= 40, `루프 최대 ${loop.max}ms`);
  assert.ok(loop.p99 > 0 && loop.p99 <= loop.max);
  assert.ok(cpu.bot > 0 && cpu.bot <= 100, `봇 CPU ${cpu.bot}`);
  assert.ok(cpu.system >= 0 && cpu.system <= 100);
  assert.deepEqual(vitals().loop, loop, "지금 값의 루프 지연은 닫은 칸");
});

test("heap 한도는 MB, 측정을 켜기 전에는 0", () => {
  const now = vitals();
  assert.ok(now.heapLimit > 100, `heap 한도 ${now.heapLimit}MB`);
  assert.deepEqual(now.cpu, { bot: 0, system: 0 });
});

test("버전: package.json 의 version, git 체크아웃이면 지금 커밋의 앞 7자리", () => {
  const root = path.join(import.meta.dirname, "..", "..");
  const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
  let commit: string | null = null;
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim().slice(0, 7);
  } catch {
    // git 이 없으면 버전만 본다
  }
  assert.equal(BOT_VERSION, commit ? `${version} (${commit})` : version);
});
