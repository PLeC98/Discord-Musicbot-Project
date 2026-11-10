// src/autoplay/assist/tokens.ts: AI 요청의 토큰 개수. 실제 API 가 센 수와 맞는가, 세는 동안 이벤트 루프를 막지 않는가
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import * as tokens from "../../src/autoplay/assist/tokens.ts";
import { useModelInfo } from "../helpers/model-info.ts";

// 토크나이저는 모델 프로필이 정한다(테스트용 레지스트리 사본)
useModelInfo({ profiles: true });

// OpenAI API 가 실제로 39 토큰으로 센 문장
const SENTENCE = "세차를 하려고 해. 세차장은 50미터 떨어져 있어. 걸어가야 할까, 운전해서 가야 할까?";

test("메시지 하나의 토큰 개수가 저쪽 실측과 맞는다", async () => {
  const got = await tokens.countMessages([{ content: SENTENCE }], "tik", "openai");
  assert.equal(got.total, 39, "감싸는 몫까지 더한 값");
  assert.equal(got.each[0], 33, "본문만");
});

// 기대값은 모두 실제 응답에서 잰 값이다
test("요청 토큰은 규격마다 감싸는 몫이 다르다", async () => {
  const one = [{ content: SENTENCE }];
  // 제미니의 promptTokenCount 는 본문 토큰 수와 같다
  const gemini = await tokens.countMessages(one, "gemma", "gemini");
  assert.equal(gemini.total, gemini.body, "제미니는 더 붙는 것이 없다");
  assert.equal(gemini.total, 33);

  // OpenAI 는 본문 33 토큰이 prompt_tokens 39 로 온다
  const openai = await tokens.countMessages(one, "tik", "openai");
  assert.equal(openai.body, 33);
  assert.equal(openai.total, 39);
});

test("gemma 는 tik 과 다르게 센다", async () => {
  assert.equal((await tokens.count("안녕하세요", "gemma")).tokens, 1);
  assert.equal((await tokens.count("안녕하세요", "tik")).tokens, 2);
  assert.equal((await tokens.count("가나다라마바사", "gemma")).tokens, 6);
});

// 병합할 때마다 전부 훑는 단순한 계산. 빠른 구현이 이것과 같은 수를 내야 한다
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

test("gemma 는 단순한 계산과 같은 수를 낸다", async () => {
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
  // gpt-tokenizer 기본 설정은 특수 토큰 글자에서 예외를 던진다
  assert.equal((await tokens.count("hi <|endoftext|> there", "tik")).tokens, 9);
});

// tik 은 공백 없는 긴 글에서 느리다. 세는 동안에도 이쪽 타이머는 돌아야 한다
test("세는 동안 이벤트 루프가 멈추지 않는다", async () => {
  await tokens.count("a", "tik"); // 워커 스레드와 병합 표를 먼저 준비해 재는 시간에서 뺀다
  // 타이머 사이의 가장 긴 틈을 잰다. 이 스레드에서 세면 틈이 세는 시간 전체가 된다(횟수로 재면 다른 테스트가 함께 돌 때 흔들린다)
  const measure = async (text: string) => {
    let last = performance.now();
    let widest = 0;
    const ticking = setInterval(() => {
      const now = performance.now();
      widest = Math.max(widest, now - last);
      last = now;
    }, 20);
    const started = performance.now();
    await tokens.count(text, "tik");
    clearInterval(ticking);
    widest = Math.max(widest, performance.now() - last); // 막혔으면 타이머가 한 번도 못 돈다. 마지막 틈까지 센다
    return { took: performance.now() - started, widest };
  };
  // 호스트(커버리지, 부하)와 gpt-tokenizer 버전마다 빠르기가 달라 세는 시간이 200ms 를 넘을 때까지 글을 두 배씩 늘린다. 세기 상한(10초)에는 닿지 않게.
  // 글자는 매번 바꾼다(gpt-tokenizer 가 병합 결과를 캐시해 같은 글은 두 번째가 빠르다. 아래 상한 테스트의 "가" 도 피한다)
  let result = { took: 0, widest: 0 };
  for (let i = 0, size = 2000; size <= 2_048_000; i++, size *= 2) {
    result = await measure(String.fromCharCode("나".charCodeAt(0) + i).repeat(size));
    if (result.took > 200) break;
  }
  const { took, widest } = result;
  assert.ok(took > 200, `느린 글이어야 테스트가 된다(${Math.round(took)}ms)`);
  // 이 스레드에서 세면 틈이 세는 시간과 거의 같다(100%). 다른 테스트 파일과 함께 돌면 CPU 가 꽉 차 타이머가 세는 시간의 절반 넘게 밀리기도 해 80% 로 가른다
  assert.ok(widest < took * 0.8, `타이머 틈이 ${Math.round(widest)}ms 까지 벌어졌다(세기 ${Math.round(took)}ms)`);
});

test("상한을 넘기면 실패로 답하고 다음 세기는 새로 시작한 스레드가 한다", async () => {
  // 상한은 1ms: 20만 자는 어느 버전, 어느 호스트에서도 그보다 오래 걸린다
  await assert.rejects(tokens.countAll(["가".repeat(200_000)], "tik", { timeoutMs: 1 }), /넘김/);
  assert.deepEqual(await tokens.countAll(["a", "hello world"], "tik"), [
    { tokens: 1, by: "tik", exact: true },
    { tokens: 2, by: "tik", exact: true },
  ]);
});

// 앤트로픽은 공개 토크나이저가 없어 tik 으로 추산하고, 추산임을 밝힌다
test("어느 기준으로 셌는지 밝힌다", async () => {
  assert.deepEqual(await tokens.count("a", "tik"), { tokens: 1, by: "tik", exact: true });
  const claude = await tokens.count("a", "claude");
  assert.equal(claude.by, "tik", "클로드는 tik 으로 어림한다");
  assert.equal(claude.exact, false);
});

// o200k_base 하나가 4o, 4.1, o1, o3, 5.x, 6 을 다 덮어 OpenAI 계열은 추산이 아니다
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

test("토크나이저는 프로필이 정한다", () => {
  assert.equal(tokens.tokenizerFor("anthropic", "claude-opus-5"), "claude");
  assert.equal(tokens.tokenizerFor("openai", "gpt-6-astra"), "tik");
  assert.equal(tokens.tokenizerFor("vertex-gemini-native", "gemini-3.7-flash"), "gemma");
});

test("앤트로픽에 물을 때 system 글은 system 필드에 한 번만 싣는다", async () => {
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
