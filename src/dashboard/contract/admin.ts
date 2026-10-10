// 서버와 화면이 주고받는 모양: 봇 운영자 패널(/api/admin 아래). 서버는 routes/admin 이 만든다

import type { ProviderSpec } from "../../config/schema/ai-providers.ts";
import type { PromptSection } from "../../config/schema/ai-prompt.ts";
import type { SourceTypeView } from "../../config/schema/genre-sources.ts";
import type { ModelField, ModelGroup, ModelSummary } from "../../config/ai-model-types.ts";
import type { AiDefaults, TestCandidate } from "../../autoplay/assist/types.ts";
import { SAMPLE_CANDIDATES } from "../../autoplay/assist/sample.ts";
import type { CookieSource, YoutubeStatus } from "../../sources/youtube/status-types.ts";
import type { Job } from "../../infra/process-job.ts";
import { FIXED_COLORS } from "../../ui/palette.ts";
import type { AiKeyState, KeyCheck, SecretView, ServiceKeysView } from "../../rules/service-keys.ts";

/**
 * 봇 상태 탭(운영자). 3초마다 받는다. 메모리는 MB, 시각은 epoch ms, 시간 길이는 초(uptime) · ms(ageMs).
 * 바깥 서비스(links)는 봇이 실제로 부른 결과로만 매긴다(상태를 보려고 따로 부르지 않는다).
 * history 는 서버가 15초마다 모은 최근 15분이라 화면을 늦게 열어도 그래프가 차 있다
 */
type AdminStatus = {
  /** reconnects: 봇이 켜진 뒤 디스코드 API 연결이 끊겼다 다시 붙은(재수립) 횟수. retryAttempt: 지금 끊겨 다시 붙으려는 중이면 몇 번째 시도인지, 붙어 있으면 null */
  bot: { tag: string; id: string | null; guilds: number; ping: number; status: number; uptime: number; startedAt: number; version: string; reconnects: number; retryAttempt: number | null };
  /** heapLimit: V8 heap 한도(이 값 대비로 판정한다. heapTotal 은 필요에 따라 늘어나는 값이라 한도가 아니다) */
  node: { version: string; platform: string; arch: string; memory: { heapUsed: number; heapTotal: number; heapLimit: number; rss: number } };
  /** uptime: 운영체제가 켜진 뒤의 초. loadAvg 는 Windows 에서 늘 0 이라 화면은 쓰지 않는다 */
  system: { cpus: number; cpuModel: string; totalMem: number; freeMem: number; loadAvg: number[]; uptime: number };
  /** CPU 사용률(%), 모든 코어를 합쳐 100. 지난 갱신 뒤 쓴 CPU 시간으로 잰다(운영체제와 상관없다) */
  cpu: { bot: number; system: number };
  /** 이벤트 루프 지연(ms). 지난 15초의 p99 와 최대 */
  loop: { p99: number; max: number };
  /** 곡 받기(캐시). bytesPerSec 은 지난 15초에 마친 양의 평균, todayBytes 는 오늘(봇 기계의 자정부터), active 는 지금 받는 곡 수 */
  download: { bytesPerSec: number; todayBytes: number; active: number };
  activePlayers: number;
  /** 플레이어. list 는 플레이어가 있는 서버 전부(재생 · 일시정지 · 곡 없이 대기) */
  players: { voiceConnections: number; queued: number; list: PlayerRow[] };
  /** 자식 프로세스(ffmpeg · yt-dlp · 도우미). oldest 는 오래된 것부터 전부, byLabel 은 프로그램마다의 수 */
  processes: { total: number; byLabel: Array<{ label: string; count: number }>; oldest: ProcessRow[] };
  youtube: YoutubeStatus;
  links: LinkRow[];
  storage: StorageView;
  /** 지난 1시간 로그의 경고 · 오류 수와 가장 최근 몇 가지. 같은 글은 한 줄로 묶어 count 와 마지막 때(ts)를 단다 */
  recent: { warn: number; error: number; lines: Array<{ ts: number; level: "warn" | "error"; text: string; count: number }> };
  /** ffmpeg · ytdlp.version 은 찾지 못했으면 null. ytdlp.autoUpdate: 스스로 새 버전을 받는가, nextCheckAt: 다음 확인(걸어 두지 않았으면 null). dashboardClients: 지금 열린 대시보드 연결 수 */
  env: { discordJs: string; ffmpeg: string | null; pid: number; ytdlp: { version: string | null; autoUpdate: boolean; checkedAt: number | null; nextCheckAt: number | null }; commands: { count: number; scope: "global" | "guild" }; dashboardClients: number };
  history: StatusHistory;
  logLevel: string;
};

/** member: 보는 사람(운영자)이 그 서버 멤버인가. 아니면 화면은 그 서버 화면으로 잇지 않는다. queued: 대기열 곡 수(지금 곡은 빼고) */
type PlayerRow = { guildId: string; name: string; icon: string | null; member: boolean; state: "playing" | "paused" | "idle"; title: string | null; artist: string | null; position: number; duration: number; listeners: number; queued: number };
/**
 * label: 프로그램(ffmpeg · yt-dlp · node). job: 하는 일, guildId: 그 일을 띄운 서버(봇 도우미 · 서버 밖의 곡 찾기는 null).
 * stray: 재생 · 다음 곡 일인데 그 서버에 플레이어가 없다(남은 프로세스일 수 있다). memMb: 15초마다 잰 값, 아직 못 쟀으면 null
 */
type ProcessRow = { pid: number; label: string; ageMs: number; memMb: number | null; guildId: string | null; guildName: string | null; job: Job | null; stray: boolean };

/** idle: 지난 1시간 부르지 않음, off: 쓰는 설정이 없음(키가 없거나 그 출처를 쓰는 장르가 없다) */
type LinkState = "ok" | "slow" | "fail" | "idle" | "off";
/**
 * group: play(소리를 내는 데 쓴다) · youtube · autoplay(다음 곡 고르기). play · youtube 가 실패하면 문제, autoplay 는 주의.
 * error: 마지막 실패의 짧은 까닭("timeout" · "HTTP 503" 등). note: 줄에 보이는 설명, hint: 이름에 올리면 보이는 설명(그 서비스를 다루는 방식처럼 늘 같은 것)
 */
type LinkRow = { id: string; group: "play" | "youtube" | "autoplay"; name: string; state: LinkState; latencyMs: number | null; lastOkAt: number | null; error: string | null; note: string | null; hint?: string | null };

/**
 * 저장공간. cache: protectedFiles 는 지금 곡 · 대기열 앞이라 지우지 않는 파일, neverPlayed 는 받고 한 번도 틀지 않은 파일,
 * failed 는 받기 실패로 남은 줄(받다 실패 · 받다 멈춤 · 파일이 사라짐, 다시 받으면 풀린다), lastCleanup 은 봇이 켜진 뒤 마지막으로 실제로 지운 정리(없으면 null).
 * disk: 캐시 폴더의 드라이브. db: drive 가 캐시 드라이브와 같으면 드라이브 막대에 조각으로 들어간다
 */
type StorageView = {
  cache: { bytes: number; maxBytes: number; files: number; maxFiles: number; protectedFiles: number; neverPlayed: number; failed: number; lastCleanup: { at: number; files: number; bytes: number } | null };
  disk: { drive: string; usedBytes: number; totalBytes: number; minFreeBytes: number };
  db: { bytes: number; drive: string; lookups: number; sponsorSegments: number; sessions: number };
};

/** 최근 15분, stepMs 마다 한 점(오래된 것부터). 끝 점이 가장 최근 */
type StatusHistory = { stepMs: number; endAt: number; playing: number[]; ping: number[]; loopP99: number[]; heapPct: number[]; cpuBot: number[]; cpuSystem: number[]; downloadBps: number[] };

/** 전체 서버 공지의 종류. 화면은 이 키로 이름표를 단다 */
const ANNOUNCE_KINDS = ["maintenance", "update", "alert", "info"] as const;
type AnnounceKind = (typeof ANNOUNCE_KINDS)[number];
const isAnnounceKind = (v: unknown): v is AnnounceKind => ANNOUNCE_KINDS.some((kind) => kind === v);
/**
 * 공지 종류의 모양: 디스코드 임베드의 제목 · 이모지 · 왼쪽 색 띠. 봇이 보낼 때와 화면의 미리보기가 같이 쓴다.
 * 색은 경고 수준의 뜻(점검 = 경고, 업데이트 = 완료, 긴급 = 오류, 공지사항 = 공지)
 */
const ANNOUNCE_STYLE: Record<AnnounceKind, { emoji: string; title: string; color: `#${string}` }> = {
  maintenance: { emoji: "🔧", title: "봇 점검 안내", color: FIXED_COLORS.warning },
  update: { emoji: "🆕", title: "봇 업데이트 안내", color: FIXED_COLORS.done },
  alert: { emoji: "⚠️", title: "긴급 공지", color: FIXED_COLORS.error },
  info: { emoji: "ℹ️", title: "공지사항", color: FIXED_COLORS.notice },
};
/** 공지 길이 상한(디스코드 임베드 설명 칸). 앞뒤 공백을 뺀 길이로 센다(announceBody) */
const ANNOUNCE_MAX = 4096;
/** 보낼 공지 본문: 앞뒤 공백을 뺀다 */
const announceBody = (message: string) => message.trim();
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
  /** 키 상태(키를 쓰는 프로바이더만). moved: 주소 · 리전이 바뀌어 다시 넣어야 함, again: 풀 수 없음 */
  keyState: Record<string, AiKeyState>;
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

/** 판정 테스트 · 미리보기에서 조회한 곡이 없을 때 쓰는 보기 곡. 봇(autoplay/assist)과 화면(조회 안 한 주소 안내)이 같은 것을 본다 */
const AI_SAMPLE_CANDIDATES = SAMPLE_CANDIDATES;
type LinesReply = { lines: string[] };
type KeysReply = { hasKey: Record<string, boolean>; keyState: Record<string, AiKeyState> };
type PromptReply = { sections: PromptSection[] };
/** AI 설정과 프롬프트를 한 번에 저장한 답 */
type AiSaved = { data: Record<string, unknown>; sections: PromptSection[] };

/** 유튜브 쿠키. 값은 오지 않는다. hasFile: 넣어 둔 쿠키가 있고 풀린다 */
type CookieState = { source: CookieSource; hasFile: boolean };

export { AI_SAMPLE_CANDIDATES, ANNOUNCE_KINDS, ANNOUNCE_MAX, ANNOUNCE_STYLE, announceBody, isAnnounceKind };
export type { AdminStatus, PlayerRow, ProcessRow, LinkState, LinkRow, StorageView, StatusHistory, AnnounceKind, BroadcastReply, AdminGuilds, LeaveReply, RedeployReply, ResetReply, ConfigFile, ConfigSaved, SourceTypes, Suggestions, AiState, AiFields, TokensReply, CandidatesReply, LinesReply, KeysReply, PromptReply, AiSaved, CookieState, KeyCheck, SecretView, ServiceKeysView, AiKeyState };
