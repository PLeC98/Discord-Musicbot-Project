// dashboard/src/utils/chunk-upload.ts: 청크로 올리기, 끊기면 받은 위치부터 이어 올리기, 위치 맞추기, 다시 해 보기 상한, 그만두면 봇의 업로드 지우기

import { test } from "node:test";
import assert from "node:assert/strict";
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "../../../dashboard/node_modules/axios/index.js";
import { uploadFile } from "../../../dashboard/src/utils/chunk-upload.ts";
import { problemBody } from "../../../src/dashboard/contract/problem.ts";
import type { Code } from "../../../src/rules/problems.ts";
import type { Params } from "../../../src/rules/problems.ts";

type Sent = { method: string; url: string; offset?: number; bytes?: number };
type Reply = { data?: unknown; problem?: Code; params?: Params; fail?: string; status?: number; headers?: Record<string, string> };

/** 가짜 봇. route 가 요청마다 답을 고른다. 보낸 요청과, 그 봇에 보내는 axios */
function serve(route: (req: Sent, sent: Sent[]) => Reply) {
  const sent: Sent[] = [];
  const adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const req: Sent = { method: (config.method || "get").toUpperCase(), url: config.url || "", offset: config.params?.offset, bytes: config.data instanceof Blob ? config.data.size : undefined };
    sent.push(req);
    const reply = route(req, sent);
    if (reply.fail) throw new AxiosError(reply.fail, reply.fail, config);
    if (reply.problem || reply.status) {
      const data = reply.problem ? problemBody(reply.problem, reply.params) : {};
      throw new AxiosError("거절", "ERR_BAD_REQUEST", config, null, { data, status: reply.status ?? (data as { status: number }).status, statusText: "", headers: reply.headers ?? {}, config } as AxiosResponse);
    }
    return { data: reply.data ?? {}, status: 200, statusText: "OK", headers: {}, config };
  };
  return { sent, http: axios.create({ adapter }) };
}
const ID = "a".repeat(32);
const file = (size: number) => new Blob([new Uint8Array(size)]);
const started = (chunkSize: number): Reply => ({ data: { id: ID, chunkSize, received: 0 } });

test("크기를 알리고 청크 크기대로 차례로 올린다. 진행률은 1 로 끝나고 업로드 id 를 돌려준다", async () => {
  let received = 0;
  const { sent, http } = serve((req) => {
    if (req.method === "POST") return started(4);
    received += req.bytes ?? 0;
    return { data: { received } };
  });
  const shares: number[] = [];
  assert.equal(await uploadFile(file(10), "archive", { http, onProgress: (share) => shares.push(share) }), ID);
  assert.deepEqual(
    sent.filter((one) => one.method === "PUT").map((one) => [one.offset, one.bytes]),
    [
      [0, 4],
      [4, 4],
      [8, 2],
    ],
  );
  assert.equal(shares.at(-1), 1);
});

test("끊기면 기다렸다 봇이 받은 위치를 물어 그 위치부터 이어 올린다", async () => {
  let received = 0;
  let failed = false;
  const { sent, http } = serve((req) => {
    if (req.method === "POST") return started(4);
    if (req.method === "GET") return { data: { received, size: 8 } };
    if (req.offset === 4 && !failed) {
      failed = true;
      received = 8; // 봇은 다 받았는데 답이 끊겼다
      return { fail: "ERR_NETWORK" };
    }
    received += req.bytes ?? 0;
    return { data: { received } };
  });
  assert.equal(await uploadFile(file(8), "archive", { http }), ID);
  assert.deepEqual(
    sent.map((one) => `${one.method} ${one.offset ?? ""}`),
    ["POST ", "PUT 0", "PUT 4", "GET "],
  );
});

test("응답 없이 끊긴 것은 오류 코드와 상관없이 다시 해 본다(ECONNRESET 등). 화면이 취소한 것은 다시 하지 않는다", async () => {
  let failed = false;
  const { http } = serve((req) => {
    if (req.method === "POST") return started(8);
    if (req.method === "GET") return { data: { received: 0, size: 8 } };
    if (!failed) {
      failed = true;
      return { fail: "ECONNRESET" };
    }
    return { data: { received: 8 } };
  });
  assert.equal(await uploadFile(file(8), "archive", { http }), ID);
  const stopped = serve((req) => (req.method === "POST" ? started(8) : req.method === "DELETE" ? {} : { fail: "ERR_CANCELED" }));
  await assert.rejects(uploadFile(file(8), "archive", { http: stopped.http }));
  assert.equal(stopped.sent.filter((one) => one.method === "PUT").length, 1);
});

test("위치가 어긋나면 응답의 받은 위치로 맞추고, 요청 제한은 Retry-After 만큼 기다린다", async () => {
  let received = 0;
  let limited = false;
  const { sent, http } = serve((req) => {
    if (req.method === "POST") return started(4);
    if (!limited) {
      limited = true;
      return { status: 429, headers: { "retry-after": "0.01" } };
    }
    if (req.offset !== received) return { problem: "upload-offset", params: { received } };
    received += req.bytes ?? 0;
    return { data: { received } };
  });
  received = 4; // 봇은 앞 청크를 이미 받았다
  assert.equal(await uploadFile(file(8), "archive", { http }), ID);
  assert.deepEqual(
    sent.filter((one) => one.method === "PUT").map((one) => one.offset),
    [0, 0, 4],
  );
});

test("다시 해 볼 실패가 아니면(공간 부족) 곧바로 그만두고 봇의 업로드를 지운다", async () => {
  const { sent, http } = serve((req) => {
    if (req.method === "POST") return started(4);
    if (req.method === "DELETE") return {};
    return { problem: "disk-full", params: { size: 0 } };
  });
  await assert.rejects(uploadFile(file(8), "archive", { http }), (error: unknown) => (error as AxiosError).response?.status === 409);
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(
    sent.map((one) => one.method),
    ["POST", "PUT", "DELETE"],
  );
});

test("받은 위치가 오르지 않은 채 6번 다시 해 보고도 실패하면 그만둔다(받은 위치가 오르면 다시 센다)", async () => {
  const { sent, http } = serve((req) => {
    if (req.method === "POST") return started(4);
    if (req.method === "GET") return { data: { received: 0, size: 8 } };
    if (req.method === "DELETE") return {};
    return { status: 429, headers: { "retry-after": "0.001" } };
  });
  await assert.rejects(uploadFile(file(8), "archive", { http }));
  assert.equal(sent.filter((one) => one.method === "PUT").length, 7);
});

test("받은 위치가 오르면 실패를 다시 센다: 청크마다 답이 끊겨도(봇은 받았다) 끝까지 올린다", async () => {
  let received = 0;
  const { http } = serve((req) => {
    if (req.method === "POST") return started(1);
    if (req.method === "GET") return { data: { received, size: 10 } };
    received += req.bytes ?? 0;
    return { status: 429, headers: { "retry-after": "0.001" } };
  });
  assert.equal(await uploadFile(file(10), "archive", { http }), ID);
});

test("업로드가 없어졌으면(상태 묻기가 upload-gone) 그 실패로 그만둔다", async () => {
  const { http } = serve((req) => {
    if (req.method === "POST") return started(4);
    if (req.method === "GET") return { problem: "upload-gone" };
    if (req.method === "DELETE") return {};
    return { status: 503 };
  });
  await assert.rejects(uploadFile(file(8), "archive", { http }), (error: unknown) => (error as AxiosError).response?.status === 410);
});
