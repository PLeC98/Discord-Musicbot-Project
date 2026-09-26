/**
 * 토큰 세기. 요청이 몇 토큰짜리인지.
 *
 * 어느 토크나이저를 쓸지는 모델 프로필의 `recommendedTokenizer` 가 정함
 *   tik     OpenAI 계열. gpt-tokenizer (o200k_base). 4o·4.1·o1·o3·5.x·6 이 같은 인코딩
 *   gemma   제미니·젬마. data/gemma-tokenizer.model (SentencePiece BPE)
 *   claude  앤트로픽은 공개 토크나이저가 없다. tik 로 세면 한국어에서 35% 가 모자람
 *           (실측 50 vs 33). 그래서 저쪽 count_tokens 로 측정: 무료이고 정확
 *           키가 없거나 못 부르면 tik 로 떨어지고, 그때만 추산치
 */
import * as models from "../../config/aiModels.ts";
import { count, GEMMA_FILE, readPieces } from "./tokenizers.ts";

/** 셀 메시지. 본문은 content 나 text 에 */
type Message = { role?: string; content?: string; text?: string };

/**
 * 메시지를 역할과 함께 감싸는 데 드는 토큰. 규격마다 다르고 실측으로 잡았다.
 *
 *   openai     한 메시지 3 + 요청 3. 본문 33 짜리가 prompt_tokens 39 로 왔다
 *   gemini     0. promptTokenCount 가 본문 토큰과 그대로 같았다
 *              (countTokens 엔드포인트는 1 을 더 세는데 그 값은 청구되지 않는다)
 *   anthropic  세대마다 다르다. 5(4.8~5) · 10(4.7) · 6(4.5~4.6)
 */
const FRAMING: Record<string, { perMessage: number; perRequest: number }> = {
  openai: { perMessage: 3, perRequest: 3 },
  gemini: { perMessage: 0, perRequest: 0 },
  vertex: { perMessage: 0, perRequest: 0 },
  anthropic: { perMessage: 0, perRequest: 6 },
};

// ── 바깥에서 쓰는 것 ────────────────────────────────────────────────────────

// 그 모델이 쓰는 토크나이저. 모르면 tik 로 어림.
function tokenizerFor(registry: Parameters<typeof models.modelsOf>[0] | null | undefined, model: string | null | undefined): string {
  if (!registry || !model) return "tik";
  const found = models.modelsOf(registry).find((one) => one.modelId === model);
  return found?.tokenizer || "tik";
}

/**
 * 요청 하나가 몇 토큰인지. 메시지를 감싸는 몫까지 더한 값.
 * 본문만 세려면 `count` 를 쓴다(프롬프트 칸이 그렇게 쓴다).
 */
async function countMessages(messages: Message[] | null | undefined, tokenizer = "tik", dialect = "openai") {
  const wrap = FRAMING[dialect] || FRAMING.openai;
  let total = wrap.perRequest;
  const each: number[] = [];
  for (const one of messages || []) {
    const got = await count(one?.content ?? one?.text ?? "", tokenizer);
    each.push(got.tokens);
    total += got.tokens + wrap.perMessage;
  }
  const got = await count("", tokenizer);
  return { total, body: total - wrap.perRequest - (messages || []).length * wrap.perMessage, each, by: got.by, exact: got.exact };
}

/**
 * 앤트로픽에 직접 물어 정확히 측정. 무과금, ~150ms
 * 감싸는 몫까지 포함된 값이 오므로 본문만 필요하면 빼서 사용
 */
async function countByAnthropic(messages: Message[] | null | undefined, { model, apiKey, timeoutMs = 15000, fetch: send = fetch }: { model?: string; apiKey?: string; timeoutMs?: number; fetch?: typeof fetch } = {}): Promise<number | null> {
  if (!apiKey || !model) return null;
  // system 은 본문 맨 위 칸 하나로. 역할을 바꾸기 전에 갈라야 user 로 한 번 더 들어가지 않는다
  const all = messages || [];
  const body: { model: string; messages: Array<{ role: string; content: string }>; system?: string } = {
    model,
    messages: all
      .filter((one) => one.role !== "system")
      .map((one) => ({ role: one.role === "assistant" ? "assistant" : "user", content: String(one.content ?? one.text ?? "") }))
      .filter((one) => one.content),
  };
  const system = all
    .filter((one) => one.role === "system")
    .map((one) => one.content ?? one.text)
    .join(String.fromCharCode(10, 10));
  if (system) body.system = system;
  if (!body.messages.length) return null;

  const res = await send("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { input_tokens?: unknown } | null;
  return typeof json?.input_tokens === "number" ? json.input_tokens : null;
}

export { count, countMessages, countByAnthropic, tokenizerFor, FRAMING, GEMMA_FILE, readPieces as _readPieces };
export type { Message };
