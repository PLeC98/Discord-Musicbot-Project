// src/app/app-info.ts: 기동과 pnpm commands가 봇 토큰으로 앱 설정을 읽어 앱 ID를 넣는다. 디스코드가 답할 때까지 로그인과 같은 간격으로 재시도하고, 토큰이 틀리면 멈춘다

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "../../src/app/app-info.ts";
import { appIdOf, _resetAppId } from "../../src/infra/app-id.ts";
import { codeOf } from "../../src/rules/error-kind.ts";

afterEach(() => _resetAppId());

const noWait = { waits: [1, 1], wait: async () => {} };
const failing = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

test("앱 설정을 읽으면 앱 ID를 넣고 그 앱 설정을 돌려준다", async () => {
  const app = await loadApp(async () => ({ id: "123456789012345678", flags: 0 }), noWait);
  assert.deepEqual(app, { id: "123456789012345678", flags: 0 });
  assert.equal(appIdOf(), "123456789012345678");
});

test("읽기 전에는 앱 ID를 쓰지 못한다(빈 값으로 배포 경로, 로그인 주소를 만들지 않는다)", () => {
  assert.throws(() => appIdOf(), /앱 ID를 아직 읽지 않음/);
});

test("디스코드가 답하지 않으면 간격을 두고 재시도하고, 토큰이 틀리면(401) 곧바로 TokenInvalid", async () => {
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls < 3) throw failing(503);
    return { id: "123456789012345678" };
  };
  await loadApp(flaky, noWait);
  assert.equal(calls, 3);

  calls = 0;
  const rejected = loadApp(async () => {
    calls++;
    throw failing(401);
  }, noWait);
  await assert.rejects(rejected, (error: unknown) => codeOf(error) === "TokenInvalid");
  assert.equal(calls, 1, "토큰 오류는 재시도하지 않는다");
});

test("재시도를 다 쓰면 마지막 오류를 던지고, 앱 ID가 없는 답은 빈 값으로 넣지 않는다", async () => {
  await assert.rejects(
    loadApp(async () => Promise.reject(failing(502)), noWait),
    /HTTP 502/,
  );
  await assert.rejects(
    loadApp(async () => ({ flags: 0 }), noWait),
    (error: unknown) => codeOf(error) === "app-id-missing",
  );
  assert.throws(() => appIdOf());
});
