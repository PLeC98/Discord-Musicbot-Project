// dashboard/src/utils/request.ts — 화면 요청 한 곳: CSRF 토큰 · 토큰 거절 뒤 한 번 다시 보내기 · 세션 끝 · 서버에 닿았는지 · 시간 한도

import { test } from "node:test";
import assert from "node:assert/strict";
import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig } from "../../../dashboard/node_modules/axios/index.js";
import { installRequests, failureKind, LIMIT } from "../../../dashboard/src/utils/request.ts";
import { problemBody } from "../../../src/dashboard/contract/problem.ts";
import type { Code } from "../../../src/rules/problems.ts";

type Sent = { method: string; url: string; token: string | undefined };
/** blob: 문제 응답을 파일로 받는 요청처럼 Blob 으로 */
type Reply = { problem?: Code; data?: unknown; fail?: string; blob?: boolean };

/** 가짜 서버. route 가 요청마다 답을 고른다. 보낸 요청(토큰 받기 포함)을 차례대로 적는다. signsIn: 다시 로그인을 물으면 마칠지(기본은 그만둔다) */
function harness(route: (req: Sent, sent: Sent[]) => Reply, { signsIn = false }: { signsIn?: boolean } = {}) {
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
        const body = reply.blob ? new Blob([JSON.stringify(data)], { type: "application/problem+json" }) : data;
        const response = { data: body, status: data.status, statusText: "", headers: {}, config } as AxiosResponse;
        throw new AxiosError("문제 응답", "ERR_BAD_REQUEST", config, null, response);
      }
      return { data: reply.data ?? {}, status: 200, statusText: "OK", headers: {}, config };
    },
  });
  const reauths: string[] = [];
  const onReauth = () => {
    reauths.push("reauth");
    return Promise.resolve(signsIn);
  };
  installRequests(http, { onSessionEnd: () => ends.push("end"), onReauth, onReach: (ok) => reach.push(ok) });
  return { http, sent, ends, reach, reauths };
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

test("reauth-required 면 다시 로그인을 묻는다. 그만두면 거절대로 실패한다. 세션 끝이 아니다", async () => {
  const { http, ends, reauths } = harness((req) => tokenRoute(req) ?? { problem: "reauth-required" });
  await assert.rejects(http.put("/api/admin/secrets/x"), (error: AxiosError) => error.response?.status === 403);
  assert.deepEqual(reauths, ["reauth"]);
  assert.deepEqual(ends, []);
});

// 내려받기는 Blob 으로 받는다. 거절도 Blob 으로 오므로 풀어서 읽어야 다시 로그인을 묻는다
test("Blob 으로 온 문제 응답도 문제로 읽는다(내려받기의 reauth-required)", async () => {
  const { http, reauths } = harness((req) => tokenRoute(req) ?? { problem: "reauth-required", blob: true });
  await assert.rejects(http.get("/api/admin/settings-archive/export", { responseType: "blob" }), (error: AxiosError) => (error.response?.data as { code?: string }).code === "reauth-required");
  assert.deepEqual(reauths, ["reauth"]);
});

// 다시 로그인을 마치면 하던 일을 잇는다(부른 쪽은 기다리기만). 새 세션이라 토큰도 새로 받는다
test("다시 로그인을 마치면 그 요청을 새 토큰으로 한 번 다시 보낸다. 또 거절되면 더 묻지 않는다", async () => {
  let fresh = false;
  const { http, sent, reauths } = harness(
    (req) => {
      const issuedNow = tokenRoute(req);
      if (issuedNow) return issuedNow;
      if (!fresh) {
        fresh = true;
        return { problem: "reauth-required" };
      }
      return { data: { ok: true } };
    },
    { signsIn: true },
  );
  const res = await http.post("/api/admin/snapshots/restore");
  assert.deepEqual(res.data, { ok: true });
  assert.deepEqual(reauths, ["reauth"]);
  const posts = sent.filter((one) => one.url === "/api/admin/snapshots/restore");
  assert.equal(posts.length, 2);
  assert.notEqual(posts[0].token, posts[1].token, "새 세션의 토큰");

  const stubborn = harness((req) => tokenRoute(req) ?? { problem: "reauth-required" }, { signsIn: true });
  await assert.rejects(stubborn.http.post("/api/admin/snapshots/restore"), (error: AxiosError) => error.response?.status === 403);
  assert.deepEqual(stubborn.reauths, ["reauth"], "한 번만 묻는다");
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
