// 서버와 화면이 주고받는 모양: 봇 운영자 패널(/api/admin 아래). 서버는 routes/admin 이 만든다

import type { ProviderSpec } from "../../config/schema/ai-providers.ts";
import type { PromptSection } from "../../config/schema/ai-prompt.ts";
import type { SourceTypeView } from "../../config/schema/genre-sources.ts";
import type { ModelField, ModelGroup, ModelSummary } from "../../config/ai-model-types.ts";
import type { AiDefaults, TestCandidate } from "../../autoplay/assist/types.ts";
import type { CookieSource, YoutubeStatus } from "../../sources/youtube/status-types.ts";

/** 봇 · Node · 시스템 상태. 메모리는 MB, uptime 은 봇이 켜진 뒤의 시간. logLevel 은 서버가 보내고 있는 가장 낮은 레벨 */
type AdminStatus = {
  bot: { tag: string; id: string | null; guilds: number; ping: number; status: number; uptime: { days: number; hours: number; minutes: number; seconds: number } };
  node: { version: string; platform: string; arch: string; memory: { heapUsed: number; heapTotal: number; rss: number } };
  system: { cpus: number; totalMem: number; freeMem: number; loadAvg: number[] };
  activePlayers: number;
  /** 자식 프로세스(ffmpeg · yt-dlp). oldest 는 오래된 것부터 몇 개 */
  processes: { total: number; byLabel: Array<{ label: string; count: number }>; oldest: Array<{ pid: number; label: string; ageMs: number }> };
  youtube: YoutubeStatus;
  logLevel: string;
};

/** 전체 서버 공지의 종류. 화면은 이 키로 이름표를 단다 */
const ANNOUNCE_KINDS = ["maintenance", "update", "alert", "info"] as const;
type AnnounceKind = (typeof ANNOUNCE_KINDS)[number];
const isAnnounceKind = (v: unknown): v is AnnounceKind => ANNOUNCE_KINDS.some((kind) => kind === v);
/** 공지 길이 상한(디스코드 임베드 설명 칸). 앞뒤 공백을 뺀 길이로 센다 */
const ANNOUNCE_MAX = 4096;
/** 공지의 답. 일부 서버에만 보냈으면 partial */
type BroadcastReply = { success: true; sent: number; failed: number; total: number; partial: boolean };

/** 봇이 든 서버 전부 */
type AdminGuilds = { guilds: Array<{ id: string; name: string; icon: string | null; memberCount: number; hasPlayer: boolean }> };
type LeaveReply = { success: true; name: string };
/** 슬래시 명령 다시 등록. scope 는 guild(그 서버에만) · global */
type RedeployReply = { success: true; count: number; scope: string; guildId: string | null; names: string[] };
/** 캐시 초기화. kept 는 잠겨 있어(재생 중 등) 남긴 파일 수 */
type ResetReply = { success: true; removed: number; kept: number; freedBytes: number; fileCountBefore: number };

/** 설정 파일(genres · status · ai) 읽기와 저장 */
type ConfigFile = { name: string; data: Record<string, unknown> };
type ConfigSaved = { success: true; data: Record<string, unknown> };

type SourceTypes = { types: SourceTypeView[] };
/** 소스 편집기의 자동완성 */
type Suggestions = { items: Array<{ value: string; hint?: string }> };

/** AI 보조의 지금 상태. 키는 값이 아니라 있는지만 온다 */
type AiState = {
  hasKey: Record<string, boolean>;
  providers: Array<ProviderSpec & { value: string }>;
  pingText: string;
  defaultSections: PromptSection[];
  defaultLine: string;
  /** 비운 칸이 쓰는 값 */
  settingDefaults: AiDefaults;
};
/** 그 모델이 받는 칸. 프로필이 모르는 프로바이더면 known 이 false 이고 칸 묶음이 없다 */
type AiFields = { known: boolean; fields: ModelField[]; groups?: ModelGroup[]; models: ModelSummary[] };
/** 칸마다의 본문 토큰. exact 가 아니면 어림 */
type TokensReply = { each: number[]; total: number; by: string; exact: boolean };
type CandidatesReply = { candidates: TestCandidate[] };
type LinesReply = { lines: string[] };
type KeysReply = { hasKey: Record<string, boolean> };
type PromptReply = { sections: PromptSection[] };
/** AI 설정과 프롬프트를 한 번에 저장한 답 */
type AiSaved = { data: Record<string, unknown>; sections: PromptSection[] };

/** 유튜브 쿠키. 값은 오지 않는다. inFlight 가 0 이 아니면 지금 덮어써도 도는 yt-dlp 가 끝나며 되돌린다 */
type CookieState = { source: CookieSource; hasFile: boolean; inFlight: number };

export { ANNOUNCE_KINDS, ANNOUNCE_MAX, isAnnounceKind };
export type { AdminStatus, AnnounceKind, BroadcastReply, AdminGuilds, LeaveReply, RedeployReply, ResetReply, ConfigFile, ConfigSaved, SourceTypes, Suggestions, AiState, AiFields, TokensReply, CandidatesReply, LinesReply, KeysReply, PromptReply, AiSaved, CookieState };
