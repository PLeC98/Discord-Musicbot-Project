// src/rules/error-kind.ts, src/rules/text/index.ts: 오류를 규칙 문제(화면)와 로그 문구(로그)로. 화면까지 가는 예외(ruleError)와 로그로만 가는 예외(logTextError)

import { test } from "node:test";
import assert from "node:assert/strict";
import { errorFacts, messageOf, messageWithCode } from "../../src/infra/error-text.ts";
import { errorProblem } from "../../src/rules/error-kind.ts";
import { errorText, logRuleLine, ruleError, ruleLogText, ruleTextFor } from "../../src/rules/text/index.ts";
import { rule, ruleLine } from "../../src/rules/rule-problem.ts";
import { isLogText, logTextError, renderLogText } from "../../src/infra/log/log-text.ts";
import { L } from "../../src/infra/log/text.ts";

const empty = new Error("");
const nameOnly = Object.assign(new Error(""), { name: "AbortError" });
const bare = Object.create(null) as object;
// 오류 글을 정하는 사실의 종류마다 하나씩
const CASES: [unknown, string][] = [
  [new Error("연결이 끊겼습니다"), "message"],
  ["글만 던졌습니다", "message"],
  [42, "thrown"],
  [undefined, "thrown"],
  [nameOnly, "name"],
  [{ code: "ECONNRESET" }, "code"],
  [empty, "at"],
  [{ status: 500 }, "summary"],
  [{}, "unknown"],
  [bare, "unknown"],
];

test("오류 글을 정하는 사실: 메시지, 던진 값, 이름, 코드, 던진 자리, 줄인 내용, 모름", () => {
  assert.deepEqual(
    CASES.map(([error]) => errorFacts(error).kind),
    CASES.map(([, kind]) => kind),
  );
  assert.deepEqual(errorFacts(42), { kind: "thrown", value: "42" });
  assert.deepEqual(errorFacts({ code: "ECONNRESET" }), { kind: "code", code: "ECONNRESET" });
  assert.deepEqual(errorFacts(bare), { kind: "unknown", name: null });
  const at = errorFacts(empty);
  assert.ok(at.kind === "at" && at.name === "Error" && at.at.startsWith("at "));
});

test("메시지가 없는 오류도 규칙 문제로: 기준 언어로 그린 글이 messageOf와 같다", () => {
  const ko = ruleTextFor("ko").problems;
  for (const [error] of CASES) assert.equal(ruleLine(ko, errorProblem(error)), messageOf(error));
  assert.deepEqual(errorProblem(42), rule("error-thrown", { value: "42" }));
  assert.deepEqual(errorProblem({ code: 50013 }), rule("error-code", { code: 50013 }));
  assert.deepEqual(errorProblem(bare), rule("error-no-message", { name: "", at: "" }));
  assert.deepEqual(errorProblem(new Error("바깥 글")), rule("plain", { text: "바깥 글" }));
});

test("로그의 오류 글은 메시지 뒤에 오류 코드. 메시지가 없어 글이 이미 코드면 다시 붙이지 않는다", () => {
  assert.equal(messageWithCode(Object.assign(new Error("권한 없음"), { code: 50013 })), "권한 없음 (50013)");
  assert.equal(messageWithCode({ code: "ECONNRESET" }), "오류 코드 ECONNRESET");
  assert.equal(messageWithCode(new Error("코드 없음")), "코드 없음");
});

test("화면까지 가는 예외: 규칙 문제를 들고, 메시지는 로그 언어의 문장, 로그에는 같은 문제의 서술자로 남는다", () => {
  const problem = rule("tune-value", { key: "LOG_LEVEL", value: "x" }, rule("one-of", { allowed: "a, b" }));
  const cause = new Error("원인");
  const error = ruleError(problem, { code: "TUNABLE_INVALID", cause });
  assert.deepEqual([error.message, error.cause, (error as Error & { code?: string }).code], [logRuleLine(problem), cause, "TUNABLE_INVALID"]);
  assert.equal(errorProblem(error), problem);
  const text = errorText(error);
  assert.ok(isLogText(text));
  assert.deepEqual([text.event, renderLogText(text)], [ruleLogText(problem).event, logRuleLine(problem)]);
});

test("로그로만 가는 예외: 메시지는 서술자를 그린 글이고, 로그에는 그 서술자로 남는다", () => {
  const text = L.config.tunablesApplyFailed({ error: "디스크가 가득 찼습니다" });
  const error = logTextError(text, { code: "APPLY_FAILED" });
  assert.deepEqual([error.message, (error as Error & { code?: string }).code, error.cause], [renderLogText(text), "APPLY_FAILED", undefined]);
  assert.equal(errorText(error), text);
});

test("서술자가 없는 오류의 로그 값: 바깥 글은 그 글, 메시지가 없으면 규칙 문제의 서술자", () => {
  assert.equal(errorText(new Error("바깥 글")), "바깥 글");
  assert.equal(errorText(nameOnly), "AbortError");
  const thrown = errorText(42);
  assert.ok(isLogText(thrown));
  assert.deepEqual([thrown.event, thrown.args], ["rule.error-thrown", { value: "42" }]);
});
