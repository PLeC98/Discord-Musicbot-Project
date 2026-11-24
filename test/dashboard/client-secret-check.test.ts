// src/dashboard/client-secret-check.ts: 기동할 때 CLIENT_SECRET을 토큰 폐기(가짜 토큰)로 확인한다. 디스코드에는 보내지 않는다(가짜 HTTP, 가짜 타이머)

import { test } from "node:test";
import assert from "node:assert/strict";
import config from "../../src/config/index.ts";
import logSink from "../../src/infra/log/sink.ts";
import { useAppId } from "../../src/infra/app-id.ts";
import { checkClientSecret, startClientSecretCheck, verdictOf, RETRY_MS, type Verdict } from "../../src/dashboard/client-secret-check.ts";
import type { DiscordHttp } from "../../src/dashboard/discord-api.ts";

const SECRET = "test-client-secret-0123456789";
useAppId("123456789012345678");
config.discord.clientSecret = SECRET;

const logLines: string[] = [];
logSink.addDestination((rec: unknown) => logLines.push(JSON.stringify(rec)));

const failed = (status: number, data: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

/** 차례대로 답하는 가짜 HTTP. 보낸 본문을 모은다 */
function fakeHttp(answers: Array<"ok" | Error>) {
  const sent: Array<{ url: string; body: Record<string, string> }> = [];
  const http: DiscordHttp = {
    post: (url, body) => {
      sent.push({ url, body: Object.fromEntries(body) });
      const answer = answers[Math.min(sent.length - 1, answers.length - 1)];
      return answer === "ok" ? Promise.resolve({ data: {} as never }) : Promise.reject(answer);
    },
    get: () => Promise.reject(new Error("쓰지 않는다")),
  };
  return { http, sent };
}

/** 부르면 바로 돌리는 가짜 타이머. 기다린 시간을 모은다 */
function fakeTimers() {
  const waits: number[] = [];
  return { waits, timers: { setTimeout: (run: () => void, ms: number) => (waits.push(ms), queueMicrotask(run), { unref: () => undefined }) } };
}

test("판정: 2xx 맞음, 401 invalid_client 틀림, 바뀌지 않는 답은 바로 알리고, 바뀔 수 있는 실패는 다시 시도한다", () => {
  assert.deepEqual(verdictOf(failed(401, { error: "invalid_client" })), { kind: "wrong" });
  assert.deepEqual(verdictOf(failed(401, { message: "401: Unauthorized" })), { kind: "fixed", status: 401, error: null }, "invalid_client가 아닌 401은 시크릿 문제로 보지 않는다");
  assert.deepEqual(verdictOf(failed(400, { error: "invalid_request" })), { kind: "fixed", status: 400, error: "invalid_request" });
  assert.deepEqual(verdictOf(failed(403, "Forbidden")), { kind: "fixed", status: 403, error: null });
  assert.deepEqual(verdictOf(failed(429, { retry_after: 12.3 })), { kind: "later", status: 429, error: null, waitMs: 12_300 });
  assert.deepEqual(verdictOf(failed(503, "upstream")), { kind: "later", status: 503, error: null, waitMs: null });
  assert.deepEqual(verdictOf(Object.assign(new Error("timed out"), { name: "TimeoutError" })), { kind: "later", status: null, error: "timeout", waitMs: null });
  assert.deepEqual(verdictOf(new Error("fetch failed")), { kind: "later", status: null, error: "fetch failed", waitMs: null });
});

test("요청: 폐기 엔드포인트에 앱 자격과 매번 새 가짜 토큰을 본문으로 보낸다", async () => {
  const { http, sent } = fakeHttp(["ok"]);
  assert.deepEqual(await checkClientSecret(http), { kind: "ok" });
  await checkClientSecret(http);
  assert.equal(sent[0].url, "https://discord.com/api/v10/oauth2/token/revoke");
  assert.deepEqual(Object.keys(sent[0].body).sort(), ["client_id", "client_secret", "token", "token_type_hint"]);
  assert.equal(sent[0].body.client_id, "123456789012345678");
  assert.equal(sent[0].body.client_secret, SECRET);
  assert.equal(sent[0].body.token_type_hint, "access_token");
  assert.notEqual(sent[0].body.token, sent[1].body.token, "가짜 토큰은 매번 새로 만든다");
  assert.ok(sent[0].body.token.length >= 40 && sent[0].body.token !== SECRET);
});

test("기동 확인: 맞음, 틀림, 바뀌지 않는 답은 첫 시도에 멈춘다", async () => {
  const cases: Array<[Error | "ok", Verdict["kind"]]> = [
    ["ok", "ok"],
    [failed(401, { error: "invalid_client" }), "wrong"],
    [failed(400, { error: "invalid_request" }), "fixed"],
  ];
  for (const [answer, kind] of cases) {
    const { http, sent } = fakeHttp([answer]);
    const { timers, waits } = fakeTimers();
    assert.equal((await startClientSecretCheck(http, timers)).kind, kind);
    assert.deepEqual([sent.length, waits], [1, []]);
  }
});

test("기동 확인: 바뀔 수 있는 실패는 1, 2, 4, 8분 뒤 다시 시도하고(429는 디스코드가 지정한 만큼 더 길게), 다섯 번째에 그만둔다", async () => {
  const { http, sent } = fakeHttp([failed(503, ""), failed(429, { retry_after: 300 }), new Error("fetch failed"), failed(500, ""), failed(502, "")]);
  const { timers, waits } = fakeTimers();
  assert.equal((await startClientSecretCheck(http, timers)).kind, "later");
  assert.equal(sent.length, 5);
  assert.deepEqual(waits, [RETRY_MS[0], 300_000, RETRY_MS[2], RETRY_MS[3]]);

  const later = fakeHttp([failed(503, ""), "ok"]);
  const second = fakeTimers();
  assert.equal((await startClientSecretCheck(later.http, second.timers)).kind, "ok", "다시 확인해 맞으면 멈춘다");
  assert.equal(later.sent.length, 2);
});

test("로그에 시크릿과 가짜 토큰이 남지 않는다", async () => {
  logLines.length = 0;
  for (const answer of ["ok" as const, failed(401, { error: "invalid_client" }), failed(400, { error: "invalid_request" })]) {
    const { http, sent } = fakeHttp([answer]);
    await startClientSecretCheck(http, fakeTimers().timers);
    const text = logLines.join("\n");
    assert.ok(!text.includes(SECRET), "시크릿이 남지 않는다");
    assert.ok(!text.includes(sent[0].body.token), "가짜 토큰이 남지 않는다");
  }
  assert.ok(logLines.length >= 3, "판정마다 한 줄씩 남긴다");
});
