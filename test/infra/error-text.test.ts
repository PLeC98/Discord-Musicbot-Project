// src/infra/error-text.ts: 던져진 값의 이름(code), 메시지, 시간 초과 오류

import { test } from "node:test";
import assert from "node:assert/strict";
import { codeOf, timeoutError } from "../../src/infra/error-text.ts";
import { describeError } from "../../src/rules/error-kind.ts";

test("DOMException의 옛 숫자 code(TimeoutError 23, AbortError 20)는 오류 코드로 보지 않는다. 뜻은 name에 있다", () => {
  const timedOut = new DOMException("응답이 10초 동안 없습니다", "TimeoutError");
  assert.equal(codeOf(timedOut), undefined);
  assert.equal(describeError(timedOut), "응답이 10초 동안 없습니다");
  assert.equal(codeOf(new DOMException("그만", "AbortError")), undefined);
  assert.equal(codeOf(Object.assign(new Error("x"), { code: 50013 })), 50013, "디스코드의 숫자 code는 그대로");
});

test("시간 초과 오류: 이름이 TimeoutError인 일반 Error이며 덧붙인 필드(code)를 지닌다", () => {
  const error = timeoutError("본문이 6000ms 동안 오지 않습니다", { code: "STREAM_STALL" });
  assert.ok(error instanceof Error);
  assert.deepEqual([error.name, error.message, codeOf(error)], ["TimeoutError", "본문이 6000ms 동안 오지 않습니다", "STREAM_STALL"]);
});
