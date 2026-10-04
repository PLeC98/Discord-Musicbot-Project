// playback.js 의 모양(봇 쪽 시험이 부를 때 쓴다)

type Track = { entry?: number | null; currentTime?: number; duration?: number; requestedBy?: { id: string } | null };
type State = {
  boot?: number;
  seq?: number;
  playing?: boolean;
  paused?: boolean;
  loop?: false | "track" | "queue";
  autoplay?: boolean;
  hasPrevious?: boolean;
  canControl?: boolean;
  userId?: string | null;
  queue?: Track[];
  queueTotal?: number;
  currentTrack?: Track | null;
};
type Clock = { at: number; since: number; running: boolean; duration: number };

export function queueSize(s: State | null | undefined): number;
export function accepts(current: State | null | undefined, next: State | null | undefined): boolean;
export function clockOf(s: State | null | undefined, now: number): Clock;
export function positionAt(clock: Clock, now: number): number;
export function retime(clock: Clock, now: number, change?: { at?: number; running?: boolean }): Clock;
export function canSkip(s: State | null | undefined): boolean;
export function skipEnabled(s: State | null | undefined): boolean;
export function previousEnabled(s: State | null | undefined): boolean;
export function canRemove(s: State | null | undefined, track: Track | null | undefined): boolean;
export function onTrackOf(s: State | null | undefined): { onTrack?: number };
export function seekPosition(clientX: number, rect: { left: number; width: number } | null | undefined, duration: number): number;
export function moveTarget(queue: Track[], from: number, insertAt: number, total: number): { entry: number; before: number | null } | "same" | "partial" | "unknown";
export function reordered<T>(queue: T[], from: number, insertAt: number): T[];
