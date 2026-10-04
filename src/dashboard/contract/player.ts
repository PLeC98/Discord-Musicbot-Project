// 서버와 화면이 주고받는 모양: 재생(/api/guilds/:id/player 아래). 서버는 dashboard/player-view · routes/player 가 만든다

import type { Loop } from "../../rules/loop-cycle.ts";
import type { More } from "../../rules/more-choices.ts";
import type { TrackInfo } from "../../player/track.ts";

/** 반복 요청의 값(본문 { mode }). 끈 것은 "off" 로 보낸다 */
const LOOP_MODES = { off: false, track: "track", queue: "queue" } as const satisfies Record<string, Loop>;
type LoopMode = keyof typeof LOOP_MODES;
/** 받은 반복 요청 값을 반복 모드로. 모르는 값이면 undefined */
const loopOf = (mode: unknown): Loop | undefined => (typeof mode === "string" && Object.hasOwn(LOOP_MODES, mode) ? LOOP_MODES[mode as LoopMode] : undefined);
/** 반복 모드를 보낼 값으로 */
const modeOf = (loop: Loop): LoopMode => (loop === false ? "off" : loop);

/** 대기열은 앞에서부터 이만큼만 실어 보낸다. 화면이 더 필요하면 ?queue=n 으로 늘려 요청하거나 /player/queue 로 다음 구간을 받는다(한 번에 QUEUE_WINDOW_MAX 까지) */
const QUEUE_PAGE = 100;
const QUEUE_WINDOW_MAX = 1000;

/** 곡을 넣은 사람. 화면은 id 로 자기 곡인지만 본다 */
type RequesterRef = { id: string | null } | null;

/** 대기열의 한 곡. entry 는 줄 번호(빼기 · 옮기기가 가리키는 것), index 는 지금 순번 */
type QueueTrackView = Pick<TrackInfo, "title" | "artist" | "duration" | "thumbnail" | "platform"> & {
  index: number;
  entry: number | null;
  platformLabel: string;
  /** 자동재생이 미리 뽑아 둔 곡 */
  autoplay: boolean;
  requestedBy: RequesterRef;
};

/** SponsorBlock 자동 스킵 구간(초) */
type SponsorSegmentView = { start: number; end: number; categories: string[] };

/** 지금 곡. currentTime 은 초 */
type PlayingView = Pick<TrackInfo, "title" | "artist" | "duration" | "thumbnail" | "platform"> & {
  entry: number | null;
  url: string;
  platformLabel: string;
  isLive: boolean;
  currentTime: number;
  requestedBy: RequesterRef;
  sponsorSegments: SponsorSegmentView[];
  highlightAt: number | null;
};

/**
 * 재생 상태. 조작은 모두 이 모양으로 답한다. boot · seq 는 만든 차례(늦게 온 옛 응답이 새 상태를 덮지 않게).
 * 플레이어가 없으면 음량 · 반복 · 기록 · 자동재생 칸이 없다
 */
type PlayerState = {
  boot: number;
  seq: number;
  playing: boolean;
  paused: boolean;
  volume?: number;
  loop?: Loop;
  currentTrack: PlayingView | null;
  hasPrevious?: boolean;
  autoplay?: boolean;
  /** 대기열에 라이브가 있다(반복을 켤 수 없다). 대기열 창 밖의 곡도 본다 */
  hasLive: boolean;
  queue: QueueTrackView[];
  queueTotal: number;
};

/** 봇 · 나의 음성 채널 */
type VoiceFlags = { botInVoice: boolean; userInVoice: boolean; sameVoice: boolean };

/** 상태 읽기 · 부르기의 답. 재생 상태에 음성 채널과 이 사람이 할 수 있는 것을 더한다(화면 표시용, 막는 것은 경로마다 서버가 다시 본다) */
type PlayerRead = PlayerState & VoiceFlags & { hasPlayer: boolean; canControl: boolean; canAdd: boolean; canManage: boolean; userId: string };

/** 대기열 더 보기 */
type QueuePage = { items: QueueTrackView[]; total: number };

/** 이어 넣기 상태. 넣은 사람은 싣지 않는다. lifetimeMs 는 메뉴 수명, perClick 은 출처가 한 번에 넣게 하는 곡 수 상한(없으면 null) */
type MoreView = Omit<More, "requesterId"> & { lifetimeMs: number; perClick: number | null };

/** 곡 넣기의 답. dropped 는 대기열이 가득 차 못 넣은 곡 수, queueMax 는 대기열 상한(0 이면 없음) */
type AddReply = PlayerState & { dropped: number; queueLimited: boolean; more: MoreView | null; queueMax: number };

/** 이어 넣기의 답 */
type MoreReply = PlayerState & { added: number; dropped: number; more: MoreView | null; queueMax: number };

export { QUEUE_PAGE, QUEUE_WINDOW_MAX, LOOP_MODES, loopOf, modeOf };
export type { LoopMode, RequesterRef, QueueTrackView, SponsorSegmentView, PlayingView, PlayerState, VoiceFlags, PlayerRead, QueuePage, MoreView, AddReply, MoreReply };
