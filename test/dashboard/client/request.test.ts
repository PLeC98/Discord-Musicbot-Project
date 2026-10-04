// dashboard/src/utils/request.js — 화면 요청 한 곳: CSRF 토큰 · 토큰 거절 뒤 한 번 다시 보내기 · 세션 끝 · 서버에 닿았는지 · 시간 한도

import { test } from "node:test";
import assert from "node:assert/strict";
import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig } from "../../../dashboard/node_modules/axios/index.js";
import { installRequests, failureKind, LIMIT } from "../../../dashboard/src/utils/request.js";
import { problemBody } from "../../../src/dashboard/contract/problem.ts";
import type { Code } from "../../../src/rules/problems.ts";

type Sent = { method: string; url: string; token: string | undefined };
type Reply = { problem?: Code; data?: unknown; fail?: string };

/** 가짜 서버. route 가 요청마다 답을 고른다. 보낸 요청(토큰 받기 포함)을 차례대로 적는다 */
function harness(route: (req: Sent, sent: Sent[]) => Reply) {
  const sent: Sent[] = [];
  const ends: string[] = [];
  const reach: boolean[] = [];
  const http = axios.create({
    adapter: async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      const req = { method: (config.method || "get").toUpperCase(), url: config.url || "", token: config.headers.get("X-CSRF-Token")?.toString() };
      sent.push(req);
      const reply = route(req, sent);
      if (reply.fail) throw new AxiosError(reply.fail, reply.fail, config);
      if (reply.problem) {
        const data = problemBody(reply.problem);
        const response = { data, status: data.status, statusText: "", headers: {}, config } as AxiosResponse;
        throw new AxiosError("문제 응답", "ERR_BAD_REQUEST", config, null, response);
      }
      return { data: reply.data ?? {}, status: 200, statusText: "OK", headers: {}, config };
    },
  });
  installRequests(http, { onSessionEnd: () => ends.push("end"), onReach: (ok) => reach.push(ok) });
  return { http, sent, ends, reach };
}

let issued = 0;
const tokenRoute = (req: Sent) => (req.url === "/api/csrf-token" ? { data: { csrfToken: `t${++issued}` } } : null);

test("시간 한도는 기본 10초, 시간 초과는 연결 끊김과 다른 코드로 받는다", () => {
  const { http } = harness(() => ({}));
  assert.equal(http.defaults.timeout, LIMIT.short);
  assert.equal(LIMIT.short, 10_000);
  assert.equal(LIMIT.long, 120_000);
  assert.equal(http.defaults.transitional?.clarifyTimeoutError, true);
});

test("상태를 바꾸는 요청에만 CSRF 토큰을 싣고, 받은 토큰은 다시 쓴다", async () => {
  const { http, sent } = harness((req) => tokenRoute(req) ?? {});
  await http.get("/api/me");
  await http.post("/api/x");
  await http.delete("/api/y");
  assert.deepEqual(
    sent.map((one) => one.url),
    ["/api/me", "/api/csrf-token", "/api/x", "/api/y"],
  );
  assert.equal(sent[0].token, undefined);
  assert.ok(sent[2].token && sent[2].token === sent[3].token);
});

test("토큰이 거절되면 새 토큰을 받아 정확히 한 번 다시 보낸다", async () => {
  // 다시 로그인해 세션의 토큰이 바뀌었다: 옛 토큰은 거절, 새 토큰은 받는다
  let accepted = "";
  const { http, sent } = harness((req) => {
    const issuedNow = tokenRoute(req);
    if (issuedNow) {
      if (!accepted) accepted = "not-yet";
      else accepted = (issuedNow.data as { csrfToken: string }).csrfToken;
      return issuedNow;
    }
    return req.token === accepted ? { data: { ok: true } } : { problem: "bad-csrf-token" };
  });
  const res = await http.post("/api/x");
  assert.deepEqual(res.data, { ok: true });
  assert.deepEqual(
    sent.map((one) => one.url),
    ["/api/csrf-token", "/api/x", "/api/csrf-token", "/api/x"],
  );
});

test("다시 보내도 거절되면 더 보내지 않고 실패한다", async () => {
  const { http, sent } = harness((req) => tokenRoute(req) ?? { problem: "bad-csrf-token" });
  await assert.rejects(http.post("/api/x"), (error: AxiosError) => error.response?.status === 403);
  assert.equal(sent.filter((one) => one.url === "/api/x").length, 2);
});

test("401 이면 세션 끝을 알리고 요청은 그대로 실패한다. quietSession 이면 알리지 않는다", async () => {
  const { http, ends } = harness(() => ({ problem: "login-required" }));
  await assert.rejects(http.get("/api/guilds"));
  assert.deepEqual(ends, ["end"]);
  await assert.rejects(http.get("/api/me", { quietSession: true } as AxiosRequestConfig));
  assert.deepEqual(ends, ["end"]);
});

test("토큰을 받다 401 이면 그 요청의 실패다. 보낸 요청의 quietSession 을 따른다", async () => {
  const { http, ends, sent } = harness(() => ({ problem: "login-required" }));
  await assert.rejects(http.post("/auth/logout", undefined, { quietSession: true } as AxiosRequestConfig), (error: AxiosError) => error.response?.status === 401);
  assert.deepEqual(ends, []);
  await assert.rejects(http.post("/api/x"));
  assert.deepEqual(ends, ["end"]);
  // 토큰을 받지 못해 정작 요청은 보내지 않았다
  assert.ok(sent.every((one) => one.url === "/api/csrf-token"));
});

test("서버에 닿았는지: 응답이 오면(오류 응답 포함) 닿음, 연결이 안 되면 못 닿음, 시간 초과는 알리지 않는다", async () => {
  const replies: Reply[] = [{ data: {} }, { problem: "no-song" }, { fail: "ERR_NETWORK" }, { fail: "ETIMEDOUT" }, { problem: "bot-not-ready" }];
  const { http, reach } = harness(() => replies.shift() ?? {});
  for (let i = 0; i < 5; i++) await http.get("/api/x").catch(() => {});
  assert.deepEqual(reach, [true, true, false, true]);
});

test("응답 없는 실패의 종류", () => {
  assert.equal(failureKind(new AxiosError("t", "ETIMEDOUT")), "timeout");
  assert.equal(failureKind(new AxiosError("n", "ERR_NETWORK")), "offline");
  assert.equal(failureKind(new AxiosError("a", "ECONNABORTED")), "aborted");
  assert.equal(failureKind(new AxiosError("c", "ERR_CANCELED")), "aborted");
  assert.equal(failureKind({ response: { status: 500 }, code: "ERR_BAD_RESPONSE" }), null);
  // 봇이 꺼져 앞의 프록시가 답했다(문제 응답이 아니다). 봇이 낸 503(준비 전)은 봇이 답한 것
  assert.equal(failureKind({ response: { status: 502, data: "<html>Bad Gateway</html>" } }), "offline");
  assert.equal(failureKind({ response: { status: 504 } }), "offline");
  assert.equal(failureKind({ response: { status: 503, data: { code: "bot-not-ready" } } }), null);
  assert.equal(failureKind(undefined), null);
});
