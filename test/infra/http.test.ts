// src/infra/http.ts · link-status.ts — 바깥 서비스로 나가는 요청은 한 클라이언트를 지나고, 서비스마다 부른 결과를 남긴다

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { httpFor } from "../../src/infra/http.ts";
import { _reset, linkStatus, RECENT } from "../../src/infra/link-status.ts";

beforeEach(_reset);

const answer = (status: number) => async () => new Response("{}", { status });
const fail = (error: Error) => async (): Promise<Response> => {
  throw error;
};
const outcomes = () => linkStatus("lastfm")?.recent.map((one) => [one.ok, one.error]);

test("응답을 받으면 성공(4xx 포함), 5xx · 429 · 401 · 403 은 실패. 마지막 성공 때를 둔다", async () => {
  const http = httpFor("lastfm");
  assert.equal(linkStatus("lastfm"), null, "부르기 전에는 없다");

  for (const status of [200, 404, 503, 429, 401]) {
    http.useFetch(answer(status));
    assert.equal((await http.fetch("https://example.test/")).status, status, "응답은 그대로 돌려준다");
  }
  assert.deepEqual(outcomes(), [
    [true, null],
    [true, null],
    [false, "HTTP 503"],
    [false, "HTTP 429"],
    [false, "HTTP 401"],
  ]);
  const { recent, lastOkAt } = linkStatus("lastfm")!;
  assert.equal(lastOkAt, recent[1].at);
  assert.ok(recent.every((one) => one.ms >= 0));
});

test("연결 실패 · 시간 초과는 까닭을 남기고 던진다. 부른 쪽이 끊은 것은 남기지 않는다", async () => {
  const http = httpFor("lastfm");
  const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
  const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
  for (const error of [refused, timeout, aborted]) {
    http.useFetch(fail(error));
    await assert.rejects(http.fetch("https://example.test/"), error);
  }
  assert.deepEqual(outcomes(), [
    [false, "ECONNREFUSED"],
    [false, "timeout"],
  ]);
  assert.equal(linkStatus("lastfm")!.lastOkAt, null);
});

test("서비스마다 따로, 최근 몇 번만 둔다", async () => {
  const lastfm = httpFor("lastfm");
  const vocadb = httpFor("vocadb");
  lastfm.useFetch(answer(200));
  vocadb.useFetch(answer(500));
  for (let i = 0; i < RECENT + 3; i++) await lastfm.fetch("https://example.test/");
  await vocadb.fetch("https://example.test/");
  assert.equal(linkStatus("lastfm")!.recent.length, RECENT);
  assert.deepEqual(
    linkStatus("vocadb")!.recent.map((one) => one.error),
    ["HTTP 500"],
  );
});
