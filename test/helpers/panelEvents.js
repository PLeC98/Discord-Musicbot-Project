// 플레이어 알림(src/player/events)을 화면 가짜처럼 적는다. 알림이 생기기 전 가짜(musicEmbedManager)와
// 같은 기록을 남겨 기대값을 그대로 둔다. player 를 주면 그 플레이어의 알림만 적는다. 끝나면 stop() 으로 뗀다.
//
//   refresh → "update" · ended → "end:<reason>" · started → "create:<곡 제목>" · released → "webhook:<채널 id>"

import * as playerEvents from "../../src/player/events.ts";

function recordPanel({ player = null } = {}) {
  const seen = [];
  const mine = (p) => !player || p === player;
  const offs = [];
  offs.push(playerEvents.on("refresh", async (p) => mine(p) && seen.push("update")));
  offs.push(playerEvents.on("ended", async (p, reason) => mine(p) && seen.push(`end:${reason}`)));
  offs.push(playerEvents.on("started", async (p) => mine(p) && seen.push(`create:${p.currentTrack?.title}`)));
  offs.push(playerEvents.on("released", (p, textChannelId) => mine(p) && seen.push(`webhook:${textChannelId}`)));
  // 열거되지 않게 붙인다. 기록을 배열로 견줄 때 섞이지 않게
  Object.defineProperty(seen, "stop", { value: () => offs.forEach((off) => off()) });
  return seen;
}

const exported = { recordPanel };
export default exported;
export { exported as "module.exports" };
