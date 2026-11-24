// src/rules/ai-extra.ts: 추가 파라미터에서 파싱에 실패한 줄은 요청에서 빼고 줄 번호와 이유를 반환한다. 설정 검사(aiWarnings)와 화면이 같은 결과로 막지 않는 경고를 표시한다

import { test } from "node:test";
import assert from "node:assert/strict";
import { readExtra, extraLineProblems } from "../../src/rules/ai-extra.ts";
import { aiProblems, aiWarnings } from "../../src/config/schema/ai.ts";

test("파싱에 실패한 줄은 줄 번호(빈 줄, 주석 포함)와 이유를 남기고, 유효한 줄은 그대로 넣는다", () => {
  const got = readExtra(["# 주석", "이름없음", "", "empty=", "__proto__.x=1", "cfg=json::{깨짐", "header::=값", "ok=1", "header::X-Title=t"].join("\n"));
  assert.deepEqual(got.extra.body, { ok: 1 });
  assert.deepEqual(got.extra.headers, { "X-Title": "t" });
  assert.deepEqual(got.skipped, [
    { line: 2, problem: { code: "ai-extra-no-name", params: { line: 2 } } },
    { line: 4, problem: { code: "ai-extra-no-value", params: { line: 4 } } },
    { line: 5, problem: { code: "ai-extra-bad-name", params: { line: 5, name: "__proto__.x" } } },
    { line: 6, problem: { code: "ai-extra-bad-json", params: { line: 6 } } },
    { line: 7, problem: { code: "ai-extra-no-name", params: { line: 7 } } },
  ]);
});

test("{{none}}은 빈 값이 아니라 필드 제거로 처리한다", () => {
  const got = readExtra("temperature={{none}}\nheader::X-Title={{none}}");
  assert.deepEqual(got.skipped, []);
  assert.deepEqual([got.extra.drop, got.extra.dropHeaders], [["temperature"], ["X-Title"]]);
});

test("파싱에 실패한 줄은 저장을 막지 않는 경고다(aiProblems에는 없고 aiWarnings에 있다)", () => {
  const data = { enabled: true, provider: "openai", model: "m", extra: "ok=1\nempty=" };
  assert.deepEqual(aiProblems(data), []);
  assert.deepEqual(aiWarnings(data), [{ code: "ai-extra-no-value", params: { line: 2 } }]);
  assert.deepEqual(extraLineProblems(undefined), [], "문자열이 아니면 저장 검사가 타입을 본다");
});
