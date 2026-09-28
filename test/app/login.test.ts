// src/app/login.ts — 로그인이 디스코드 5xx · 네트워크로 실패하면 간격을 두고 다시 한다. 토큰 · 인텐트 오류는 곧바로 던진다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loginWithRetry } from "../../src/app/login.ts";

// 로그인 결과를 차례로 낸다. 오류면 던지고 아니면 돌려준다
function client(results: Array<Error | string>) {
  const tries: string[] = [];
  return {
    tries,
    async login(token: string) {
      tries.push(token);
      const r = results.shift();
      if (r instanceof Error) throw r;
      return r;
    },
  };
}
const server5xx = () => Object.assign(new Error("Internal Server Error"), { status: 500 });

test("5xx · 네트워크 오류는 기다렸다가 다시 한다. 붙으면 그 결과를 돌려준다", async () => {
  const c = client([server5xx(), Object.assign(new Error("socket"), { code: "ECONNRESET" }), "토큰"]);
  const waited: number[] = [];
  assert.equal(await loginWithRetry(c, "T", { waits: [5, 15, 30], wait: async (ms) => void waited.push(ms) }), "토큰");
  assert.deepEqual(waited, [5, 15]);
  assert.equal(c.tries.length, 3);
});

test("토큰 · 인텐트가 틀리면 다시 하지 않고 곧바로 던진다", async () => {
  const c = client([Object.assign(new Error("An invalid token was provided."), { code: "TokenInvalid" })]);
  const waited: number[] = [];
  await assert.rejects(loginWithRetry(c, "T", { waits: [5], wait: async (ms) => void waited.push(ms) }), /invalid token/);
  assert.deepEqual(waited, []);
});

test("정한 횟수를 다 해 봐도 안 되면 마지막 오류를 던진다", async () => {
  const c = client([server5xx(), server5xx(), server5xx()]);
  await assert.rejects(loginWithRetry(c, "T", { waits: [1, 1], wait: async () => {} }), /Internal Server Error/);
  assert.equal(c.tries.length, 3, "처음 한 번 + 다시 두 번");
});
