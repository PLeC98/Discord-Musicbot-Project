import test from "node:test";
import assert from "node:assert";
import * as retry from "../../src/autoplay/assist/retry.ts";

test("거절 까닭의 key 는 상태 코드와 오류 이름만, 문구는 detail 로", () => {
  // 규격마다 이름 칸이 다르다(Google status · Anthropic type · OpenAI code)
  assert.deepEqual(retry.summaryOf(429, '{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}'), {
    key: "HTTP 429 RESOURCE_EXHAUSTED",
    detail: "Resource has been exhausted (e.g. check quota).",
  });
  assert.equal(retry.summaryOf(429, '{"type":"error","error":{"type":"rate_limit_error","message":"try again in 20s"}}').key, "HTTP 429 rate_limit_error");
  assert.equal(retry.summaryOf(429, '{"error":{"code":"rate_limit_exceeded","message":"req_abc"}}').key, "HTTP 429 rate_limit_exceeded");
  // JSON 이 아니면 본문을 문구로
  assert.deepEqual(retry.summaryOf(502, "<html>\n Bad   Gateway </html>"), { key: "HTTP 502", detail: "<html> Bad Gateway </html>" });
});

test("다시 해도 소용없는 한도 소진을 가린다", () => {
  assert.equal(retry.exhausted('{"error":{"type":"insufficient_quota"}}'), true);
  assert.equal(retry.exhausted("enforced_spend_limit_reached"), true);
  assert.equal(retry.exhausted('{"error":{"status":"RESOURCE_EXHAUSTED"}}'), false, "구글의 이름은 경합과 한도 소진이 같아 가르지 않는다");
});

test("기다리라는 시간: 헤더 · 제미니 본문, 여럿이면 긴 것", () => {
  const now = Date.parse("2026-09-27T00:00:00Z");
  const headers = (init: Record<string, string>) => new Headers(init);
  assert.equal(retry.adviceMs(headers({ "retry-after": "3" }), "", now), 3000);
  assert.equal(retry.adviceMs(headers({ "retry-after": "Sun, 27 Sep 2026 00:00:10 GMT" }), "", now), 10_000, "날짜");
  assert.equal(retry.adviceMs(headers({ "retry-after-ms": "250" }), "", now), 250);
  assert.equal(retry.adviceMs(null, '{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure"},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"1.5s"}]}}', now), 1500);
  assert.equal(retry.adviceMs(headers({ "retry-after": "2" }), '{"error":{"details":[{"retryDelay":"34s"}]}}', now), 34_000);
  assert.equal(retry.adviceMs(headers({ "retry-after": "soon" }), "not json", now), null, "읽을 수 없으면 없다");
  assert.equal(retry.adviceMs(undefined, "", now), null);
});

test("대기는 두 배씩 늘어 상한에서 멈추고, 절반 아래로는 흔들지 않는다", () => {
  const low = () => 0;
  const high = () => 1;
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((n) => retry.backoffMs(n, 1000, 16000, high)),
    [1000, 2000, 4000, 8000, 16000, 16000],
  );
  assert.deepEqual(
    [1, 2, 6].map((n) => retry.backoffMs(n, 1000, 16000, low)),
    [500, 1000, 8000],
  );
  assert.equal(retry.backoffMs(3, 0, 16000), 0, "처음 대기가 0 이면 늘 0");
});
