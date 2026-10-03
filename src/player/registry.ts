import { Collection } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "registry" });
import type { Player } from "./player.ts";
import * as playerEvents from "./events.ts";

/**
 * 서버마다 플레이어 하나. 조립(app/main)이 하나 만들어 넘긴다. 등록 · 해제를 기록한다.
 * 빼는 길은 플레이어를 버릴 때 오는 알림 하나다(followDisposals → forget). 그 서버에 새 플레이어가
 * 이미 들어와 있으면 늦게 버려진 옛 플레이어가 새것을 빼지 않는다.
 */

const label = (player: Player | undefined, guildId: string) => `${player?.guild?.name ?? "?"} (${guildId})`;

class PlayerRegistry extends Collection<string, Player> {
  set(guildId: string, player: Player) {
    log.debug(`등록: ${label(player, guildId)}${this.has(guildId) ? " | 기존 항목 교체" : ""}`);
    return super.set(guildId, player);
  }

  /** 버려진 플레이어를 뺀다(reason: 버린 까닭). 그 서버에 이미 다른(새) 플레이어가 있으면 건드리지 않는다 */
  forget(player: Player, reason = "?") {
    const guildId = player.guild?.id;
    if (!guildId || this.get(guildId) !== player) return;
    log.debug(`해제: ${label(player, guildId)} | 원인=${reason}`);
    super.delete(guildId);
  }

  /** 플레이어가 버려지면 스스로 뺀다. 떼는 함수를 돌려준다 */
  followDisposals() {
    return playerEvents.on("disposed", (player, reason) => this.forget(player, reason));
  }
}

/** 등록부를 읽거나 올리기만 하는 쪽이 받는 모양. 조립은 등록부를, 시험은 Map 을 넘긴다 */
type PlayerSeats = { get(guildId: string): Player | undefined; has(guildId: string): boolean; set(guildId: string, player: Player): unknown };

export { PlayerRegistry };
export type { PlayerSeats };
