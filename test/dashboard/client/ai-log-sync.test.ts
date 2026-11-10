// dashboard/src/composables/ai-log-sync.ts: AI 리퀘스트 로그 화면의 SSE 연결을 열고 닫는 순서를 다룬다.
// 보일 때만 열고, 처음 열 때나 화면을 떠났다 올 때, 세션이 끝났거나 계정이 바뀐 뒤, 읽지 못했을 때만 다시 읽는다. 읽는 사이 상태가 바뀌었거나 화면이 사라졌으면 열지 않는다

import { test } from "node:test";
import assert from "node:assert/strict";
import { aiLogSync } from "../../../dashboard/src/composables/ai-log-sync.ts";

function setup() {
  const state = { active: true, canStream: true, blocked: false, failed: false };
  const did: string[] = [];
  let finishLoad: () => void = () => {};
  let holding = false;
  const sync = aiLogSync({
    active: () => state.active,
    canStream: () => state.canStream,
    blocked: () => state.blocked,
    reload: () => {
      did.push("reload");
      return holding ? new Promise<void>((done) => (finishLoad = done)) : Promise.resolve();
    },
    loadFailed: () => state.failed,
    start: () => did.push("start"),
    stop: () => did.push("stop"),
  });
  return { state, did, sync, hold: () => (holding = true), finish: () => ((holding = false), finishLoad()) };
}

test("처음 열 때 읽고 연다. 탭을 숨겼다 보이면 다시 읽지 않고 이어 연다(펼친 줄을 지킨다)", async () => {
  const s = setup();
  await s.sync.sync();
  assert.deepEqual(s.did, ["reload", "start"]);
  s.state.canStream = false;
  await s.sync.sync();
  s.state.canStream = true;
  await s.sync.sync();
  assert.deepEqual(s.did, ["reload", "start", "stop", "start"]);
});

test("화면을 떠났다 오거나, 세션이 끝났거나 계정이 바뀐 뒤에는 다시 읽는다. 막힌 동안은 열지 않는다", async () => {
  const s = setup();
  await s.sync.sync();
  s.state.active = false;
  await s.sync.sync();
  s.state.active = true;
  await s.sync.sync();
  assert.deepEqual(s.did, ["reload", "start", "stop", "reload", "start"]);

  s.did.length = 0;
  s.state.blocked = true;
  s.state.canStream = false;
  await s.sync.sync();
  assert.deepEqual(s.did, ["stop"], "막힌 동안 열지 않는다");
  s.state.blocked = false;
  s.state.canStream = true;
  await s.sync.sync();
  assert.deepEqual(s.did, ["stop", "reload", "start"], "다시 로그인한 뒤 다시 읽는다");
});

test("읽지 못했으면 다음번에 다시 읽는다", async () => {
  const s = setup();
  s.state.failed = true;
  await s.sync.sync();
  s.state.failed = false;
  s.state.canStream = false;
  await s.sync.sync();
  s.state.canStream = true;
  await s.sync.sync();
  assert.deepEqual(s.did, ["reload", "start", "stop", "reload", "start"]);
});

test("읽는 사이 탭을 숨겼거나 새 호출이 들어왔거나 화면이 사라졌으면 열지 않는다", async () => {
  const hidden = setup();
  hidden.hold();
  const first = hidden.sync.sync();
  hidden.state.canStream = false;
  hidden.finish();
  await first;
  assert.deepEqual(hidden.did, ["reload"], "숨겼다");

  const gone = setup();
  gone.hold();
  const pending = gone.sync.sync();
  gone.sync.dispose();
  gone.finish();
  await pending;
  assert.deepEqual(gone.did, ["reload", "stop"], "사라진 화면의 읽기가 끝나도 열지 않는다");
});
