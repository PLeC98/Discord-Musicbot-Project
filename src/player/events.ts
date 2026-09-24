// 플레이어가 화면과 대시보드에 알리는 창구. 플레이어는 화면을 모르고 여기로 알린다.
// 듣는 쪽은 조립(src/app/main.ts)이 건다. 알림을 기다리면(await) 듣는 쪽이 끝날 때까지 기다린다.
//
//   refresh(player)             보이는 상태가 바뀌었다. 패널을 지금 상태로
//   ended(player, reason)       재생이 끝났다. 패널을 끝난 모양으로(reason: queue-end · disconnected)
//   started(player, requester)  패널 없이 재생이 시작됐다(자동재생 첫 곡). 새 패널을 올린다
//   released(player, textChannelId)  플레이어를 버린다. 그 채널에 쥔 패널 도구를 놓는다
//   notice(player, code, detail)     글자 채널에 알릴 일. 문장은 화면이 코드로 만든다(ui/playerNotices)
//   touched(guildId)            이 서버의 재생 상태가 바뀌었다. 대시보드가 다시 읽게 한다

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import { messageOf } from "../rules/errorKind.ts";
import type { MusicPlayer } from "./Player.ts";

/** 패널을 새로 올릴 때 요청한 사람. 복원이면 아는 것이 id 뿐이다 */
type Requester = { id: string; username?: string };
/** 글자 채널에 알릴 일과 그 세부 */
type Notices = {
  "autoplay-unknown-genre": { genre: string };
  "autoplay-gave-up": { genre: string };
  "skipped-after-error": { error: unknown };
  restored: { title: string; atSec: number; paused: boolean };
};
type NoticeCode = keyof Notices;
/** 알림마다 넘기는 것 */
type EventArgs = {
  refresh: [player: MusicPlayer];
  ended: [player: MusicPlayer, reason: string];
  started: [player: MusicPlayer, requester: Requester];
  released: [player: MusicPlayer, textChannelId: string];
  notice: [player: MusicPlayer, code: NoticeCode, detail: Notices[NoticeCode]];
  touched: [guildId: string];
};
type Listener<K extends keyof EventArgs> = (...args: EventArgs[K]) => unknown;

const listeners: { [K in keyof EventArgs]: Set<Listener<K>> } = { refresh: new Set(), ended: new Set(), started: new Set(), released: new Set(), notice: new Set(), touched: new Set() };

/** 듣는 쪽을 건다. 떼는 함수를 돌려준다 */
function on<K extends keyof EventArgs>(name: K, fn: Listener<K>) {
  const set: Set<Listener<K>> = listeners[name];
  set.add(fn);
  return () => set.delete(fn);
}

// 듣는 쪽을 모두 부르고 모두 끝날 때까지 기다린다. 듣는 쪽의 실패는 알린 쪽으로 올라간다
async function emit<K extends keyof EventArgs>(name: K, ...args: EventArgs[K]) {
  const set: Set<Listener<K>> = listeners[name];
  await Promise.all([...set].map((fn) => fn(...args)));
}

const refresh = (player: MusicPlayer) => emit("refresh", player);
const ended = (player: MusicPlayer, reason: string) => emit("ended", player, reason);
const started = (player: MusicPlayer, requester: Requester) => emit("started", player, requester);
const notice = <C extends NoticeCode>(player: MusicPlayer, code: C, detail: Notices[C]) => emit("notice", player, code, detail);

function released(player: MusicPlayer, textChannelId: string) {
  for (const fn of listeners.released) fn(player, textChannelId);
}

// 대시보드 알림은 기다리지 않고, 실패해도 알린 쪽을 멈추지 않는다
function touched(guildId: string) {
  for (const fn of listeners.touched) {
    try {
      fn(guildId);
    } catch (error) {
      log.warn(`대시보드 알림 실패: ${messageOf(error)}`);
    }
  }
}

function _reset() {
  for (const set of Object.values(listeners)) set.clear();
}

export { on, refresh, ended, started, notice, released, touched, _reset };
export type { Notices, NoticeCode };
export type { EventArgs, Requester };
