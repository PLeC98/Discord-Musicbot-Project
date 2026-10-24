// AI 리퀘스트 로그 · 사용량 통계의 모양(/api/admin/ai/logs · /api/admin/ai/usage). 봇과 화면이 같이 읽으므로 Node 를 부르지 않는다.
// 기록은 AI 요청 하나(주고받은 것 하나)가 한 줄이다. 재시도는 따로 한 줄씩 남는다(attempt).
// 로그(requests)는 저장 용량을 넘으면 오래된 것부터 삭제되고, 사용량(usage)은 삭제하지 않아 통계는 로그보다 오래 남는다.

import { koMatch } from "../../rules/ko-search.ts";

/** 요청을 보낸 곳: 자동재생 판정 · 판정 테스트 · 연결 확인(유료 핑) · 모델 목록(무료 확인) */
const AI_LOG_SOURCES = ["autoplay", "judge-test", "ping", "models"] as const;
type AiLogSource = (typeof AI_LOG_SOURCES)[number];
const isAiLogSource = (value: unknown): value is AiLogSource => AI_LOG_SOURCES.includes(value as AiLogSource);

/** 목록 한 번에 받는 줄 수 */
const AI_LOG_PAGE = 50;
/** 통계 기간(날). 0 은 전체 */
const AI_USAGE_PERIODS = [7, 30, 90, 0] as const;
type AiUsagePeriod = (typeof AI_USAGE_PERIODS)[number];

/** 토큰. input 은 cached 를 품는다(캐시에서 읽은 입력도 입력이다), output 은 reasoning 을 품는다 */
type AiTokens = { input: number; output: number; cached: number; reasoning: number };

/** 목록의 한 줄(본문 · 응답은 빠진다. 펼칠 때 AiLogDetail 로 받는다) */
type AiLogEntry = {
  id: number;
  /** 보낸 시각(ms) */
  at: number;
  source: AiLogSource;
  provider: string;
  /** 모델 ID. 모델 목록처럼 모델이 없는 요청은 빈 글 */
  model: string;
  /** 보여 줄 모델 이름(모델 프로필이 알면 그 이름, 모르면 빈 글: 화면이 ID 를 쓴다) */
  name: string;
  /** 키는 가려져 있다 */
  url: string;
  method: string;
  /** 응답 상태. 닿기 전에 막혔으면(연결 실패 · 시간 초과) null */
  status: number | null;
  /** 2xx 이고 끝까지 받았다. 판정 답을 못 읽은 것은 ok 이고 error 에 까닭이 있다 */
  ok: boolean;
  /** 시간 초과 · 끊김으로 그만뒀다 */
  aborted: boolean;
  /** 보내고 응답을 다 받기까지 */
  tookMs: number;
  /** 보내고 응답 본문 첫 조각까지. 닿지 못했으면 null */
  firstMs: number | null;
  /** 몇 번째 시도(1부터). 재시도면 2 이상 */
  attempt: number;
  /** 판정이면 그 서버 · 장르 · 후보 수(판정 테스트는 서버가 없다) */
  guildId?: string;
  guildName?: string;
  genre?: string;
  candidates?: number;
  /** 응답에서 읽은 토큰. 못 읽었으면 null */
  tokens: AiTokens | null;
  /** 비용(달러, 기록할 때의 값표로 센 추정). 값표가 0 이거나 로컬 모델이면 0, 값표에 없으면 null(가격 모름) */
  costUsd: number | null;
  /** 오류 · 판정 답을 못 읽은 까닭. 키는 가려져 있다 */
  error?: string;
  /** 필드 하나가 너무 커서 잘렸다 */
  truncated: boolean;
  /** 저장한 크기(바이트) */
  bytes: number;
};

/** 펼친 줄: 주고받은 원문. 헤더 값 · 본문 · 응답 안의 키는 저장할 때 가렸다 */
type AiLogDetail = AiLogEntry & { requestHeaders: string; requestBody: string; response: string };

/** 저장 상태: 남은 줄 수 · 크기 · 저장 용량 · 기록 중인가 */
type AiLogStorage = { count: number; bytes: number; maxBytes: number; enabled: boolean };

/** 목록 한 쪽. total: 남아 있는 전부 · matched: 필터에 맞는 것 */
type AiLogPage = { entries: AiLogEntry[]; total: number; matched: number; storage: AiLogStorage };
/** 실시간으로 온 새 기록(/api/admin/ai/logs/stream 의 message). 저장 상태도 같이 온다(오래된 것이 삭제됐을 수 있다) */
type AiLogPushed = { entry: AiLogEntry; total: number; storage: AiLogStorage };

/** 필터: 출처(비면 전부) · 결과 · 찾는 말(URL · 모델 · 이름 · 오류, 대소문자 무시) */
type AiLogQuery = { sources: AiLogSource[]; result: "" | "ok" | "failed"; q: string };
/** 서버의 목록과 화면의 실시간 줄이 같은 규칙으로 필터링한다 */
function aiLogMatches(entry: AiLogEntry, query: AiLogQuery): boolean {
  if (query.sources.length && !query.sources.includes(entry.source)) return false;
  if (query.result === "ok" && !entry.ok) return false;
  if (query.result === "failed" && entry.ok) return false;
  // 한국어 찾기(조합 중인 글자 · 초성, 대소문자 무시). 봇의 목록 읽기(store/ai-requests 의 ko_match)와 같다
  const q = query.q.trim();
  return !q || [entry.url, entry.model, entry.name, entry.error ?? ""].some((one) => koMatch(one, q));
}

/** 그룹 하나의 합. costUsd 는 값을 아는 것의 합이고 unpriced 는 가격 모름 요청 수. 응답 시간은 성공한 것만 */
type AiUsageBucket = AiTokens & { requests: number; failed: number; costUsd: number; unpriced: number; avgMs: number | null; p95Ms: number | null };

type AiUsageReport = {
  period: AiUsagePeriod;
  total: AiUsageBucket;
  /** 날마다(YYYY-MM-DD, 봇 시간대). 빈 날도 0 으로 있다 */
  daily: Array<AiUsageBucket & { day: string }>;
  /** 모델 + 프로바이더 하나로 묶는다. name 은 보여 줄 이름(모르면 빈 글). 모델이 없는 요청(모델 목록)은 빠진다(출처별에 있다) */
  byModel: Array<AiUsageBucket & { model: string; provider: string; name: string }>;
  bySource: Array<AiUsageBucket & { source: AiLogSource }>;
  /** 판정이 있었던 서버(판정 테스트 · 확인은 서버가 없어 빠진다) */
  byGuild: Array<AiUsageBucket & { guildId: string; guildName: string }>;
};

export { AI_LOG_SOURCES, AI_LOG_PAGE, AI_USAGE_PERIODS, isAiLogSource, aiLogMatches };
export type { AiLogSource, AiUsagePeriod, AiTokens, AiLogEntry, AiLogDetail, AiLogStorage, AiLogPage, AiLogPushed, AiLogQuery, AiUsageBucket, AiUsageReport };
