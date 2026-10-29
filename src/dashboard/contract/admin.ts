// 서버와 화면이 주고받는 모양: 봇 운영자 패널(/api/admin 아래). 서버는 routes/admin 이 만든다

import type { ProviderSpec } from "../../config/schema/ai-providers.ts";
import type { PromptSection } from "../../config/schema/ai-prompt.ts";
import type { SourceTypeView } from "../../config/schema/genre-sources.ts";
import type { ModelField, ModelGroup, ModelSummary } from "../../config/ai-model-types.ts";
import type { AiDefaults, TestCandidate } from "../../autoplay/assist/types.ts";
import { SAMPLE_CANDIDATES } from "../../autoplay/assist/sample.ts";
import type { CookieSource, YoutubeStatus } from "../../sources/youtube/status-types.ts";
import type { Job } from "../../infra/process-job.ts";
import type { SlotStats } from "../../infra/slot-queue.ts";
import { FIXED_COLORS } from "../../ui/palette.ts";
import type { IconKey } from "../../ui/icons.ts";
import type { AiKeyState, KeyCheck, SecretView, ServiceKeysView } from "../../rules/service-keys.ts";
import type { TunablesView } from "../../rules/tunables.ts";
import type { AgeContent } from "../../config/age-content.ts";

/**
 * 봇 상태 탭(운영자). 3초마다 받는다. 메모리는 MB, 시각은 epoch ms, 시간 길이는 초(uptime) · ms(ageMs).
 * 바깥 서비스(links)는 봇이 실제로 부른 결과로만 매긴다(상태를 보려고 따로 부르지 않는다).
 * history 는 서버가 15초마다 모은 최근 15분이라 화면을 늦게 열어도 그래프가 차 있다
 */
type AdminStatus = {
  /** reconnects: 봇이 켜진 뒤 디스코드 API 연결이 끊겼다 재연결한 횟수. retryAttempt: 지금 끊겨 재연결하려는 중이면 몇 번째 시도인지, 연결돼 있으면 null */
  bot: { tag: string; id: string | null; guilds: number; ping: number; status: number; uptime: number; startedAt: number; version: string; reconnects: number; retryAttempt: number | null };
  /** heapLimit: V8 heap 한도(이 값 대비로 판정한다. heapTotal 은 필요에 따라 늘어나는 값이라 한도가 아니다) */
  node: { version: string; platform: string; arch: string; memory: { heapUsed: number; heapTotal: number; heapLimit: number; rss: number } };
  /** uptime: 운영체제가 켜진 뒤의 초. loadAvg 는 Windows 에서 늘 0 이라 화면은 쓰지 않는다 */
  system: { cpus: number; cpuModel: string; totalMem: number; freeMem: number; loadAvg: number[]; uptime: number };
  /** CPU 사용률(%), 모든 코어를 합쳐 100. 지난 갱신 뒤 쓴 CPU 시간으로 잰다(운영체제와 상관없다) */
  cpu: { bot: number; system: number };
  /** 이벤트 루프 지연(ms). 지난 15초의 p99 와 최대 */
  loop: { p99: number; max: number };
  /** 곡 다운로드(캐시). bytesPerSec 은 지난 15초에 마친 양의 평균, todayBytes 는 오늘(봇 호스트의 자정부터), active 는 지금 다운로드하는 곡 수 */
  download: { bytesPerSec: number; todayBytes: number; active: number };
  /**
   * 업로드(바이트/초, 지난 15초 평균). bot = voice + dashboard: 음성은 보낸 Opus 패킷에 RTP · 암호화 · UDP/IP 헤더를 더한 추정, 대시보드는 로컬이 아닌 곳으로 보낸 HTTP 응답.
   * system: 호스트 전체의 송신(Linux 는 장치가 있는 인터페이스, 없으면 루프백만 뺀다. Windows 는 이더넷 · 무선 종류로, 같은 종류인 가상 스위치 어댑터도 들어간다), 재지 않는 운영체제거나 못 읽었으면 null. todayBytes: 봇이 오늘(봇 호스트의 자정부터) 보낸 양
   */
  upload: { bot: number; voice: number; dashboard: number; system: number | null; todayBytes: number };
  activePlayers: number;
  /**
   * 플레이어가 있는 서버(재생 · 일시정지 · 곡 없이 대기). 행은 쿼리(players · states · q)의 구간만 온다.
   * listeners · queued · counts 는 전부의 합(필터링과 상관없다). matched: 필터링된 수, from: 받은 구간의 시작(당겼으면 보낸 시작보다 작다), rows: 그 구간의 행(삽입 순서)
   */
  players: { voiceConnections: number; queued: number; listeners: number; counts: Record<PlayerState, number>; matched: number; from: number; rows: PlayerRow[] };
  /**
   * 자식 프로세스(ffmpeg · yt-dlp · 헬퍼). 행은 쿼리(procs · sort · desc)로 정렬한 구간만 온다. byLabel 은 프로그램마다의 수, memMb 는 잰 메모리의 합.
   * stray: 잔류 의심 프로세스의 앞(오래된 것부터 STRAY_SHOWN 개), strayMore: 그 밖의 수.
   * ytdlp: yt-dlp 줄(lookup: 사용자가 기다리는 일, background: 다운로드 · 미리 받기)과 지난 1시간 유튜브 영상 정보 추출 수. nearLimit: 막히기 시작하는 수(시간당 약 300)에 가깝다.
   * reused · missed: 지난 1시간 캐시한 영상 정보를 다시 쓴 수 · 캐시가 가득 차 밀려난 뒤 필요해져 다시 추출한 수
   */
  processes: {
    total: number;
    byLabel: Array<{ label: string; count: number }>;
    memMb: number;
    stray: ProcessRow[];
    strayMore: number;
    from: number;
    rows: ProcessRow[];
    ytdlp: { lookup: SlotStats; background: SlotStats; extractedLastHour: number; nearLimit: boolean; reused: number; missed: number };
  };
  youtube: YoutubeStatus;
  links: LinkRow[];
  storage: StorageView;
  /** 지난 1시간 로그의 경고 · 오류 수와 가장 최근 몇 가지. 같은 글은 한 줄로 묶어 count 와 마지막 때(ts)를 단다 */
  recent: { warn: number; error: number; lines: Array<{ ts: number; level: "warn" | "error"; text: string; count: number }> };
  /**
   * ffmpeg · ytdlp.version 은 찾지 못했으면 null. ytdlp.autoUpdate: 스스로 새 버전을 다운로드하는가, nextCheckAt: 다음 확인(예약하지 않았으면 null). dashboardClients: 지금 열린 대시보드 연결 수.
   * launcher: 실행기(pnpm start)로 켰는가. 아니면 다시 실행해 줄 쪽이 없어 대시보드에서 다시 시작하지 못한다.
   * bgutil: 설치된 버전 · 설정한 버전(BGUTIL_VERSION) · 그보다 새 릴리스(없으면 null). 설치돼 있지 않으면 null
   */
  env: { discordJs: string; ffmpeg: string | null; pid: number; launcher: boolean; ytdlp: { version: string | null; autoUpdate: boolean; checkedAt: number | null; nextCheckAt: number | null }; bgutil: { installed: string; target: string; newer: string | null; checkedAt: number | null } | null; commands: { count: number; scope: "global" | "guild" }; dashboardClients: number };
  /**
   * 재생 인코딩 워커(media/encode-pool). max: 워커 수 상한, maxDepth: 큐 깊이의 상한, quota: Linux CPU quota(코어 수, 없으면 null), sessions: 살아 있는 인코딩 세션 수(출력 스트림 하나에 하나라 일시정지한 것도 든다).
   * late · deaths: 봇이 켜진 뒤 워커가 늦어 생긴 누락 프레임 수 · 워커가 죽거나 내린 수. 워커마다 streams: 맡은 세션, depth: 큐 깊이, rttP99: 지난 1초의 응답 시간 p99(ms), cpuPct: CPU(코어 하나 기준, 아직 모르면 null)
   */
  encoding: { max: number; maxDepth: number; quota: number | null; sessions: number; late: number; deaths: number; workers: Array<{ n: number; streams: number; depth: number; rttP99: number; cpuPct: number | null }> };
  history: StatusHistory;
  logLevel: string;
};

const PLAYER_STATES = ["playing", "paused", "idle"] as const;
type PlayerState = (typeof PLAYER_STATES)[number];
/** member: 보는 사람(운영자)이 그 서버 멤버인가. 아니면 화면은 그 서버 화면으로 잇지 않는다. queued: 대기열 곡 수(지금 곡은 빼고) */
type PlayerRow = { guildId: string; name: string; icon: string | null; member: boolean; state: PlayerState; title: string | null; artist: string | null; position: number; duration: number; listeners: number; queued: number };

/** 긴 목록의 구간(시작 · 개수). 한 번에 받는 행은 LIST_WINDOW_MAX 까지 */
type Span = { from: number; count: number };
const LIST_WINDOW_MAX = 200;
const PROCESS_SORTS = ["pid", "label", "job", "age", "mem"] as const;
type ProcessSort = (typeof PROCESS_SORTS)[number];
/**
 * 상태 탭 목록의 쿼리. players · procs: 구간(개수 0 이면 행 없이 개수만), states: 보일 상태, q: 서버 이름 · 곡 · 가수 검색(Q_MAX 자까지).
 * sort · desc: 프로세스 정렬. 작업은 서버 이름 있는 작업 → 나간 서버 → 서버 밖 작업 → 봇 헬퍼 순서, 같은 값끼리는 방향과 상관없이 오래된 것부터
 */
type StatusQuery = { players: Span; states: PlayerState[]; q: string; procs: Span; sort: ProcessSort; desc: boolean };
/** 쿼리가 없을 때의 값(화면의 처음 값과 같다) */
const STATUS_QUERY: StatusQuery = { players: { from: 0, count: 30 }, states: ["playing", "paused"], q: "", procs: { from: 0, count: 30 }, sort: "age", desc: true };
/** 개수만 받는 쿼리(행 없이. 정보 탭 · 다시 시작 기다리기) */
const COUNTS_ONLY: StatusQuery = { ...STATUS_QUERY, players: { from: 0, count: 0 }, procs: { from: 0, count: 0 } };
const Q_MAX = 100;
const STRAY_SHOWN = 20;
/** 쿼리를 요청의 쿼리 문자열 값으로(서버는 list-window 가 읽는다) */
const statusParams = (query: StatusQuery) => ({
  players: `${query.players.from},${query.players.count}`,
  states: query.states.join(","),
  q: query.q,
  procs: `${query.procs.from},${query.procs.count}`,
  sort: query.sort,
  desc: query.desc ? "1" : "0",
});
/**
 * label: 프로그램(ffmpeg · yt-dlp · node). job: 작업, guildId: 그 작업을 실행한 서버(봇 헬퍼 · 서버 밖의 곡 찾기는 null).
 * stray: 재생 · 다음 곡 작업인데 그 서버에 플레이어가 없다(잔류 의심). memMb: 15초마다 잰 값, 아직 못 쟀으면 null
 */
type ProcessRow = { pid: number; label: string; ageMs: number; memMb: number | null; guildId: string | null; guildName: string | null; job: Job | null; stray: boolean };

/** idle: 지난 1시간 부르지 않음, off: 쓰는 설정이 없음(키가 없거나 그 출처를 쓰는 장르가 없다) */
type LinkState = "ok" | "slow" | "fail" | "idle" | "off";
/**
 * group: play(소리를 내는 데 쓴다) · youtube · autoplay(다음 곡 선택). play · youtube 가 실패하면 문제, autoplay 는 주의.
 * error: 마지막 실패의 짧은 까닭("timeout" · "HTTP 503" 등). note: 행에 보이는 설명, hint: 이름에 올리면 보이는 설명(그 서비스를 다루는 방식처럼 늘 같은 것)
 */
type LinkRow = { id: string; group: "play" | "youtube" | "autoplay"; name: string; state: LinkState; latencyMs: number | null; lastOkAt: number | null; error: string | null; note: string | null; hint?: string | null };

/**
 * 저장공간. cache: protectedFiles 는 지금 곡 · 대기열 앞이라 삭제하지 않는 파일, neverPlayed 는 다운로드하고 한 번도 재생하지 않은 파일,
 * failed 는 다운로드 실패로 남은 행(다운로드 실패 · 다운로드 멈춤 · 파일이 사라짐, 다시 다운로드하면 풀린다), lastCleanup 은 봇이 켜진 뒤 마지막으로 실제로 삭제한 정리(없으면 null).
 * disk: 캐시 폴더의 드라이브. db: drive 가 캐시 드라이브와 같으면 드라이브 막대에 한 구간으로 들어간다
 */
type StorageView = {
  cache: { bytes: number; maxBytes: number; files: number; maxFiles: number; protectedFiles: number; neverPlayed: number; failed: number; lastCleanup: { at: number; files: number; bytes: number } | null };
  disk: { drive: string; usedBytes: number; totalBytes: number; minFreeBytes: number };
  db: { bytes: number; drive: string; lookups: number; pins: number; sponsorSegments: number; sessions: number };
};

/**
 * 최근 15분, stepMs 마다 한 점(오래된 것부터). 끝 점이 가장 최근.
 * encodeRtt: 구간마다 가장 느린 인코딩 워커의 응답 시간 p99(ms). encodeLate: 구간 동안 워커가 늦어 생긴 누락 프레임 수. uploadBot · uploadSystem: 업로드(바이트/초, 시스템을 못 읽은 구간은 0)
 */
type StatusHistory = { stepMs: number; endAt: number; playing: number[]; ping: number[]; loopP99: number[]; heapPct: number[]; cpuBot: number[]; cpuSystem: number[]; downloadBps: number[]; encodeRtt: number[]; encodeLate: number[]; uploadBot: number[]; uploadSystem: number[] };

/** 전체 서버 공지의 종류. 화면은 이 키로 라벨을 단다 */
const ANNOUNCE_KINDS = ["maintenance", "update", "alert", "info"] as const;
type AnnounceKind = (typeof ANNOUNCE_KINDS)[number];
const isAnnounceKind = (v: unknown): v is AnnounceKind => ANNOUNCE_KINDS.some((kind) => kind === v);
/**
 * 공지 종류의 모양: 디스코드 임베드의 제목 · 아이콘(ui/icons 의 키) · 왼쪽 색 띠. 봇이 보낼 때와 화면의 미리보기가 같이 쓴다.
 * 색은 경고 수준의 뜻(점검 = 경고, 업데이트 = 완료, 긴급 = 오류, 공지사항 = 공지). 아이콘 타일도 그 색으로 그려 둔다
 */
const ANNOUNCE_STYLE = {
  maintenance: { icon: "announce_maintenance", title: "봇 점검 안내", color: FIXED_COLORS.warning },
  update: { icon: "announce_update", title: "봇 업데이트 안내", color: FIXED_COLORS.done },
  alert: { icon: "announce_alert", title: "긴급 공지", color: FIXED_COLORS.error },
  info: { icon: "announce_info", title: "공지사항", color: FIXED_COLORS.notice },
} as const satisfies Record<AnnounceKind, { icon: IconKey; title: string; color: `#${string}` }>;
/** 공지 길이 상한(디스코드 임베드 설명 필드). 앞뒤 공백을 뺀 길이로 센다(announceBody) */
const ANNOUNCE_MAX = 4096;
/** 보낼 공지 본문: 앞뒤 공백을 뺀다 */
const announceBody = (message: string) => message.trim();
/** 공지의 답. 일부 서버에만 보냈으면 partial */
type BroadcastReply = { success: true; sent: number; failed: number; total: number; partial: boolean };

type AdminGuild = { id: string; name: string; icon: string | null; memberCount: number; hasPlayer: boolean };
/** 봇이 든 서버. guilds 는 쿼리(GuildQuery)로 필터링하고 정렬한 구간만. total: 전부의 수, playing: 재생 중인 서버 수(필터링과 상관없다), matched: 필터링된 수, from: 받은 구간의 시작 */
type AdminGuilds = { total: number; playing: number; matched: number; from: number; guilds: AdminGuild[] };
const GUILD_SORTS = ["name", "name-desc", "members-desc", "members-asc"] as const;
type GuildSort = (typeof GUILD_SORTS)[number];
/** 서버 관리 탭 목록의 쿼리. guilds: 구간, q: 서버 이름 검색(Q_MAX 자까지), playing: 재생 중만, sort: 이름 · 이름 역순 · 멤버 수 두 방향(같으면 서버 ID) */
type GuildQuery = { guilds: Span; q: string; playing: boolean; sort: GuildSort };
const GUILD_QUERY: GuildQuery = { guilds: { from: 0, count: 30 }, q: "", playing: false, sort: "name" };
const guildParams = (query: GuildQuery) => ({ guilds: `${query.guilds.from},${query.guilds.count}`, q: query.q, playing: query.playing ? "1" : "0", sort: query.sort });
type LeaveReply = { success: true; name: string };
/** 슬래시 명령 다시 등록. scope 는 guild(그 서버에만) · global */
type RedeployReply = { success: true; count: number; scope: string; guildId: string | null; names: string[] };
/** 다시 시작을 받았다. 답을 보낸 뒤 봇이 내려가고, 화면은 봇이 다시 뜰 때까지 기다린다 */
type RestartReply = { restarting: true };

/** 운영자 패널의 보기 설정(GET · PUT /api/admin/panel). advanced: 고급 설정 보기. 어느 기기로 열어도 같게 서버에 둔다 */
type PanelPrefs = { advanced: boolean };

/** IP 위치 DB(dashboard/geoip). version: 가진 버전(YYYY-MM), bytes: 그 파일 크기, job: 하는 일, received · total: 받는 중의 바이트(압축된 것), error: 마지막 실패 */
type GeoipStatus = { enabled: boolean; autoUpdate: boolean; version: string | null; bytes: number | null; job: "idle" | "checking" | "downloading"; received: number | null; total: number | null; error: string | null };
/** 확인 결과. latest: 받을 수 있는 가장 새 버전(없으면 null), size: 그 버전의 다운로드 크기 */
type GeoipCheck = { current: string | null; latest: string | null; size: number | null };

/** 설정 파일(genres · status · ai)의 문서. revision: 저장 번호(저장할 때 그대로 돌려보낸다. 그사이 다른 저장이 있었으면 config-changed) */
type ConfigFile = { name: string; data: Record<string, unknown>; revision: number };
type ConfigSaved = { success: true; data: Record<string, unknown>; revision: number };
/** 설정 문서의 기본값(새로 설치했을 때의 값). 편집기가 불러와 저장하지 않은 편집으로 보인다 */
type ConfigDefault = { name: string; data: Record<string, unknown> };

type SourceTypes = { types: SourceTypeView[] };
/** 소스 편집기의 자동완성 */
type Suggestions = { items: Array<{ value: string; hint?: string }> };

/** AI 보조의 지금 상태. 키는 값이 아니라 있는지만 온다 */
type AiState = {
  hasKey: Record<string, boolean>;
  /** 키 상태(키를 쓰는 프로바이더만). moved: 주소 · 리전이 바뀌어 다시 입력해야 함, again: 복호화할 수 없음 */
  keyState: Record<string, AiKeyState>;
  providers: Array<ProviderSpec & { value: string }>;
  pingText: string;
  defaultSections: PromptSection[];
  defaultLine: string;
  /** 비운 입력란이 쓰는 값 */
  settingDefaults: AiDefaults;
};
/** 그 모델이 받는 필드. 프로필이 모르는 프로바이더면 known 이 false 이고 필드 그룹이 없다 */
type AiFields = { known: boolean; fields: ModelField[]; groups?: ModelGroup[]; models: ModelSummary[] };
/** 입력란마다의 본문 토큰. exact 가 아니면 추산 */
type TokensReply = { each: number[]; total: number; by: string; exact: boolean };
type CandidatesReply = { candidates: TestCandidate[] };

/** 판정 테스트 · 미리보기에서 조회한 곡이 없을 때 쓰는 보기 곡. 봇(autoplay/assist)과 화면(조회 안 한 주소 안내)이 같은 것을 본다 */
const AI_SAMPLE_CANDIDATES = SAMPLE_CANDIDATES;
type LinesReply = { lines: string[] };
type KeysReply = { hasKey: Record<string, boolean>; keyState: Record<string, AiKeyState> };
type PromptReply = { sections: PromptSection[] };
/** AI 설정과 프롬프트를 한 번에 저장한 답 */
type AiSaved = { data: Record<string, unknown>; sections: PromptSection[]; revision: number };

/** 유튜브 쿠키. 값은 오지 않는다. hasFile: 저장된 쿠키가 있고 복호화된다 */
type CookieState = { source: CookieSource; hasFile: boolean };

export { AI_SAMPLE_CANDIDATES, ANNOUNCE_KINDS, ANNOUNCE_MAX, ANNOUNCE_STYLE, announceBody, isAnnounceKind, PLAYER_STATES, LIST_WINDOW_MAX, PROCESS_SORTS, STATUS_QUERY, COUNTS_ONLY, Q_MAX, STRAY_SHOWN, statusParams, GUILD_SORTS, GUILD_QUERY, guildParams };
export type {
  AdminStatus,
  PlayerRow,
  PlayerState,
  Span,
  ProcessSort,
  StatusQuery,
  ProcessRow,
  LinkState,
  LinkRow,
  StorageView,
  StatusHistory,
  AnnounceKind,
  BroadcastReply,
  AdminGuild,
  AdminGuilds,
  GuildSort,
  GuildQuery,
  LeaveReply,
  RedeployReply,
  RestartReply,
  PanelPrefs,
  GeoipStatus,
  GeoipCheck,
  AgeContent,
  ConfigFile,
  ConfigDefault,
  ConfigSaved,
  SourceTypes,
  Suggestions,
  AiState,
  AiFields,
  TokensReply,
  CandidatesReply,
  LinesReply,
  KeysReply,
  PromptReply,
  AiSaved,
  CookieState,
  KeyCheck,
  SecretView,
  ServiceKeysView,
  AiKeyState,
  TunablesView,
};
