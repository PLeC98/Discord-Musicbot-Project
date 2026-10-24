/**
 * 토큰 세기. 요청이 몇 토큰짜리인지.
 *
 * 어느 토크나이저를 쓸지는 모델 프로필의 `recommendedTokenizer` 가 정함
 *   tik     OpenAI 계열. gpt-tokenizer (o200k_base). 4o·4.1·o1·o3·5.x·6 이 같은 인코딩
 *   gemma   제미니·젬마. data/gemma-tokenizer.model (SentencePiece BPE)
 *   claude  앤트로픽은 공개 토크나이저가 없고 tik 로 세면 한국어에서 크게 모자란다.
 *           그래서 저쪽 count_tokens 로 측정: 무료이고 정확
 *           키가 없거나 못 부르면 tik 로 떨어지고, 그때만 추산치
 * 토크나이저로 세는 것은 따로 도는 스레드가 맡는다(아래 "세는 스레드")
 */
import { Worker } from "worker_threads";
import * as models from "../../config/ai-models.ts";
import logger from "../../infra/log/logger.ts";
import { messageOf } from "../../rules/error-kind.ts";
import { GEMMA_FILE, readPieces } from "./tokenizers.ts";
import type { Counted } from "./tokenizers.ts";

const log = logger.child({ category: "autoplay" });

/** 셀 메시지. 본문은 content 나 text 에 */
type Message = { role?: string; content?: string; text?: string };

/**
 * 메시지를 역할과 함께 감싸는 데 드는 토큰. 규격마다 다르다(응답이 센 토큰 수에 맞춘 값).
 *
 *   openai     한 메시지 3 + 요청 3
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

// ── 세는 스레드 ────────────────────────────────────────────────────────────
// 세기는 따로 도는 스레드 하나가 맡는다. tik 은 공백 없는 긴 글에서 글 길이의 제곱이 들어(1.6만 자 2.5초)
// 이 스레드에서 세면 그동안 봇 전체가 멈춘다. 스레드는 처음 셀 때 시작하고 계속 쓴다(표를 다시 읽지 않게).

// 맡긴 일 하나의 상한. 넘기면 스레드를 끝내고 다음 세기에 새로 시작한다
const COUNT_TIMEOUT_MS = 10_000;

type Waiting = { resolve: (counted: Counted[]) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
let thread: Worker | null = null;
const waiting = new Map<number, Waiting>();
let lastId = 0;

function spawn() {
  const one = new Worker(new URL("./tokenizer-worker.ts", import.meta.url));
  one.on("message", ({ id, counted, error, problem }: { id: number; counted?: Counted[]; error?: string; problem?: string | null }) => {
    if (problem) log.warn(`젬마 토크나이저 파일을 읽지 못해 tik 로 어림합니다: ${problem}`);
    const job = waiting.get(id);
    if (!job) return;
    waiting.delete(id);
    clearTimeout(job.timer);
    if (counted) job.resolve(counted);
    else job.reject(new Error(error || "토큰을 세지 못했습니다"));
  });
  one.on("error", (error) => {
    log.warn(`토큰 세는 스레드가 멈췄습니다(${messageOf(error)}). 다음 세기에 다시 시작합니다`);
    stop(one, error);
  });
  one.on("exit", () => stop(one, new Error("토큰 세는 스레드가 끝났습니다")));
  one.unref(); // 봇이 끝날 때 붙잡지 않는다. message 를 들으면 다시 붙잡으므로 들은 뒤에 푼다
  return one;
}

// 스레드를 끝내고 맡긴 일을 전부 실패로 돌린다
function stop(one: Worker, error: Error) {
  if (thread !== one) return;
  thread = null;
  for (const job of waiting.values()) {
    clearTimeout(job.timer);
    job.reject(error);
  }
  waiting.clear();
  void one.terminate();
}

/**
 * 글 여러 개를 각각 센다. 따로 도는 스레드에서 세므로 긴 글도 봇을 멈추지 않는다.
 * 상한(맡긴 때부터)을 넘기면 예외. 그때 함께 기다리던 세기도 실패로 돌린다
 */
function countAll(texts: unknown[], tokenizer = "tik", { timeoutMs = COUNT_TIMEOUT_MS }: { timeoutMs?: number } = {}): Promise<Counted[]> {
  const worker = (thread ??= spawn());
  const id = ++lastId;
  const bodies = texts.map((one) => String(one ?? ""));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const chars = bodies.reduce((sum, one) => sum + one.length, 0);
      log.warn(`토큰 세기가 ${timeoutMs / 1000}초를 넘겨 멈춥니다(${tokenizer} · ${chars}자). 다음 세기에 다시 시작합니다`);
      stop(worker, new Error(`토큰 세기가 ${timeoutMs / 1000}초를 넘겼습니다`));
    }, timeoutMs);
    waiting.set(id, { resolve, reject, timer });
    worker.postMessage({ id, texts: bodies, tokenizer });
  });
}

// 글 하나가 몇 토큰인지, 어느 기준으로 셌는지
async function count(text: unknown, tokenizer = "tik"): Promise<Counted> {
  return (await countAll([text], tokenizer))[0];
}

// ── 바깥에서 쓰는 것 ────────────────────────────────────────────────────────

// 그 모델이 쓰는 토크나이저. 모르면 tik 로 어림.
function tokenizerFor(registry: Parameters<typeof models.modelsOf>[0] | null | undefined, model: string | null | undefined): string {
  if (!registry || !model) return "tik";
  const found = models.modelsOf(registry).find((one) => one.modelId === model);
  return found?.tokenizer || "tik";
}

/**
 * 요청 하나가 몇 토큰인지. 메시지를 감싸는 몫까지 더한 값.
 * 본문만 세려면 `count` 를 쓴다(프롬프트 입력란이 그렇게 쓴다).
 */
async function countMessages(messages: Message[] | null | undefined, tokenizer = "tik", dialect = "openai") {
  const wrap = FRAMING[dialect] || FRAMING.openai;
  // 끝의 빈 글은 어느 기준으로 셌는지 알려고 붙인다(메시지가 없어도 알 수 있게)
  const counted = await countAll([...(messages || []).map((one) => one?.content ?? one?.text ?? ""), ""], tokenizer);
  const got = counted.pop() as Counted;
  const each = counted.map((one) => one.tokens);
  const total = each.reduce((sum, one) => sum + one + wrap.perMessage, wrap.perRequest);
  return { total, body: total - wrap.perRequest - (messages || []).length * wrap.perMessage, each, by: got.by, exact: got.exact };
}

/**
 * 앤트로픽에 직접 물어 정확히 측정. 무과금, ~150ms
 * 감싸는 몫까지 포함된 값이 오므로 본문만 필요하면 빼서 사용
 */
async function countByAnthropic(messages: Message[] | null | undefined, { model, apiKey, timeoutMs = 15000, fetch: send = fetch }: { model?: string; apiKey?: string; timeoutMs?: number; fetch?: typeof fetch } = {}): Promise<number | null> {
  if (!apiKey || !model) return null;
  // system 은 본문 맨 위 필드 하나로. 역할을 바꾸기 전에 분리해야 user 로 한 번 더 들어가지 않는다
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
  if (!res.ok) {
    log.debug(`앤트로픽 토큰 세기 실패(어림으로): HTTP ${res.status}`);
    return null;
  }
  const json = (await res.json()) as { input_tokens?: unknown } | null;
  return typeof json?.input_tokens === "number" ? json.input_tokens : null;
}

export { count, countAll, countMessages, countByAnthropic, tokenizerFor, FRAMING, GEMMA_FILE, readPieces as _readPieces };
export type { Message };
