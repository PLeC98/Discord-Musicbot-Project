// AI 보조의 모양. 판정 · 확인 · 미리보기가 돌려주는 것은 대시보드가 그대로 받으므로 Node 를 부르지 않는 여기에 둔다

import type { PromptSection } from "../../config/schema/ai-prompt.ts";

/** 후보 목록 한 줄을 어떻게 적을지(AI 설정의 list) */
type ListFormat = { lineFormat?: string };
/**
 * AI 설정 한 벌. 저장된 것이거나 대시보드의 초안이다. 여기서 읽는 필드만.
 * 수 필드는 글자일 수 있어 쓰는 곳에서 Number 로 바꾼다
 */
type AiSettings = {
  /** 켜고 끄기. false 면 부르지 않는다. 없으면 provider 로 판단한다 */
  enabled?: boolean;
  provider?: string;
  model?: string;
  baseUrl?: string;
  project?: string;
  location?: string;
  timeoutMs: number | string;
  batchSize: number | string;
  skipConfident: boolean;
  retries: number | string;
  totalTimeoutMs: number | string;
  retryTimeouts: boolean;
  retryDelayMs: number | string;
  retryDelayMaxMs: number | string;
  retryStatus: number[];
  extra?: string;
  hideModels?: unknown;
  list?: ListFormat;
  /** 모델마다 선택한 값 */
  params?: Record<string, Record<string, unknown>>;
  prompt?: PromptSection[];
};
/** 비운 필드가 쓰는 값(DEFAULTS). 대시보드가 흐리게 보여 준다 */
type AiDefaults = { timeoutMs: number; batchSize: number; skipConfident: boolean; retries: number; totalTimeoutMs: number; retryTimeouts: boolean; retryDelayMs: number; retryDelayMaxMs: number; retryStatus: number[] };
/** 판정할 후보. 길이 필드 이름은 후보(durationSec)와 트랙(duration)이 다르다 */
type Judged = { title?: string | null; durationSec?: number | null; duration?: number | null };
/** 판정 테스트용 후보. 못 읽었으면 error */
type TestCandidate = Judged & { url?: string; thumbnail?: string | null; channel?: string | null; error?: string };
/** 저쪽에 보내는 메시지 하나 */
type Wire = { role: string; content: string };
/** 화면에 보이는 메시지. at 은 원래 섹션 번호(라벨용, 저쪽에는 보내지 않는다) */
type ShownMessage = Wire & { at: number };
type Body = Record<string, unknown>;
/** 토큰. input 은 캐시에서 읽은 입력(cached)을 품고, output 은 사고(thoughts)를 품는다 */
type Usage = { input: number; output: number | null; thoughts: number | null; cached: number | null };
/** 센 토큰. each 는 메시지마다(저쪽에 물어 셌으면 없다), body 는 감싸는 몫을 뺀 본문 */
type TokenCount = { total: number; body: number; each?: number[]; by: string; exact: boolean };

/** 나갈 것을 만들어만 본 것. 헤더의 키 값은 가려져 있다 */
type Preview = { url: string; headers: Record<string, string>; body: Body; messages: ShownMessage[]; tokens: TokenCount | null; problems: string[] };

/** 판정 테스트의 답. 나간 것 · 온 것 · 곡별 판정 */
type JudgeResult = Preview & {
  status: number | null;
  response: string;
  verdicts: Array<{ title?: string | null; url?: string; song: boolean | null; fits: boolean | null }> | null;
  usage?: Usage | null;
  tookMs?: number;
};

/** 모델 목록 확인(무료). 저쪽에 닿기 전에 막혔으면 reason 만 있다 */
/** preset: 저쪽 목록이 아니라 다운로드해 둔 모델 프로필(config/ai-models)로 채운 목록이다(저쪽에 묻지 못했다) */
type ModelsCheck = { ok: boolean; reason?: string; url?: string; status?: number | null; models?: string[]; hiddenCount?: number; preset?: boolean; response?: string; tookMs?: number };

/** 짧은 물음 하나로 확인(유료). 저쪽에 닿기 전에 막혔으면 reason 만 있다 */
type PingCheck = { ok: boolean; reason?: string; url?: string; headers?: Record<string, string>; body?: Body; status?: number | null; response?: string; answer?: string; tookMs?: number };

export type { ListFormat, AiSettings, AiDefaults, Judged, TestCandidate, Wire, ShownMessage, Body, Usage, TokenCount, Preview, JudgeResult, ModelsCheck, PingCheck };
