// 재생 조작의 응답 화면(응답 템플릿 ui/frame). 명령과 패널 버튼이 같은 조작을 하면 이 화면 하나를 쓴다.
// 함수마다 첫 인자 T는 보낼 곳의 독자에 맞는 문구표다(ui/language: 결과는 서버 언어, 진행 안내는 본인 언어)

import { frame, noticeFrame } from "./frame.ts";
import { channelMention } from "./mentions.ts";
import { formatDuration, formatMs } from "./format.ts";
import type { Loop } from "../rules/loop-cycle.ts";
import type { DiscordArt } from "./discord-art.ts";
import type { Hold } from "../rules/holds.ts";
import type { BotText } from "./text/index.ts";

type Track = { title: string | null; pageUrl: string; thumbnail?: string | null };
/** 조작한 사람. 멘션으로 보인다 */
type Actor = { toString(): string };

// 누가 했나 줄
const who = (T: BotText, by: Actor) => `${T.controls.requestedBy()} ${String(by)}`;

/** 일시정지, 재개. heldBy: 소리를 함께 멈추고 있는 억제 사유 */
function paused(T: BotText, isPaused: boolean, track: Track, by: Actor, heldBy: Hold | null = null) {
  const t = T.controls.paused(isPaused, track, heldBy);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(T, by)], divider: true });
}

/** 건너뛰기. 한 곡 반복이면 처음부터 다시 틀었다(restarted) */
function skipped(T: BotText, restarted: boolean, track: Track, by: Actor) {
  const t = restarted ? T.controls.restartedOnRepeat() : T.controls.skipped(track);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(T, by)], divider: true });
}

/** 이전 곡. 한 곡 반복이면 처음부터 다시 틀었다(restarted). track은 되돌아간 곡 */
function previous(T: BotText, restarted: boolean, track: Track) {
  const t = restarted ? T.controls.restartedOnRepeat() : T.controls.previous(track);
  return frame({ icon: t.icon, title: t.title, body: t.body });
}

/** 곡으로 건너뛰기 메뉴에서 선택했다 */
function jumped(T: BotText, track: Track) {
  const t = T.controls.jumped(track);
  return frame({ icon: t.icon, title: t.title, body: t.body });
}

/** 정지. cleared는 비운 대기열 곡 수, stayed면 24/7 자리라 채널에 남았다 */
function stopped(T: BotText, cleared: number, by: Actor, stayed = false) {
  const t = stayed ? T.controls.stoppedStaying(cleared) : T.controls.stopped(cleared);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(T, by)], divider: true });
}

function shuffled(T: BotText, count: number, by: Actor) {
  const t = T.controls.shuffled(count);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(T, by)], divider: true });
}

function loopSet(T: BotText, mode: Loop, by: Actor) {
  const t = T.controls.loopSet(mode);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(T, by)], divider: true });
}

/** 하이라이트로 건너뛰는 동안 */
const highlighting = (T: BotText) => frame({ body: T.controls.highlighting() });
/** 하이라이트로 건너뛰었다. ms는 옮긴 위치 */
function highlighted(T: BotText, ms: number) {
  const t = T.controls.highlighted(formatMs(ms, "0:00"));
  return frame({ icon: t.icon, title: t.title, body: t.body });
}

/** 처음부터 다시 트는 동안 */
const replaying = (T: BotText) => frame({ body: T.controls.replaying() });
const reopening = (T: BotText) => frame({ body: T.controls.reopening() });
/** 처음부터 다시 틀었다. art: 붙일 썸네일(ui/discord-art의 artFor, 첨부면 호출부가 그 파일을 함께 보낸다). 주지 않으면 곡의 썸네일 주소 */
function replayed(T: BotText, track: Track, by: Actor, art?: DiscordArt | null) {
  const t = T.controls.replayed(track);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(T, by)], divider: true, thumbnail: art === undefined ? track.thumbnail : (art?.url ?? null) });
}

/** 위치를 옮기는 동안 */
const seeking = (T: BotText) => frame({ body: T.controls.seeking() });
/** 위치를 옮겼다. ms는 옮긴 위치 */
function seeked(T: BotText, ms: number) {
  const t = T.controls.seeked(formatMs(ms, "0:00"));
  return frame({ icon: t.icon, title: t.title, body: t.body });
}

/** 대기열 비우기. count는 버린 곡 수 */
function cleared(T: BotText, count: number, by: Actor) {
  const t = T.controls.cleared(count);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(T, by)], divider: true });
}

/** 대기열에서 빼기. count는 뺀 곡 수, left는 남은 곡 수 */
function removed(T: BotText, count: number, left: number, by: Actor) {
  const t = T.controls.removed(count, left);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(T, by)], divider: true });
}

/** 대기열 순서 바꾸기. from, to는 사람이 센 위치(1부터) */
function moved(T: BotText, track: Track, from: number, to: number, by: Actor) {
  const t = T.controls.moved(track, from, to);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [`${t.by} ${String(by)}`], divider: true });
}

/** 볼륨. before, level은 0 ~ VOLUME_MAX(rules/limits) */
function volumeSet(T: BotText, before: number, level: number, by: Actor) {
  const t = T.controls.volumeSet(before, level);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: [who(T, by)], divider: true });
}

/** 음성 채널에서 나갔다. 곡이 있었으면 저장한 곡, 위치(초), 대기열 곡 수 */
function left(T: BotText, saved: { track: Track; positionSec: number; queue: number } | null, by: Actor, stayOff = false) {
  const t = T.controls.left(saved && { track: saved.track, at: formatDuration(saved.positionSec, "0:00"), queue: saved.queue }, stayOff);
  return frame({ title: t.title, body: t.body, footer: [who(T, by)], divider: true });
}

/** 24/7 켬, 끔, 지금 상태. channelId는 자리 채널 */
function stayOn(T: BotText, channelId: string, already: boolean, by: Actor) {
  const t = T.controls.stayOn(channelMention(channelId), already);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: already ? [] : [who(T, by)], divider: !already });
}
function stayOff(T: BotText, already: boolean, by: Actor) {
  const t = T.controls.stayOff(already);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: already ? [] : [who(T, by)], divider: !already });
}

/** 볼륨 정규화 켬, 끔 */
function normalizeSet(T: BotText, on: boolean, already: boolean, by: Actor) {
  const t = T.controls.normalizeSet(on, already);
  return frame({ icon: t.icon, title: t.title, body: t.body, footer: already ? [] : [who(T, by)], divider: !already });
}

/** 음성 채널에 들어왔다, 이미 들어와 있다 */
function joined(T: BotText) {
  const t = T.controls.joined();
  return frame({ icon: t.icon, title: t.title, body: t.body });
}
function alreadyJoined(T: BotText, parked = false) {
  const t = T.controls.alreadyJoined(parked);
  return frame({ icon: t.icon, title: t.title, body: t.body });
}

/** /join이 저장한 세션을 복원하는 동안, 복원했다 */
const restoring = (T: BotText) => frame({ body: T.controls.restoring() });
const joining = (T: BotText) => frame({ body: T.controls.joining() });
const leaving = (T: BotText) => frame({ body: T.controls.leaving() });
function restored(T: BotText, track: Track, isPaused: boolean) {
  const t = T.controls.restored(track, isPaused);
  return frame({ icon: t.icon, title: t.title, body: t.body });
}
/** 복원한 결과. 열지 못해 그 곡에서 일시정지해 뒀으면 그 이유와 ▶, 이어 튼 곡이 있으면 그 곡, 없으면 틀 곡이 남지 않았다 */
function restoreResult(T: BotText, track: Track | null, isPaused: boolean, parked: boolean) {
  if (parked) return noticeFrame(T.errors.notice("restore-parked"));
  if (track) return restored(T, track, isPaused);
  return noticeFrame(T.errors.notice("restore-nothing-left"));
}

export { stayOn, stayOff, normalizeSet, paused, skipped, previous, jumped, stopped, shuffled, loopSet, highlighting, highlighted, replaying, reopening, replayed, seeking, seeked, cleared, removed, moved, volumeSet, left, joined, alreadyJoined, restoring, joining, leaving, restored, restoreResult };
