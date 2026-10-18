// AI 리퀘스트 로그에 남기며 보내기(assist/request-log): 가림 · 시도 · 토큰 · 시간 초과 · 판정 못 읽음 · 남기지 않는 답 · 끄기

import test, { after, beforeEach } from "node:test";
import assert from "node:assert";
import { openTempStore } from "../helpers/temp-store.ts";
import config from "../../src/config/index.ts";
import * as requests from "../../src/store/ai-requests.ts";
import { sendLogged, type Call } from "../../src/autoplay/assist/request-log.ts";
import { REDACTED } from "../../src/autoplay/assist/mask.ts";

const store = openTempStore("request-log-");
after(() => store.close());
beforeEach(() => {
  requests.clearRequests();
  config.aiLog.enabled = true;
});

const all = { sources: [], result: "", q: "" } as const;
const latest = () => requests.list({ ...all, sources: [] }, { limit: 1 }).entries[0];
const reply =
  (body: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status });
const CALL: Call = { source: "ping", provider: "ollama", model: "qwen3:8b", tokensOf: (json) => ({ input: (json as { i: number }).i, output: 7, thoughts: 2, cached: 3 }) };

test("주고받은 것을 남기고 받은 글을 돌려준다. 인증 헤더는 가리고 토큰 · 비용 · 첫 응답을 적는다", async () => {
  const { res, text } = await sendLogged(reply({ i: 40 }), CALL, "http://127.0.0.1:11434/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer sk-secret-value-123", "Content-Type": "application/json" }, body: '{"q":1}' });
  assert.equal(res.status, 200);
  assert.equal(text, '{"i":40}');
  const entry = latest();
  assert.equal(entry.source, "ping");
  assert.deepEqual(entry.tokens, { input: 40, output: 7, cached: 3, reasoning: 2 });
  // 로컬 모델은 값이 들지 않는다
  assert.equal(entry.costUsd, 0);
  assert.notEqual(entry.firstMs, null);
  const detail = requests.one(entry.id)!;
  assert.match(detail.requestHeaders, new RegExp(`Bearer ${REDACTED.replace(/[[\]]/g, "\\$&")}`));
  assert.ok(!detail.requestHeaders.includes("sk-secret-value-123"));
  assert.equal(detail.requestBody, '{"q":1}');
});

test("거절 응답은 실패로 남기고 까닭(상태 · 저쪽 문구)을 적는다. 가격표에 없으면 가격 모름", async () => {
  await sendLogged(reply({ error: { message: "quota exceeded" } }, 429), { ...CALL, provider: "custom", model: "m" }, "https://llm.example.com/v1/chat/completions", { method: "POST" });
  const entry = latest();
  assert.equal(entry.ok, false);
  assert.equal(entry.status, 429);
  assert.match(entry.error ?? "", /HTTP 429.*quota exceeded/);
  assert.equal(entry.tokens, null);
  assert.equal(entry.costUsd, null);
});

test("2xx 인데 쓸 수 없는 답은 성공으로 두고 까닭을 적는다. 시도 번호 · 장르 · 후보 수도 적는다", async () => {
  await sendLogged(reply({ i: 1 }), { ...CALL, source: "autoplay", attempt: 2, genre: "rock", candidates: 8, explain: () => "판정을 읽지 못함" }, "http://127.0.0.1:11434/v1/chat/completions", { method: "POST" });
  const entry = latest();
  assert.equal(entry.ok, true);
  assert.equal(entry.error, "판정을 읽지 못함");
  assert.deepEqual([entry.attempt, entry.genre, entry.candidates], [2, "rock", 8]);
});

test("닿지 못하면(시간 초과) 끊김으로 남기고 오류를 그대로 던진다", async () => {
  const signal = AbortSignal.abort(new DOMException("timed out", "TimeoutError"));
  const failing = async () => {
    throw new DOMException("timed out", "TimeoutError");
  };
  await assert.rejects(sendLogged(failing, CALL, "http://127.0.0.1:11434/v1/models", { signal }), /timed out/);
  const entry = latest();
  assert.deepEqual([entry.status, entry.ok, entry.aborted], [null, false, true]);
});

test("남기지 않을 답(keep)과 기록을 꺼 둔 때는 남기지 않는다", async () => {
  await sendLogged(reply({}, 404), { ...CALL, source: "models", keep: () => false }, "http://127.0.0.1:11434/v1/models", {});
  config.aiLog.enabled = false;
  await sendLogged(reply({}), CALL, "http://127.0.0.1:11434/v1/models", {});
  assert.equal(requests.size().count, 0);
});
