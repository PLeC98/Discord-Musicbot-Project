// 운영 설정값 문제(rules/rule-problem의 tune-value): 화면은 이름 대신 라벨을 붙여 "라벨 [넣은 값]: 원인"으로 그리고(utils/rule-line), tabsOf는 틀린 값이 든 탭을 찾는다.
// 로그와 터미널은 같은 문제를 로그 언어로 그린다(rules/text)
import { test } from "node:test";
import assert from "node:assert/strict";
import { tabsOf } from "../../../dashboard/src/composables/tunables.ts";
import { ruleLine } from "../../../dashboard/src/utils/rule-line.ts";
import { problemBody } from "../../../src/dashboard/contract/problem.ts";
import { plain, rule, tuneProblem, type RuleProblem } from "../../../src/rules/rule-problem.ts";
import { logRuleLine } from "../../../src/rules/text/index.ts";
import { loadConfig } from "../../../src/config/index.ts";

test("화면은 이름 대신 라벨을 붙이고, 로그는 이름 그대로 그린다", () => {
  const problem = tuneProblem("YTDLP_CLIENT_FAILS", "0", rule("at-least", { min: 1 }));
  assert.equal(ruleLine(problem), "그중 몇 번 실패하면 건너뛸지 [0]: 1 이상이어야 함");
  assert.equal(logRuleLine(problem), "YTDLP_CLIENT_FAILS 값이 잘못됨(0): 1 이상이어야 함");
  // 값에 괄호, 콜론이 들어도 그대로
  assert.equal(ruleLine(tuneProblem("EMBED_COLOR", "#12 (x): y", rule("color"))), "임베드 색 [#12 (x): y]: #RRGGBB 형식의 색이어야 함(예: #2743D2)");
});

test("기동 검사(loadConfig)가 내는 실제 문제", () => {
  const { tuneProblems } = loadConfig({ DISCORD_TOKEN: "t", CLIENT_SECRET: "s", SECRETS_KEY: Buffer.alloc(32, 7).toString("base64") }, { tunables: { YTDLP_CLIENT_FAILS: "abc" } });
  assert.deepEqual(tuneProblems, [tuneProblem("YTDLP_CLIENT_FAILS", "abc", rule("integer"))]);
  assert.equal(ruleLine(tuneProblems[0]!), "그중 몇 번 실패하면 건너뛸지 [abc]: 정수만 쓸 수 있음");
});

test("모르는 이름은 이름 그대로, plain은 글 그대로", () => {
  assert.equal(ruleLine(rule("tune-unknown-key", { key: "NOPE" })), "NOPE: 모르는 설정");
  assert.equal(ruleLine(tuneProblem("NOPE", "1", rule("bool"))), "NOPE [1]: true, false 중 하나여야 함");
  assert.equal(ruleLine(plain("아무 글")), "아무 글");
});

test("저장 거절에서 틀린 값이 든 탭(저장 바가 옮겨 갈 곳). 이름을 모르는 실패면 빈 목록", () => {
  const failed = (problems: RuleProblem[]) => ({ response: { data: problemBody("config-invalid", {}, { errors: problems.map((one) => ({ code: "config-invalid" as const, rule: one })) }) } });
  const reason = rule("integer");
  assert.deepEqual(tabsOf(failed([tuneProblem("YTDLP_CLIENT_FAILS", "x", reason), tuneProblem("YTDLP_CLIENT_WINDOW", "y", reason), tuneProblem("EMBED_COLOR", "z", rule("color"))])), ["youtube", "appearance"]);
  assert.deepEqual(tabsOf(failed([rule("tune-unknown-key", { key: "NOPE" }), tuneProblem("NOPE", "1", reason)])), []);
  assert.deepEqual(tabsOf({ response: { data: problemBody("config-changed") } }), []);
});
