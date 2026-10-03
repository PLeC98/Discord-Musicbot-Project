// src/app/run-record.ts — 직전 실행이 어떻게 끝났는지를 다음 기동이 안다. 짧게 끊긴 실행이 연달아면 세션을 되살리지 않는다.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RunRecord, SHORT_RUN_MS } from "../../src/app/run-record.ts";

const MIN = 60_000;
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// 한 파일을 두고 기동 · 끝을 되풀이한다. clock 은 시험이 옮긴다
function machine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-record-"));
  dirs.push(dir);
  const file = path.join(dir, "run-state.json");
  const clock = { now: 1_000_000_000_000 };
  const boot = () => {
    const record = new RunRecord(file, () => clock.now);
    const previous = record.begin();
    if (record.timer) clearInterval(record.timer);
    return { record, previous };
  };
  // 돌다가 끝을 적지 못하고 끊겼다. 마지막으로 살아 있던 때를 적어 둔다
  const cutAfter = (record: RunRecord, ms: number) => {
    clock.now += ms;
    record._alive();
  };
  return { file, clock, boot, cutAfter };
}

test("처음 켜면 기록이 없다. 깨끗이 끝낸 뒤에는 끝난 방식과 가동 시간을 알린다", () => {
  const m = machine();
  const first = m.boot();
  assert.deepEqual(first.previous, { line: "직전 실행 기록 없음", shortStreak: 0, skipRestore: false });
  m.clock.now += 3 * 60 * MIN + 12 * MIN;
  first.record.end("shutdown");
  assert.equal(m.boot().previous.line, "직전 실행: 깨끗이 끝남 | 가동 3시간 12분");
});

test("끝을 적지 못하고 끊겼으면 마지막으로 살아 있던 때까지를 가동으로 본다", () => {
  const m = machine();
  const { record } = m.boot();
  m.cutAfter(record, 2 * MIN);
  m.clock.now += 5 * 60 * MIN; // 사람이 한참 뒤에 다시 켰다
  const { previous } = m.boot();
  assert.equal(previous.line, "직전 실행: 기록 없이 끊김 | 가동 2분(마지막으로 살아 있던 때까지) | 짧게 끊긴 실행 1번 연달아");
  assert.equal(previous.skipRestore, false);
});

test("짧게 끊긴 실행(기록 없이 끊김 · 전역 폭주)이 연달아 두 번이면 세션을 되살리지 않는다. 길게 돌았거나 깨끗이 끝나면 처음부터 센다", () => {
  const m = machine();
  let run = m.boot();
  m.cutAfter(run.record, MIN);
  run = m.boot();
  m.clock.now += MIN;
  run.record.end("global-flood");
  run = m.boot();
  assert.equal(run.previous.shortStreak, 2);
  assert.equal(run.previous.skipRestore, true);
  assert.match(run.previous.line, /^직전 실행: 전역 폭주로 내림 \| 가동 1분/);

  m.cutAfter(run.record, SHORT_RUN_MS); // 되살리지 않은 실행은 오래 돌았다
  run = m.boot();
  assert.equal(run.previous.shortStreak, 0, "오래 돈 실행은 세지 않는다");
  m.cutAfter(run.record, MIN);
  run = m.boot();
  m.clock.now += MIN;
  run.record.end("shutdown");
  assert.equal(m.boot().previous.shortStreak, 0, "깨끗이 끝나면 세지 않는다");
});

test("기동 실패는 끊김으로 세지 않는다. begin 전의 end 는 아무것도 적지 않는다", () => {
  const m = machine();
  new RunRecord(m.file, () => m.clock.now).end("shutdown");
  assert.equal(fs.existsSync(m.file), false);
  const { record } = m.boot();
  record.end("startup-failed");
  assert.equal(m.boot().previous.shortStreak, 0);
});
