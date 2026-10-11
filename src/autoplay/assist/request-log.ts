// AI 리퀘스트 로그에 남기며 보낸다. AI 보조가 모델과 주고받는 곳(자동재생 판정 · 판정 테스트 · 연결 확인 · 모델 목록)이 모두 이것을 지난다.
// 보내고, 본문 첫 조각이 온 때를 재고, 본문을 글로 다 읽은 뒤 기록하고 { res, text } 를 돌려준다(본문은 이미 읽었으니 부른 쪽은 text 를 쓴다).
// 기록은 저장할 때 키를 가린다(assist/mask: 헤더 값 · 주소 · 본문 · 응답). 비용은 그때의 값표로 센다(config/ai-prices).
// 기록이 꺼져 있거나(AI_LOG_ENABLED) DB 가 열려 있지 않으면(스크립트 · 시험) 남기지 않는다. 기록이 실패해도 요청은 그대로 간다.

import config from "../../config/index.ts";
import * as requests from "../../store/ai-requests.ts";
import * as prices from "../../config/ai-prices.ts";
import * as models from "../../config/ai-models.ts";
import { PROVIDER_SPECS } from "../../config/schema/ai-providers.ts";
import { currentGuild } from "../../infra/guild-context.ts";
import { messageOf } from "../../rules/error-kind.ts";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "autoplay" });
import { mask, safeHeaders } from "./mask.ts";
import * as retry from "./retry.ts";
import type { AiLogSource, AiTokens } from "../../dashboard/contract/ai-log.ts";
import type { Usage } from "./types.ts";

type Send = (input: string, init?: RequestInit) => Promise<Response>;

/** 무엇을 보내는가. tokensOf: 응답(JSON)에서 토큰을 읽는다. explain: 2xx 인데 쓸 수 없는 답의 까닭(판정을 못 읽음). keep: 이 답을 남기는가(모델 목록의 404 다음 주소) */
type Call = {
  source: AiLogSource;
  provider: string;
  model: string;
  attempt?: number;
  genre?: string;
  candidates?: number;
  tokensOf?: (json: unknown) => Usage | null;
  explain?: (text: string) => string | undefined;
  keep?: (res: Response) => boolean;
};

// 기록 실패는 한 번만 알린다(요청마다 경고가 쏟아지지 않게). 다시 되면 또 알릴 수 있게 푼다
let warned = false;

/** 본문을 글로 읽으며 첫 조각이 온 때를 잰다. 흐름이 없는 응답(시험의 가짜)은 그냥 읽는다 */
async function readTimed(res: Response, started: number): Promise<{ text: string; firstMs: number | null }> {
  if (!res.body) return { text: await res.text(), firstMs: null };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let firstMs: number | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    firstMs ??= Date.now() - started;
    text += decoder.decode(value, { stream: true });
  }
  return { text: text + decoder.decode(), firstMs };
}

/** 보여 줄 모델 이름(모델 프로필이 알면). 모르면 빈 글 */
function nameOf(provider: string, model: string): string {
  const registry = PROVIDER_SPECS[provider]?.registry;
  if (!registry || !model) return "";
  return models.modelsOf(registry).find((one) => one.modelId === model)?.name ?? "";
}

/** 응답의 토큰(입력은 캐시를, 출력은 사고를 품는다). 못 읽으면 null */
function tokensFrom(call: Call, text: string): AiTokens | null {
  if (!call.tokensOf) return null;
  try {
    const usage = call.tokensOf(JSON.parse(text));
    return usage ? { input: usage.input, output: usage.output ?? 0, cached: usage.cached ?? 0, reasoning: usage.thoughts ?? 0 } : null;
  } catch {
    return null;
  }
}

type Outcome = { status: number | null; ok: boolean; aborted: boolean; tookMs: number; firstMs: number | null; text: string; error?: string };

function write(call: Call, url: string, init: RequestInit, got: Outcome) {
  if (!config.aiLog.enabled || !requests.isOpen()) return;
  try {
    const tokens = got.ok ? tokensFrom(call, got.text) : null;
    // 모델 목록은 추론을 돌리지 않아 값이 들지 않는다
    const costUsd = call.source === "models" ? 0 : prices.costOf(prices.priceOf(call.provider, call.model), tokens);
    const guildId = call.source === "autoplay" ? currentGuild() : null;
    requests.record(
      {
        at: Date.now() - got.tookMs,
        source: call.source,
        provider: call.provider,
        model: call.model,
        name: nameOf(call.provider, call.model),
        url: mask(url),
        method: init.method ?? "GET",
        status: got.status,
        ok: got.ok,
        aborted: got.aborted,
        tookMs: got.tookMs,
        firstMs: got.firstMs,
        attempt: call.attempt ?? 1,
        ...(guildId ? { guildId } : {}),
        ...(call.genre ? { genre: call.genre } : {}),
        ...(call.candidates ? { candidates: call.candidates } : {}),
        tokens,
        costUsd,
        ...(got.error ? { error: mask(got.error) } : {}),
        requestHeaders: JSON.stringify(safeHeaders(init.headers as Record<string, string> | undefined)),
        requestBody: mask(typeof init.body === "string" ? init.body : ""),
        response: mask(got.text),
      },
      { maxBytes: config.aiLog.maxBytes },
    );
    warned = false;
  } catch (error) {
    if (!warned) log.warn(`AI 리퀘스트 로그를 남기지 못했습니다: ${messageOf(error)}. 요청은 그대로 갑니다`);
    warned = true;
  }
}

/** 실패 응답의 까닭 한 줄(HTTP 상태와 저쪽 문구) */
function failureOf(status: number, text: string) {
  const { key, detail } = retry.summaryOf(status, text);
  return detail ? `${key}: ${detail}` : key;
}

/** 보내고 기록한다. 닿지 못했으면(연결 실패 · 시간 초과) 기록한 뒤 그 오류를 그대로 던진다 */
async function sendLogged(send: Send, call: Call, url: string, init: RequestInit): Promise<{ res: Response; text: string }> {
  const started = Date.now();
  let res: Response | null = null;
  try {
    res = await send(url, init);
    const { text, firstMs } = await readTimed(res, started);
    const error = res.ok ? call.explain?.(text) : failureOf(res.status, text);
    if (call.keep?.(res) ?? true) write(call, url, init, { status: res.status, ok: res.ok, aborted: false, tookMs: Date.now() - started, firstMs, text, ...(error ? { error } : {}) });
    return { res, text };
  } catch (error) {
    const aborted = Boolean(init.signal?.aborted);
    write(call, url, init, { status: res?.status ?? null, ok: false, aborted, tookMs: Date.now() - started, firstMs: null, text: "", error: messageOf(error) });
    throw error;
  }
}

export { sendLogged, readTimed };
export type { Call };
