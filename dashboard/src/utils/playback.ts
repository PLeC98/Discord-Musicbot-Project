// 재생 바와 서버 화면이 같이 쓰는 재생 규칙(순수 함수). 상태는 두 곳이 따로 든다(재생 바는 듣고 있는 서버, 서버 화면은 주소의 서버)
// 규칙은 읽는 칸만 받는다. 화면은 받은 재생 상태(contract/player 의 PlayerRead)를 그대로 넘긴다

import type { PlayerRead, PlayerState, PlayingView, QueueTrackView } from "../../../src/dashboard/contract/player.ts";
import { canGoBack, canGoNext, ownTrackDenied } from "../../../src/rules/controls.ts";

/** 규칙이 읽는 곡의 칸 */
type TrackSeen = Partial<Pick<PlayingView, "entry" | "currentTime" | "duration" | "requestedBy">>;
/** 규칙이 읽는 재생 상태의 칸 */
type StateSeen = Partial<Pick<PlayerRead, "boot" | "seq" | "playing" | "paused" | "loop" | "autoplay" | "hasPrevious" | "canControl" | "userId" | "queueTotal" | "botInVoice" | "sameVoice">> & {
  queue?: TrackSeen[];
  currentTrack?: TrackSeen | null;
};
/** 진행 시계: 받은 위치(초) · 받은 때(ms) · 흐르는 중인지 · 길이(초) */
type Clock = { at: number; since: number; running: boolean; duration: number };

/** 상태 읽기(GET)만 싣는 칸: 음성 채널 · 이 사람이 할 수 있는 것. 조작 응답(PlayerState)에는 없다 */
type ReadFields = Omit<PlayerRead, keyof PlayerState>;
/** 화면이 들고 있는 재생 상태. 읽기 전용 칸은 상태를 읽기 전이면 없다 */
type PlayerSeen = PlayerState & Partial<ReadFields>;
// 빠뜨리거나 더 적으면 타입 검사가 잡는다
const READ_FIELDS: Record<keyof ReadFields, true> = { botInVoice: true, userInVoice: true, sameVoice: true, hasPlayer: true, canControl: true, canAdd: true, canManage: true, userId: true };

/** 받은 상태로 바꾼다. 재생 상태 칸은 통째로 바꾸고(없어진 칸은 없어진다), 읽기 전용 칸은 받은 것에 없으면 지금 값을 남긴다 */
export function withReadFields(current: PlayerSeen | null | undefined, next: PlayerState | PlayerRead): PlayerSeen {
  const kept: Partial<ReadFields> = {};
  for (const key of Object.keys(READ_FIELDS) as Array<keyof ReadFields>) if (!(key in next)) Object.assign(kept, { [key]: current?.[key] });
  return { ...kept, ...next };
}

/** 대기열 곡 수(받은 창 밖까지) */
export const queueSize = (s: StateSeen | null | undefined): number => s?.queueTotal ?? s?.queue?.length ?? 0;

/**
 * 받은 재생 상태로 바꿀지. 서버는 상태를 만들 때마다 차례(seq)를 올리고 봇을 켤 때마다 기동 표(boot, 켠 시각)가 커진다.
 * 기동 표가 크면 받고 작으면(옛 실행의 늦은 응답) 버린다. 같으면 차례가 지금 이상일 때만. 표가 없는 쪽이 있으면 받는다
 */
export function accepts(current: StateSeen | null | undefined, next: StateSeen | null | undefined): boolean {
  if (typeof current?.boot !== "number" || typeof next?.boot !== "number") return true;
  if (next.boot !== current.boot) return next.boot > current.boot;
  return typeof next.seq === "number" && typeof current.seq === "number" && next.seq >= current.seq;
}

/** 진행 시계의 기준: 받은 위치 · 받은 때 · 흐르는 중인지 · 길이 */
export function clockOf(s: StateSeen | null | undefined, now: number): Clock {
  const track = s?.currentTrack;
  return { at: track?.currentTime ?? 0, since: now, running: Boolean(track && s.playing && !s.paused), duration: track?.duration ?? 0 };
}

/** 지금 진행 위치(초) = 받은 위치 + 받은 뒤 지난 시간(흐르는 중일 때만). 길이를 알면 넘지 않는다(라이브는 길이 0) */
export function positionAt(clock: Clock, now: number): number {
  const t = clock.at + (clock.running ? Math.max(0, now - clock.since) / 1000 : 0);
  return clock.duration > 0 ? Math.min(t, clock.duration) : t;
}

/** 시계를 지금 자리에서 다시 잰다. 옮긴 자리(at) · 흐르는지(running)를 바꿀 수 있다(응답을 기다리는 동안 얹어 보인다) */
export function retime(clock: Clock, now: number, { at = positionAt(clock, now), running = clock.running }: { at?: number; running?: boolean } = {}): Clock {
  return { ...clock, at, since: now, running };
}

/**
 * 그 곡을 넣은 사람도 하는 조작(넘기기 · 빼기)을 할 수 있나. 서버(usecases/permissions)와 같은 규칙(rules/controls)에
 * 받은 상태를 넣는다: 조작 권한(canControl), 재적 규칙(봇이 음성 채널에 없거나 같은 채널이다)
 */
function mayTouch(s: StateSeen | null | undefined, track: TrackSeen | null | undefined): boolean {
  const requester = Boolean(track?.requestedBy?.id) && track?.requestedBy?.id === s?.userId;
  return ownTrackDenied({ control: s?.canControl ? null : "denied", requester, voice: () => (!s?.botInVoice || s.sameVoice ? null : "denied") }) === null;
}

/** 건너뛰기 권한: 조작 권한이 있거나 지금 곡을 넣은 사람 */
export const canSkip = (s: StateSeen | null | undefined): boolean => mayTouch(s, s?.currentTrack);

/** 대기열 빼기 권한: 조작 권한이 있거나 그 곡을 넣은 사람 */
export const canRemove = (s: StateSeen | null | undefined, track: TrackSeen | null | undefined): boolean => mayTouch(s, track);

/** 다음 곡 버튼(rules/controls 의 canGoNext) */
export const skipEnabled = (s: StateSeen | null | undefined): boolean => Boolean(s?.currentTrack) && canSkip(s) && canGoNext({ queue: queueSize(s), loop: s?.loop, autoplay: s?.autoplay });

/** 이전 곡 버튼(rules/controls 의 canGoBack). 상태는 기록이 있는지만 싣는다 */
export const previousEnabled = (s: StateSeen | null | undefined): boolean => Boolean(s?.currentTrack) && Boolean(s?.canControl) && canGoBack({ history: s?.hasPrevious ? 1 : 0, loop: s?.loop });

/** 탐색 · 넘기기 · 이전 · 하이라이트를 "지금 곡이 이것일 때만" 하라는 표. 줄 번호가 있을 때만 싣는다 */
export const onTrackOf = (s: StateSeen | null | undefined): { onTrack?: number } => {
  const entry = s?.currentTrack?.entry;
  return typeof entry === "number" && Number.isInteger(entry) ? { onTrack: entry } : {};
};

/** 진행 막대 위의 가로 위치 → 초 */
export function seekPosition(clientX: number, rect: { left: number; width: number } | null | undefined, duration: number): number {
  if (!rect?.width || !(duration > 0)) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.round(ratio * duration);
}

/** 끌어 놓은 자리의 옮기기 요청. before 줄 앞으로, null 이면 대기열 맨 끝 */
type MoveRequest = { entry: number; before: number | null };
const isEntry = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

/**
 * 끌어 놓은 자리 → 옮기기 요청. insertAt 은 받은 목록의 틈(0 ~ 길이, from 앞뒤는 제자리).
 * "same": 제자리. "partial": 받은 창의 끝인데 그 뒤에 곡이 더 있다(맨 끝이 아니다).
 * "unknown": 줄 번호가 없다(봇이 다시 켜지기 전의 목록 등)
 */
export function moveTarget(queue: Array<Pick<QueueTrackView, "entry"> | TrackSeen>, from: number, insertAt: number, total: number): MoveRequest | "same" | "partial" | "unknown" {
  if (insertAt === from || insertAt === from + 1) return "same";
  const entry = queue[from]?.entry;
  if (!isEntry(entry)) return "unknown";
  if (insertAt >= queue.length) return queue.length < total ? "partial" : { entry, before: null };
  const before = queue[insertAt]?.entry;
  return isEntry(before) ? { entry, before } : "unknown";
}

export type { TrackSeen, StateSeen, PlayerSeen, Clock, MoveRequest };
