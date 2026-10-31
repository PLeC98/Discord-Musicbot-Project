// 세션 없이 음성 채널에 남은 봇을 이어받는다(기동 시 세션 복원 뒤).
// 프로세스가 죽어 게이트웨이를 닫지 못하면 그 세션이 끝날 때까지 봇이 음성 채널에 남는다(정상 종료는 곧바로 빠진다). 곡도 대기열도 없었으면 세션이 없어, 다시 시작한 뒤 채널에 앉은 봇을 아무도 모른다.
// 세션이 없는 서버만: 그 채널에 플레이어를 붙이고 /join 으로 곡 없이 들어왔을 때처럼 틀 게 없음 퇴장을, 사람이 없으면 혼자 남음 퇴장을 건다.

import type { Client } from "discord.js";
import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
import { bestEffort } from "../infra/best-effort.ts";
import { messageOf } from "../rules/error-kind.ts";
import type { Player } from "./player.ts";
import type { PlayerSeats } from "./registry.ts";
import { sessions } from "../store/player-sessions.ts";

const log = logger.child({ category: "voice" });

// 플레이어는 부르는 쪽이 준 생성자로 만든다(player.ts 를 불러오지 않게)
type PlayerClass = typeof Player;

/** touched: 이번 기동에 세션 복원이 손댄 서버(복원했거나 못 해서 세션을 삭제하고 나갔다). 건드리지 않는다 */
async function adoptLingeringVoice(client: Client<true>, players: Pick<PlayerSeats, "has" | "set">, PlayerCtor: PlayerClass, { touched = [] as string[] } = {}) {
  for (const guild of client.guilds.cache.values()) {
    const channel = guild.voiceStates.cache.get(client.user.id)?.channel;
    if (!channel?.isVoiceBased() || players.has(guild.id) || touched.includes(guild.id)) continue;
    // 저장된 세션이 있는 서버(이번 기동이 복원하지 않았다: 연달아 끊김, 일시적 조회 실패)는 /join 이 이어 튼다. 붙들면 /join 이 막히고 퇴장 때 세션을 삭제한다
    if (sessions().load(guild.id)) {
      log.info(`저장된 세션이 있어 음성 채널 연결을 바로 이어받지 않습니다(/join으로 이어서 재생): "${channel.name}" (${guild.name})`);
      continue;
    }

    const player = new PlayerCtor(guild, null, channel);
    players.set(guild.id, player);
    try {
      await player.voice.connect();
    } catch (error) {
      log.warn(`세션 없이 남은 음성 채널에 재연결하지 못해 정리합니다: "${channel.name}" (${guild.name}) | ${messageOf(error)}`);
      await player.dispose({ reason: "남은 채널 이어받기 실패", session: "keep", end: "adopt-failed" });
      continue;
    }
    log.info(`세션 없이 음성 채널에 남아 있던 봇을 이어받습니다: "${channel.name}" (${guild.name})`);
    bestEffort(log, player.updateVoiceStatus(config.voiceStatus.idleText), "음성 채널 상태 바꾸기");
    player.idle.scheduleEmpty("곡 없이 대기");
    // 혼자 남음은 붙을 때(connect) 억제 사유를 맞추며 이미 걸었다. 그때의 안내는 틀 게 없음 타이머 전이라 한 번 더 알린다
    player.idle.announce();
  }
}

export { adoptLingeringVoice };
