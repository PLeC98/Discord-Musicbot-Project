// src/app/login.ts — 로그인 전에 게이트웨이 정보를 묻고, 디스코드 5xx · 네트워크면 간격을 두고 다시 묻는다. 로그인은 한 번만 한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loginWithRetry } from "../../src/app/login.ts";
import { EXIT, failedStartCode } from "../../src/app/exitCodes.ts";

// 게이트웨이 정보 요청의 결과를 차례로 낸다. 로그인은 부른 것만 센다
function client(gateway: Array<Error | object>, { loginFails = false } = {}) {
  const steps: string[] = [];
  return {
    steps,
    rest: {
      setToken: (t: string) => steps.push(`token:${t}`),
      get: async (route: string) => {
        steps.push(`get:${route}`);
        const r = gateway.shift();
        if (r instanceof Error) throw r;
        return r;
      },
    },
    login: async (t: string) => {
      steps.push(`login:${t}`);
      if (loginFails) throw Object.assign(new Error("Unexpected server response: 502"), { status: 502 });
      return t;
    },
  };
}
const server5xx = () => Object.assign(new Error("Internal Server Error"), { status: 500 });

test("게이트웨이 정보가 5xx · 네트워크로 안 오면 기다렸다가 다시 묻고, 오면 한 번 로그인한다", async () => {
  const c = client([server5xx(), Object.assign(new Error("socket"), { code: "ECONNRESET" }), { url: "wss://gateway" }]);
  const waited: number[] = [];
  assert.equal(await loginWithRetry(c, "T", { waits: [5, 15, 30], wait: async (ms) => void waited.push(ms) }), "T");
  assert.deepEqual(waited, [5, 15]);
  assert.deepEqual(c.steps, ["token:T", "get:/gateway/bot", "get:/gateway/bot", "get:/gateway/bot", "login:T"]);
});

test("토큰이 틀리면(401) 다시 묻지 않고 설정 문제로 던진다", async () => {
  const c = client([Object.assign(new Error("401: Unauthorized"), { status: 401 })]);
  const waited: number[] = [];
  const error = await loginWithRetry(c, "T", { waits: [5], wait: async (ms) => void waited.push(ms) }).catch((e: unknown) => e);
  assert.equal(failedStartCode(error, false), EXIT.badSetup);
  assert.deepEqual(waited, []);
  assert.ok(!c.steps.some((s) => s.startsWith("login")));
});

test("정한 횟수를 다 물어도 안 오면 마지막 오류를 던진다(일시적 기동 실패). 로그인은 하지 않는다", async () => {
  const c = client([server5xx(), server5xx(), server5xx()]);
  const error = await loginWithRetry(c, "T", { waits: [1, 1], wait: async () => {} }).catch((e: unknown) => e);
  assert.equal(failedStartCode(error, false), EXIT.transient);
  assert.equal(c.steps.filter((s) => s.startsWith("get")).length, 3, "처음 한 번 + 다시 두 번");
  assert.ok(!c.steps.some((s) => s.startsWith("login")));
});

test("로그인 자체가 실패하면 다시 하지 않고 던진다(discord.js 가 실패 때 클라이언트를 정리하기 때문)", async () => {
  const c = client([{ url: "wss://gateway" }], { loginFails: true });
  await assert.rejects(loginWithRetry(c, "T", { waits: [1], wait: async () => {} }), /502/);
  assert.equal(c.steps.filter((s) => s.startsWith("login")).length, 1);
});
