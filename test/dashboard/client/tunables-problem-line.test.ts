// dashboard/src/composables/tunables.ts 의 problemLine: 운영 조절값 저장 거절의 줄을 "라벨 [넣은 값]: 까닭" 으로. 줄 모양은 src/rules/tunables.ts 의 tuneProblemLine 과 맞물린다
import { test } from "node:test";
import assert from "node:assert/strict";
import { problemLine } from "../../../dashboard/src/composables/tunables.ts";
import { tuneProblemLine, parseTuneProblem } from "../../../src/rules/tunables.ts";
import { loadConfig } from "../../../src/config/index.ts";

test("서버가 낸 줄을 라벨과 넣은 값, 까닭으로 다시 엮는다", () => {
  assert.equal(problemLine(tuneProblemLine("YTDLP_CLIENT_FAILS", "0", "1 이상이어야 함")), "그중 몇 번 실패하면 건너뛸지 [0]: 1 이상이어야 함");
  // 까닭과 값에 괄호, 콜론이 들어도 나뉜다
  assert.equal(problemLine(tuneProblemLine("EMBED_COLOR", "#12 (x)", "#RRGGBB 형식의 색이어야 함(예: #2743D2)")), "임베드 색 [#12 (x)]: #RRGGBB 형식의 색이어야 함(예: #2743D2)");
});

test("기동 검사(loadConfig)가 내는 실제 줄도 같은 모양이다", () => {
  const { tuneProblems } = loadConfig({ DISCORD_TOKEN: "t", CLIENT_ID: "1", CLIENT_SECRET: "s", SECRETS_KEY: Buffer.alloc(32, 7).toString("base64") }, { tunables: { YTDLP_CLIENT_FAILS: "abc" } });
  assert.equal(tuneProblems.length, 1);
  assert.deepEqual(parseTuneProblem(tuneProblems[0]!), { key: "YTDLP_CLIENT_FAILS", value: "abc", reason: "정수만 쓸 수 있음" });
  assert.equal(problemLine(tuneProblems[0]!), "그중 몇 번 실패하면 건너뛸지 [abc]: 정수만 쓸 수 있음");
});

test("다른 모양의 줄과 모르는 이름은 그대로 둔다", () => {
  assert.equal(problemLine("NOPE: 모르는 설정"), "NOPE: 모르는 설정");
  assert.equal(parseTuneProblem("아무 글"), null);
});
