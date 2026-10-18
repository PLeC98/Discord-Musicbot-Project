// AI 리퀘스트 로그 · 사용량 통계 저장: 쓰기 · 필터 · 페이지 넘기기 · 저장 용량 맞추기 · 삭제 · 필드 자르기

import test, { after } from "node:test";
import assert from "node:assert";
import { openTempStore } from "../helpers/temp-store.ts";
import * as requests from "../../src/store/ai-requests.ts";
import type { NewRecord } from "../../src/store/ai-requests.ts";
import type { AiLogQuery } from "../../src/dashboard/contract/ai-log.ts";

const store = openTempStore("ai-requests-");
after(() => store.close());

const BASE: NewRecord = {
  at: Date.UTC(2026, 9, 11, 3, 0, 0),
  source: "autoplay",
  provider: "openai",
  model: "gpt-x",
  name: "GPT X",
  url: "https://api.openai.com/v1/chat/completions",
  method: "POST",
  status: 200,
  ok: true,
  aborted: false,
  tookMs: 1200,
  firstMs: 900,
  attempt: 1,
  guildId: "900",
  genre: "rock",
  candidates: 8,
  tokens: { input: 1000, output: 100, cached: 200, reasoning: 10 },
  costUsd: 0.002,
  requestHeaders: '{"Authorization":"Bearer [REDACTED_SECRET_KEY]"}',
  requestBody: "{}",
  response: "{}",
};
const BIG = 1024 * 1024 * 1024;
const add = (patch: Partial<NewRecord> = {}) => requests.record({ ...BASE, ...patch }, { maxBytes: BIG });

test("쓴 행은 목록 · 한 행 읽기로 돌아오고, 듣는 쪽에 알린다", () => {
  requests.clearRequests();
  const heard: number[] = [];
  const off = requests.onRecorded((entry) => heard.push(entry.id));
  const entry = add();
  off();
  assert.deepEqual(heard, [entry.id]);
  assert.equal(entry.tokens?.cached, 200);
  assert.equal(entry.guildId, "900");
  const detail = requests.one(entry.id);
  assert.equal(detail?.requestHeaders, BASE.requestHeaders);
  assert.equal(requests.list({ sources: [], result: "", q: "" }, { limit: 50 }).entries[0].id, entry.id);
});

test("필터: 출처 · 결과 · 찾는 말(대소문자 무시, 이름까지) · 최근 것부터 페이지 넘기기", () => {
  requests.clearRequests();
  add({ source: "models", model: "", name: "", url: "https://api.openai.com/v1/models", tokens: null });
  add({ ok: false, status: 429, error: "Too Many Requests" });
  add({ source: "ping", name: "Fancy Model" });
  const all: AiLogQuery = { sources: [], result: "", q: "" };
  assert.equal(requests.list({ ...all, sources: ["models"] }, { limit: 50 }).matched, 1);
  assert.equal(requests.list({ ...all, result: "failed" }, { limit: 50 }).entries[0].error, "Too Many Requests");
  assert.equal(requests.list({ ...all, q: "too many" }, { limit: 50 }).matched, 1);
  assert.equal(requests.list({ ...all, q: "FANCY" }, { limit: 50 }).matched, 1);
  // % 는 글자 그대로다(LIKE 처럼 아무 글자나가 아니다)
  assert.equal(requests.list({ ...all, q: "%" }, { limit: 50 }).matched, 0);
  const first = requests.list(all, { limit: 2 });
  assert.equal(first.entries.length, 2);
  assert.equal(first.total, 3);
  const next = requests.list(all, { before: first.entries[1].id, limit: 2 });
  assert.equal(next.entries.length, 1);
  assert.equal(next.entries[0].source, "models");
});

test("저장 용량을 넘으면 오래된 로그부터 삭제하되 최근 행은 남기고, 통계는 삭제하지 않는다", () => {
  requests.clearRequests();
  requests.clearUsage();
  const body = "x".repeat(2000);
  for (let i = 0; i < requests.KEEP_MIN_ROWS + 30; i++) add({ requestBody: body });
  requests.rotate(10_000);
  const left = requests.size();
  assert.equal(left.count, requests.KEEP_MIN_ROWS);
  assert.equal(requests.usageSince("2000-01-01", []).length, requests.KEEP_MIN_ROWS + 30);
});

test("로그를 지워도 통계는 남고, 통계를 지워도 로그는 남는다", () => {
  requests.clearRequests();
  requests.clearUsage();
  add();
  requests.clearRequests();
  assert.equal(requests.size().count, 0);
  assert.equal(requests.usageSince("2000-01-01", []).length, 1);
  add();
  requests.clearUsage();
  assert.equal(requests.size().count, 1);
  assert.equal(requests.earliestDay(), null);
});

test("너무 큰 필드는 앞뒤를 남기고 잘라 잘림을 적는다", () => {
  requests.clearRequests();
  const huge = `${"a".repeat(requests.MAX_FIELD_BYTES)}끝`;
  const entry = add({ response: huge });
  assert.equal(entry.truncated, true);
  const detail = requests.one(entry.id)!;
  assert.ok(detail.response.startsWith("aaaa"));
  assert.ok(detail.response.endsWith("끝"));
  assert.ok(Buffer.byteLength(detail.response) < requests.MAX_FIELD_BYTES + 200);
  assert.ok(entry.bytes < requests.MAX_FIELD_BYTES + 1000);
});

test("통계 행: 출처로 필터링하고 토큰을 못 읽은 요청은 0 으로 센다", () => {
  requests.clearUsage();
  add();
  add({ source: "models", tokens: null, costUsd: 0 });
  const rows = requests.usageSince("2000-01-01", ["models"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].input, 0);
  assert.equal(requests.usageSince("2000-01-01", []).length, 2);
});
