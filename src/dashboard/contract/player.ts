// 서버와 화면이 주고받는 모양: 재생(/api/guilds/:id/player 아래). 서버는 dashboard/player-view, routes/player가 만든다

import type { Loop } from "../../rules/loop-cycle.ts";
import type { Hold } from "../../rules/holds.ts";
import type { More, MoreOutcome } from "../../rules/more-choices.ts";
import type { TrackInfo } from "../../player/track.ts";

/** 반복 요청의 값(본문 { mode }). 끈 것은 "off"로 보낸다 */
const LOOP_MODES = { off: false, track: "track", queue: "queue" } as const satisfies Record<string, Loop>;
type LoopMode = keyof typeof LOOP_MODES;
/** 받은 반복 요청 값을 반복 모드로. 모르는 값이면 undefined */
const loopOf = (mode: unknown): Loop | undefined => (typeof mode === "string" && Object.hasOwn(LOOP_MODES, mode) ? LOOP_MODES[mode as LoopMode] : undefined);
/** 반복 모드를 보낼 값으로 */
const modeOf = (loop: Loop): LoopMode => (loop === false ? "off" : loop);

/** 대기열은 앞에서부터 이만큼만 실어 보낸다. 화면이 더 필요하면 ?queue=n으로 늘려 요청하거나 /player/queue로 다음 구간을 받는다(한 번에 QUEUE_WINDOW_MAX까지) */
const QUEUE_PAGE = 100;
const QUEUE_WINDOW_MAX = 1000;

/** 곡을 넣은 사람. 화면은 id로 자기 곡인지만 본다 */
type RequesterRef = { id: string | null } | null;

/** 대기열의 한 곡. entry는 대기열 ID(빼기, 옮기기가 가리키는 것), index는 지금 순번 */
type QueueTrackView = Pick<TrackInfo, "title" | "artist" | "duration" | "thumbnail" | "platform"> & {
  index: number;
  entry: number | null;
  isLive: boolean;
  /** 시작 전 라이브(예정된 방송, 최초 공개). isLive도 참이다 */
  upcoming: boolean;
  /** 자동재생이 미리 선택해 둔 곡 */
  autoplay: boolean;
  requestedBy: RequesterRef;
};

/** SponsorBlock 자동 스킵 구간(초) */
type SponsorSegmentView = { start: number; end: number; categories: string[] };

/** 지금 곡. currentTime은 초 */
type PlayingView = Pick<TrackInfo, "title" | "artist" | "duration" | "thumbnail" | "platform"> & {
  entry: number | null;
  /** 진행 막대의 분모(지금 트는 음원의 길이, 초). 글자로 보이는 길이는 duration. 모르면 null(막대도 duration) */
  length: number | null;
  url: string;
  isLive: boolean;
  currentTime: number;
  requestedBy: RequesterRef;
  sponsorSegments: SponsorSegmentView[];
  highlightAt: number | null;
};

/**
 * 재생 상태. 조작은 모두 이 모양으로 응답한다. boot, seq는 만든 순서(늦게 온 옛 응답이 새 상태를 덮지 않게).
 * 플레이어가 없으면 볼륨, 반복, 기록, 자동재생 필드가 없다
 */
type PlayerState = {
  boot: number;
  seq: number;
  playing: boolean;
  /** 소리가 멈춰 있어야 하나(사람이 일시정지했거나 억제 사유가 있다) */
  paused: boolean;
  /** 사람이 일시정지했나. 재생 버튼은 이것을 뒤집는다(억제로 소리가 멈춰 있어도 이것이 거짓이면 일시정지 버튼) */
  userPaused: boolean;
  /** 소리를 함께 멈추고 있는 억제 사유(rules/holds, 보여 줄 첫째). 없으면 null */
  heldBy: Hold | null;
  volume?: number;
  loop?: Loop;
  currentTrack: PlayingView | null;
  hasPrevious?: boolean;
  /** 이전 곡을 누르면 재생할 곡의 앨범아트(없거나 이전 곡이 없으면 null). 휴대폰에서 앨범아트를 밀 때 옆 카드에 미리 표시한다 */
  previousThumbnail?: string | null;
  autoplay?: boolean;
  /** 자동재생 장르의 식별자, 보여 줄 이름(꺼져 있으면 null) */
  autoplayGenre?: string | null;
  autoplayGenreLabel?: string | null;
  /** 대기열에 라이브가 있다(반복을 켤 수 없다). 대기열 창 밖의 곡도 본다 */
  hasLive: boolean;
  queue: QueueTrackView[];
  queueTotal: number;
};

/** 자동재생 장르 목록(장르 설정의 순서, 디스코드 장르 메뉴와 같다). id는 선택할 때 보내는 식별자, label은 보여 줄 이름 */
type AutoplayGenres = { genres: Array<{ id: string; label: string; emoji: string | null }> };

/** 봇, 나의 음성 채널 */
type VoiceFlags = { botInVoice: boolean; userInVoice: boolean; sameVoice: boolean };

/** 상태 읽기, 부르기의 응답. 재생 상태에 음성 채널과 이 사용자가 할 수 있는 것을 더한다(화면 표시용, 막는 것은 경로마다 서버가 다시 본다) */
type PlayerRead = PlayerState & VoiceFlags & { hasPlayer: boolean; canControl: boolean; canAdd: boolean; hasSettings: boolean; userId: string };

/** 대기열 더 보기 */
type QueuePage = { items: QueueTrackView[]; total: number };

/**
 * 이어 넣기 상태. 넣은 사람은 싣지 않는다. batch는 한 번에 넣는 배치, collection은 출처의 종류(labels.collection으로 이름을 단다),
 * lifetimeMs는 메뉴 수명, perClick은 출처가 한 번에 넣게 하는 곡 수 상한(없으면 null)
 */
type MoreView = Omit<More, "requesterId" | "batch"> & { batch: number; collection: string; lifetimeMs: number; perClick: number | null };

/** 곡 추가 칸의 검색 결과 한 곡. url은 정본 주소(넣을 때 보낸다), isLive는 라이브, upcoming은 그중 시작 전(예정된 방송, 최초 공개), inQueue는 지금 곡이나 대기열에 같은 곡이 있는지 */
type SearchTrack = { title: string | null; artist: string | null; duration: number; thumbnail: string | null; platform: string; url: string; isLive: boolean; upcoming: boolean; inQueue: boolean };
/** 곡 추가 칸의 검색 응답. gated: 유튜브가 연령 인증 안내만 주었고 스포티파이 곡도 없다 */
type SearchReply = { tracks: SearchTrack[]; gated: boolean };

/**
 * 넣은 것(추가 안내 문장 added-parts에 넘긴다). count는 넣은 곡 수(곧바로 튼 곡도 센다), position은 넣은 첫 곡의 대기열 순번(곧바로 틀었으면 null),
 * collection은 여러 곡의 출처 종류(labels.collection으로 이름을 단다, 한 곡이면 null), total은 출처 전체 곡 수(일부만 불러왔을 때),
 * title, thumbnail은 넣은 첫 곡의 것(응답의 대기열은 펼쳐 둔 만큼만 실어 순번으로 찾을 수 없을 때가 있다)
 */
type AddedSummary = { count: number; position: number | null; collection: string | null; total: number | null; title: string | null; thumbnail: string | null };
/** 다 넣지 못한 이유의 경고(디스코드 추가 안내의 경고 줄과 같은 문장, added-parts): 제목과 줄들 */
/** 곡 넣기의 응답. dropped는 대기열이 가득 차 못 넣은 곡 수, queueLimited는 목록의 일부만 넣었는지, skipped는 재생할 수 없어 뺀 곡 수, queueMax는 대기열 상한(0이면 없음), added는 넣은 것(모르면 null) */
type AddReply = PlayerState & { dropped: number; queueLimited: boolean; skipped: number; added: AddedSummary | null; more: MoreView | null; queueMax: number };

/** 이어 넣기의 응답. result는 이어 넣은 결과(화면이 디스코드 더 넣기 결과와 같은 글로 그린다) */
type MoreReply = PlayerState & { added: number; dropped: number; result: MoreOutcome; more: MoreView | null; queueMax: number };

export { QUEUE_PAGE, QUEUE_WINDOW_MAX, LOOP_MODES, loopOf, modeOf };
export type { LoopMode, RequesterRef, QueueTrackView, SponsorSegmentView, PlayingView, PlayerState, AutoplayGenres, VoiceFlags, PlayerRead, QueuePage, MoreView, AddReply, MoreReply, SearchTrack, SearchReply, AddedSummary };
