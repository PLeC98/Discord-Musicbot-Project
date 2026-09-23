"use strict";

// 플레이어가 화면과 대시보드에 알리는 창구. 플레이어는 화면을 모르고 여기로 알린다.
// 듣는 쪽은 조립(src/app/main.js)이 건다. 알림을 기다리면(await) 듣는 쪽이 끝날 때까지 기다린다.
//
//   refresh(player)             보이는 상태가 바뀌었다. 패널을 지금 상태로
//   ended(player, reason)       재생이 끝났다. 패널을 끝난 모양으로(reason: queue-end · disconnected)
//   started(player, requester)  패널 없이 재생이 시작됐다(자동재생 첫 곡). 새 패널을 올린다
//   released(player, textChannelId)  플레이어를 버린다. 그 채널에 쥔 패널 도구를 놓는다
//   notice(player, code, detail)     글자 채널에 알릴 일. 문장은 화면이 코드로 만든다(ui/playerNotices)
//   touched(guildId)            이 서버의 재생 상태가 바뀌었다. 대시보드가 다시 읽게 한다

const log = require("../infra/log/logger").child({ category: "player" });

const listeners = new Map(); // 알림 이름 → Set<fn>

/** 듣는 쪽을 건다. 떼는 함수를 돌려준다 */
function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name)?.delete(fn);
}

// 듣는 쪽을 모두 부르고 모두 끝날 때까지 기다린다. 듣는 쪽의 실패는 알린 쪽으로 올라간다
async function emit(name, ...args) {
  const fns = [...(listeners.get(name) ?? [])];
  await Promise.all(fns.map((fn) => fn(...args)));
}

const refresh = (player) => emit("refresh", player);
const ended = (player, reason) => emit("ended", player, reason);
const started = (player, requester) => emit("started", player, requester);
const notice = (player, code, detail = {}) => emit("notice", player, code, detail);

function released(player, textChannelId) {
  for (const fn of listeners.get("released") ?? []) fn(player, textChannelId);
}

// 대시보드 알림은 기다리지 않고, 실패해도 알린 쪽을 멈추지 않는다
function touched(guildId) {
  for (const fn of listeners.get("touched") ?? []) {
    try {
      fn(guildId);
    } catch (error) {
      log.warn(`대시보드 알림 실패: ${error.message}`);
    }
  }
}

module.exports = { on, refresh, ended, started, notice, released, touched, _reset: () => listeners.clear() };
