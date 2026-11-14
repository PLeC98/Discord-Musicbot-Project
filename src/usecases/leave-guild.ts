// 봇을 서버에서 내보낸다(운영자 패널의 서버 나가기, 대시보드 서버 설정의 봇 내보내기).
// guild.leave() 뒤에는 서버 이벤트가 오지 않을 수 있어 사후 정리에 기대지 않고 나가기 전에 정리한다

import type { Guild } from "discord.js";
import * as staySeats from "../store/stay-seats.ts";
import * as playerEvents from "../player/events.ts";
import type { PlayerEnd } from "../player/player.ts";
import type { PlayerSeats } from "../player/registry.ts";

/**
 * 상주 자리를 먼저 지우고(끝 알림을 받은 자리 지킴이가 다시 붙지 않게), 재생 중이면 플레이어를 정리한 뒤(세션도 지운다) 나간다. 나간 뒤 그 서버를 보던 화면에 알린다.
 * reason: 로그에 남길 까닭, end: 패널의 끝 문장, go: 나가기 직전에 부르는 확인(대시보드의 로그인 세션. 정리가 패널을 고치는 사이 끝났으면 던져 나가지 않는다). 나가지 못하면 던진다
 */
async function leaveGuild(players: Pick<PlayerSeats, "get">, guild: Guild, { reason, end, go }: { reason: string; end: Extract<PlayerEnd, "operator-leave" | "dashboard-leave">; go?: () => void }) {
  go?.();
  staySeats.clear(guild.id);
  const player = players.get(guild.id);
  if (player) await player.dispose({ reason, session: "remove", panel: "disconnected", end });
  go?.();
  await guild.leave();
  playerEvents.touched(guild.id);
}

export { leaveGuild };
