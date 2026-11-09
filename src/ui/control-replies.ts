// 재생 조작의 응답 화면(응답 템플릿 ui/frame). 명령과 패널 버튼이 같은 조작을 하면 이 화면 하나를 쓴다

import { frame, noticeFrame } from "./frame.ts";
import { DISCORD_LOOK } from "./mentions.ts";
import * as errors from "./text/ko/errors.ts";
import { formatDuration, formatMs } from "./format.ts";
import * as controlText from "./text/ko/controls.ts";
import type { Loop } from "../rules/loop-cycle.ts";
import type { DiscordArt } from "./discord-art.ts";
import type { Hold } from "../rules/holds.ts";

type Track = { title: string | null; pageUrl: string; thumbnail?: string | null };
/** 조작한 사람. 멘션으로 보인다 */
type Actor = { toString(): string };

// 누가 했나 줄
const who = (by: Actor) => `${controlText.requestedBy()} ${String(by)}`;

/** 일시정지, 재개. heldBy: 소리를 함께 멈추고 있는 억제 사유 */
function paused(isPaused: boolean, track: Track, by: Actor, heldBy: Hold | null = null) {
  const t = controlText.paused(isPaused, track, heldBy);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 건너뛰기. 한 곡 반복이면 처음부터 다시 틀었다(restarted) */
function skipped(restarted: boolean, track: Track, by: Actor) {
  const t = restarted ? controlText.restartedOnRepeat() : controlText.skipped(track);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 이전 곡. 한 곡 반복이면 처음부터 다시 틀었다(restarted). track 은 되돌아간 곡 */
function previous(restarted: boolean, track: Track) {
  const t = restarted ? controlText.restartedOnRepeat() : controlText.previous(track);
  return frame({ icon: t.icon, title: t.title, body: t.body });
}

/** 곡으로 건너뛰기 메뉴에서 선택했다 */
function jumped(track: Track) {
  const t = controlText.jumped(track);
  return frame({ icon: t.icon, title: t.title, body: t.body });
}

/** 정지. cleared 는 비운 대기열 곡 수, stayed 면 24/7 자리라 채널에 남았다 */
function stopped(cleared: number, by: Actor, stayed = false) {
  const t = stayed ? controlText.stoppedStaying(cleared) : controlText.stopped(cleared);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 섞기 */
function shuffled(count: number, by: Actor) {
  const t = controlText.shuffled(count);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 반복 모드 */
function loopSet(mode: Loop, by: Actor) {
  const t = controlText.loopSet(mode);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 하이라이트로 건너뛰는 동안 */
const highlighting = () => frame({ body: controlText.highlighting() });
/** 하이라이트로 건너뛰었다. ms 는 옮긴 위치 */
function highlighted(ms: number) {
  const t = controlText.highlighted(formatMs(ms, "0:00"));
  return frame({ icon: t.icon, title: t.title, body: t.body });
}

/** 처음부터 다시 트는 동안 */
const replaying = () => frame({ body: controlText.replaying() });
const reopening = () => frame({ body: controlText.reopening() });
/** 처음부터 다시 틀었다. art: 붙일 썸네일(ui/discord-art 의 artFor, 첨부면 부르는 쪽이 그 파일을 함께 보낸다). 주지 않으면 곡의 썸네일 주소 */
function replayed(track: Track, by: Actor, art?: DiscordArt | null) {
  const t = controlText.replayed(track);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(by)], divider: true, thumbnail: art === undefined ? track.thumbnail : (art?.url ?? null) });
}

/** 위치를 옮기는 동안 */
const seeking = () => frame({ body: controlText.seeking() });
/** 위치를 옮겼다. ms 는 옮긴 위치 */
function seeked(ms: number) {
  const t = controlText.seeked(formatMs(ms, "0:00"));
  return frame({ icon: t.icon, title: t.title, body: t.body });
}

/** 대기열 비우기. count 는 버린 곡 수 */
function cleared(count: number, by: Actor) {
  const t = controlText.cleared(count);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 대기열에서 한 곡 빼기. left 는 남은 곡 수 */
function removed(left: number, by: Actor) {
  const t = controlText.removed(left);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 대기열 순서 바꾸기. from, to 는 사람이 센 위치(1부터) */
function moved(track: Track, from: number, to: number, by: Actor) {
  const t = controlText.moved(track, from, to);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [`${t.by} ${String(by)}`], divider: true });
}

/** 볼륨. before, level 은 0 ~ VOLUME_MAX(rules/limits) */
function volumeSet(before: number, level: number, by: Actor) {
  const t = controlText.volumeSet(before, level);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 음성 채널에서 나갔다. 곡이 있었으면 저장한 곡, 위치(초), 대기열 곡 수 */
function left(saved: { track: Track; positionSec: number; queue: number } | null, by: Actor, stayOff = false) {
  const t = controlText.left(saved && { track: saved.track, at: formatDuration(saved.positionSec, "0:00"), queue: saved.queue }, stayOff);
  return frame({ title: t.title, body: t.body, footer: [who(by)], divider: true });
}

/** 24/7 켬, 끔, 지금 상태. channelId 는 자리 채널 */
function stayOn(channelId: string, already: boolean, by: Actor) {
  const t = controlText.stayOn(DISCORD_LOOK.channel(channelId), already);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: already ? [] : [who(by)], divider: !already });
}
function stayOff(already: boolean, by: Actor) {
  const t = controlText.stayOff(already);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: already ? [] : [who(by)], divider: !already });
}

/** 음성 채널에 들어왔다, 이미 들어와 있다 */
function joined() {
  const t = controlText.joined();
  return frame({ icon: t.icon, title: t.title, body: t.body });
}
function alreadyJoined(parked = false) {
  const t = controlText.alreadyJoined(parked);
  return frame({ icon: t.icon, title: t.title, body: t.body });
}

/** /join 이 저장한 세션을 복원하는 동안, 복원했다 */
const restoring = () => frame({ body: controlText.restoring() });
const joining = () => frame({ body: controlText.joining() });
const leaving = () => frame({ body: controlText.leaving() });
function restored(track: Track, isPaused: boolean) {
  const t = controlText.restored(track, isPaused);
  return frame({ icon: t.icon, title: t.title, body: t.body });
}
/** 복원한 결과. 열지 못해 그 곡에서 일시정지해 뒀으면 그 까닭과 ▶, 이어 튼 곡이 있으면 그 곡, 없으면 틀 곡이 남지 않았다 */
function restoreResult(track: Track | null, isPaused: boolean, parked: boolean) {
  if (parked) return noticeFrame(errors.notice("restore-parked"));
  if (track) return restored(track, isPaused);
  return noticeFrame(errors.notice("restore-nothing-left"));
}

export { stayOn, stayOff, paused, skipped, previous, jumped, stopped, shuffled, loopSet, highlighting, highlighted, replaying, reopening, replayed, seeking, seeked, cleared, removed, moved, volumeSet, left, joined, alreadyJoined, restoring, joining, leaving, restored, restoreResult };
