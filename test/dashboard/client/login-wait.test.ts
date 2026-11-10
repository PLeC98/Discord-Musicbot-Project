// dashboard/src/utils/login-wait.ts: 로그인 창을 기다리는 동안의 401은 곧바로 세션 끝으로 돌리지 않고, 창이 닫히면 한 번 확인한다

import { test } from "node:test";
import assert from "node:assert/strict";
import { loginWait } from "../../../dashboard/src/utils/login-wait.ts";

function setup(alive: boolean | (() => boolean) = true) {
  let ended = 0;
  let checks = 0;
  let at = 0;
  const wait = loginWait({
    end: () => void ended++,
    check: async () => {
      checks++;
      return typeof alive === "function" ? alive() : alive;
    },
    now: () => at,
  });
  return { wait, ended: () => ended, checks: () => checks, advance: (ms: number) => (at += ms) };
}

test("창을 열지 않았으면 401은 곧바로 세션을 끝낸다", () => {
  const s = setup();
  s.wait.sessionEnded();
  assert.equal(s.ended(), 1);
});

test("창을 기다리는 동안의 401은 모아 두고, 로그인을 마친 뒤 살아 있으면 세션 끝으로 돌리지 않는다", async () => {
  const s = setup(true);
  s.wait.opened();
  s.wait.sessionEnded();
  s.wait.sessionEnded();
  assert.equal(s.ended(), 0);
  await s.wait.signedIn();
  assert.deepEqual([s.checks(), s.ended()], [1, 0], "확인은 한 번");
});

test("로그인을 마친 뒤에도 살아 있지 않거나, 창을 닫았는데 살아 있지 않으면 세션을 끝낸다", async () => {
  const done = setup(false);
  done.wait.opened();
  done.wait.sessionEnded();
  await done.wait.signedIn();
  assert.equal(done.ended(), 1);

  const quit = setup(false);
  quit.wait.opened();
  quit.wait.sessionEnded();
  await quit.wait.abandoned();
  assert.equal(quit.ended(), 1);
});

test("모아 둔 401이 없으면 창이 닫혀도 확인하지 않는다. 창을 연 지 10분이 지나면 기다리지 않는다", async () => {
  const s = setup(false);
  s.wait.opened();
  await s.wait.signedIn();
  assert.equal(s.checks(), 0);
  s.wait.opened();
  s.advance(10 * 60_000);
  s.wait.sessionEnded();
  assert.equal(s.ended(), 1);
});

test("세션 확인 요청이 실패하면(네트워크 오류 등) 세션을 끝낸다", async () => {
  const s = setup(() => {
    throw new Error("offline");
  });
  s.wait.opened();
  s.wait.sessionEnded();
  await s.wait.abandoned();
  assert.equal(s.ended(), 1);
});

test("창이 닫힌 뒤 2분 안에 늦게 온 401(옛 세션으로 나가 있던 긴 요청)은 확인해 살아 있으면 세션 끝으로 돌리지 않고, 그 뒤에는 곧바로 끝낸다", async () => {
  const s = setup(true);
  s.wait.opened();
  await s.wait.signedIn();
  s.wait.sessionEnded();
  s.wait.sessionEnded();
  await new Promise((done) => setImmediate(done));
  await new Promise((done) => setImmediate(done));
  assert.deepEqual([s.checks(), s.ended()], [2, 0], "확인 중에 또 오면 진행 중인 확인이 끝난 뒤 한 번만 더 확인한다(여러 번 겹쳐도 총 2번)");
  s.advance(120_000);
  s.wait.sessionEnded();
  assert.equal(s.ended(), 1);
});

test("창이 닫힌 뒤 늦게 온 401이라도 확인에서 살아 있지 않으면 세션을 끝낸다", async () => {
  const s = setup(false);
  s.wait.opened();
  await s.wait.abandoned();
  s.wait.sessionEnded();
  await new Promise((done) => setImmediate(done));
  assert.equal(s.ended(), 1);
});

test("확인이 나가 있는 동안 온 401은 그 확인이 끝난 뒤 한 번 더 확인한다(먼저 나간 확인의 답은 그 401보다 오래됐을 수 있다)", async () => {
  let answers = [true, false];
  let checks = 0;
  let ended = 0;
  let release: () => void = () => {};
  const wait = loginWait({
    end: () => void ended++,
    check: () => {
      checks++;
      const alive = answers.shift() ?? false;
      return checks === 1 ? new Promise<boolean>((done) => (release = () => done(alive))) : Promise.resolve(alive);
    },
    now: () => 0,
  });
  wait.opened();
  await wait.signedIn();
  wait.sessionEnded();
  wait.sessionEnded();
  release();
  await new Promise((done) => setTimeout(done, 10));
  assert.deepEqual([checks, ended], [2, 1]);
  answers = [];
});
