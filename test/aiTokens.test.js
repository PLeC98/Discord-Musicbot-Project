const test = require("node:test");
const assert = require("node:assert");
const tokens = require("../src/aiTokens");

// OpenAI API 가 이 문장 하나를 39 로 셌다(gpt-6-astra · gpt-5.6-luna · gpt-5 모두 같았다).
const SENTENCE = "세차를 하려고 해. 세차장은 50미터 떨어져 있어. 걸어가야 할까, 운전해서 가야 할까?";

test("메시지 하나의 셈이 저쪽 실측과 맞는다", () => {
  const got = tokens.countMessages([{ content: SENTENCE }], "tik", "openai");
  assert.equal(got.total, 39, "감싸는 몫까지 더한 값");
  assert.equal(got.each[0], 33, "본문만");
});

// 규격마다 메시지를 감싸는 몫이 다르다. 셋 다 실제 응답에서 잰 값이다.
test("요청 토큰은 규격마다 감싸는 몫이 다르다", () => {
  const one = [{ content: SENTENCE }];
  // 제미니는 promptTokenCount 가 본문과 그대로 같았다 — 감싸는 몫이 없다
  const gemini = tokens.countMessages(one, "gemma", "gemini");
  assert.equal(gemini.total, gemini.body, "제미니는 더 붙는 것이 없다");
  assert.equal(gemini.total, 33);

  // OpenAI 는 본문 33 짜리가 prompt_tokens 39 로 왔다
  const openai = tokens.countMessages(one, "tik", "openai");
  assert.equal(openai.body, 33);
  assert.equal(openai.total, 39);
});

// 제미니·젬마는 딴 토크나이저다 — 같은 글을 다르게 센다.
test("gemma 는 tik 과 다르게 센다", () => {
  assert.equal(tokens.count("안녕하세요", "gemma").tokens, 1);
  assert.equal(tokens.count("안녕하세요", "tik").tokens, 2);
  assert.equal(tokens.count("가나다라마바사", "gemma").tokens, 6);
});

// 앤트로픽은 공개 토크나이저가 없다. 어림수라는 것을 숨기지 않는다.
test("어느 기준으로 셌는지 밝힌다", () => {
  assert.deepEqual(tokens.count("a", "tik"), { tokens: 1, by: "tik", exact: true });
  const claude = tokens.count("a", "claude");
  assert.equal(claude.by, "tik", "클로드는 tik 으로 어림한다");
  assert.equal(claude.exact, false);
});

// o200k_base 하나가 4o·4.1·o1·o3·5.x·6 을 다 덮는다 — 그 계열은 어림수가 아니다.
test("추산치인 것은 클로드뿐이다", () => {
  assert.equal(tokens.countMessages([{ content: "안녕" }], "tik").exact, true);
  assert.equal(tokens.countMessages([{ content: "안녕" }], "gemma").exact, true);
  assert.equal(tokens.countMessages([{ content: "안녕" }], "claude").exact, false);
});

test("빈 글은 0 이고, 모르는 모델은 tik 으로", () => {
  assert.equal(tokens.count("", "gemma").tokens, 0);
  assert.equal(tokens.tokenizerFor("anthropic", "없는모델"), "tik");
  assert.equal(tokens.tokenizerFor(null, null), "tik");
});

// 프로필이 어느 토크나이저를 쓰라고 하는지 그대로 따른다.
test("토크나이저는 프로필이 정한다", () => {
  assert.equal(tokens.tokenizerFor("anthropic", "claude-opus-5"), "claude");
  assert.equal(tokens.tokenizerFor("openai", "gpt-6-astra"), "tik");
  assert.equal(tokens.tokenizerFor("vertex-gemini-native", "gemini-3.7-flash"), "gemma");
});
