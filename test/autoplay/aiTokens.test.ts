import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import * as tokens from "../../src/autoplay/assist/tokens.ts";

// OpenAI API 가 이 문장 하나를 39 로 셌다(gpt-6-astra · gpt-5.6-luna · gpt-5 모두 같았다).
const SENTENCE = "세차를 하려고 해. 세차장은 50미터 떨어져 있어. 걸어가야 할까, 운전해서 가야 할까?";

test("메시지 하나의 셈이 저쪽 실측과 맞는다", async () => {
  const got = await tokens.countMessages([{ content: SENTENCE }], "tik", "openai");
  assert.equal(got.total, 39, "감싸는 몫까지 더한 값");
  assert.equal(got.each[0], 33, "본문만");
});

// 규격마다 메시지를 감싸는 몫이 다르다. 셋 다 실제 응답에서 잰 값이다.
test("요청 토큰은 규격마다 감싸는 몫이 다르다", async () => {
  const one = [{ content: SENTENCE }];
  // 제미니는 promptTokenCount 가 본문과 그대로 같았다 — 감싸는 몫이 없다
  const gemini = await tokens.countMessages(one, "gemma", "gemini");
  assert.equal(gemini.total, gemini.body, "제미니는 더 붙는 것이 없다");
  assert.equal(gemini.total, 33);

  // OpenAI 는 본문 33 짜리가 prompt_tokens 39 로 왔다
  const openai = await tokens.countMessages(one, "tik", "openai");
  assert.equal(openai.body, 33);
  assert.equal(openai.total, 39);
});

// 제미니·젬마는 딴 토크나이저다 — 같은 글을 다르게 센다.
test("gemma 는 tik 과 다르게 센다", async () => {
  assert.equal((await tokens.count("안녕하세요", "gemma")).tokens, 1);
  assert.equal((await tokens.count("안녕하세요", "tik")).tokens, 2);
  assert.equal((await tokens.count("가나다라마바사", "gemma")).tokens, 6);
});

// 붙일 때마다 전부 훑는 단순한 셈. 빠른 셈이 이것과 같은 수를 내야 한다
let rank: Map<string, number> | null = null;
function naiveGemma(text: string) {
  if (!rank) {
    const { piece, score } = tokens._readPieces(fs.readFileSync(tokens.GEMMA_FILE));
    rank = new Map(piece.map((one, i) => [one, score[i]]));
  }
  const parts = [...("▁" + text.replace(/ /g, "▁"))];
  for (;;) {
    let bestAt = -1;
    let best = -Infinity;
    for (let i = 0; i < parts.length - 1; i++) {
      const got = rank.get(parts[i] + parts[i + 1]);
      if (got !== undefined && got > best) {
        best = got;
        bestAt = i;
      }
    }
    if (bestAt < 0) return parts.length;
    parts.splice(bestAt, 2, parts[bestAt] + parts[bestAt + 1]);
  }
}

test("gemma 는 단순한 셈과 같은 수를 낸다", async () => {
  const fixed = ["hello world", "안녕하세요, 오늘 들을 곡을 추천해 주세요.", "a".repeat(40), "abab   aaa  bbb", "🎵 IU - 좋은 날 (Good Day) [MV] 😀", "   ", "x\n\ty"];
  const alphabet = "가나다라마바사 abcdefg 곡재생의이는을를 ,.!?\n\t日本語";
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const random = Array.from({ length: 60 }, () => Array.from({ length: 1 + Math.floor(next() * 120) }, () => alphabet[Math.floor(next() * alphabet.length)]).join(""));
  for (const text of [...fixed, ...random]) assert.equal((await tokens.count(text, "gemma")).tokens, naiveGemma(text), JSON.stringify(text));
});

test("gemma 는 긴 글도 곧바로 센다", async () => {
  const long = "가나다라마바사아자차카타파하 곡을 재생해요. The quick brown fox. ".repeat(1500).slice(0, 60000);
  const started = performance.now();
  await tokens.count(long, "gemma");
  assert.ok(performance.now() - started < 2000, "6만 자가 2초 안에");
});

test("tik 은 특수 토큰 글자를 글자 그대로 센다", async () => {
  // 기본값이면 예외를 던진다
  assert.equal((await tokens.count("hi <|endoftext|> there", "tik")).tokens, 9);
});

// tik 은 공백 없는 긴 글에서 느리다. 세는 동안에도 이쪽 타이머는 돌아야 한다
test("세는 동안 이벤트 루프가 멈추지 않는다", async () => {
  await tokens.count("a", "tik"); // 스레드와 표를 먼저 띄운다
  let ticks = 0;
  const ticking = setInterval(() => ticks++, 20);
  const started = performance.now();
  await tokens.count("가".repeat(8000), "tik");
  clearInterval(ticking);
  const took = performance.now() - started;
  assert.ok(took > 200, `느린 글이어야 시험이 된다(${Math.round(took)}ms)`);
  assert.ok(ticks >= (took / 20) * 0.5, `타이머가 ${ticks}번 돌았다(${Math.round(took)}ms)`);
});

test("상한을 넘기면 실패로 답하고 다음 세기는 새로 띄운 스레드가 한다", async () => {
  await assert.rejects(tokens.countAll(["가".repeat(16000)], "tik", { timeoutMs: 100 }), /넘겼습니다/);
  assert.deepEqual(await tokens.countAll(["a", "hello world"], "tik"), [
    { tokens: 1, by: "tik", exact: true },
    { tokens: 2, by: "tik", exact: true },
  ]);
});

// 앤트로픽은 공개 토크나이저가 없다. 어림수라는 것을 숨기지 않는다.
test("어느 기준으로 셌는지 밝힌다", async () => {
  assert.deepEqual(await tokens.count("a", "tik"), { tokens: 1, by: "tik", exact: true });
  const claude = await tokens.count("a", "claude");
  assert.equal(claude.by, "tik", "클로드는 tik 으로 어림한다");
  assert.equal(claude.exact, false);
});

// o200k_base 하나가 4o·4.1·o1·o3·5.x·6 을 다 덮는다 — 그 계열은 어림수가 아니다.
test("추산치인 것은 클로드뿐이다", async () => {
  assert.equal((await tokens.countMessages([{ content: "안녕" }], "tik")).exact, true);
  assert.equal((await tokens.countMessages([{ content: "안녕" }], "gemma")).exact, true);
  assert.equal((await tokens.countMessages([{ content: "안녕" }], "claude")).exact, false);
});

test("빈 글은 0 이고, 모르는 모델은 tik 으로", async () => {
  assert.equal((await tokens.count("", "gemma")).tokens, 0);
  assert.equal(tokens.tokenizerFor("anthropic", "없는모델"), "tik");
  assert.equal(tokens.tokenizerFor(null, null), "tik");
});

// 프로필이 어느 토크나이저를 쓰라고 하는지 그대로 따른다.
test("토크나이저는 프로필이 정한다", () => {
  assert.equal(tokens.tokenizerFor("anthropic", "claude-opus-5"), "claude");
  assert.equal(tokens.tokenizerFor("openai", "gpt-6-astra"), "tik");
  assert.equal(tokens.tokenizerFor("vertex-gemini-native", "gemini-3.7-flash"), "gemma");
});

test("앤트로픽에 물을 때 system 글은 system 칸에 한 번만 싣는다", async () => {
  let sent: { system?: string; messages: Array<{ role: string; content: string }> } | null = null;
  const fake = (async (_url: string, init: { body: string }) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ input_tokens: 7 }), { status: 200 });
  }) as unknown as typeof fetch;
  const got = await tokens.countByAnthropic(
    [
      { role: "system", content: "기준" },
      { role: "user", content: "목록" },
    ],
    { model: "claude-x", apiKey: "k", fetch: fake },
  );
  assert.equal(got, 7);
  assert.equal(sent!.system, "기준");
  assert.deepEqual(sent!.messages, [{ role: "user", content: "목록" }]);
});
