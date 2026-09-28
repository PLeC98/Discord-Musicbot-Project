// 세션 없이 음성 채널에 남은 봇을 이어받는다(기동 때 세션 복원 뒤).
// 봇을 끌 때 음성 채널에는 남는다(app/shutdown). 곡도 대기열도 없이 끄면 세션이 없어, 다시 켠 뒤 채널에 앉은 봇을 아무도 모른다.
// 세션이 없는 서버만: 그 채널에 플레이어를 붙이고 /join 으로 곡 없이 들어왔을 때처럼 틀 게 없음 퇴장을, 사람이 없으면 혼자 남음 퇴장을 건다.

import type { Client } from "discord.js";
import config from "../../config.ts";
import logger from "../infra/log/logger.ts";
import { bestEffort } from "../infra/bestEffort.ts";
import { messageOf } from "../rules/errorKind.ts";
import type { Player } from "./Player.ts";
import { sessions } from "../store/playerSessions.ts";

const log = logger.child({ category: "voice" });

// 플레이어는 부르는 쪽이 준 생성자로 만든다(이 폴더의 중심 파일을 부르지 않게)
type PlayerClass = typeof Player;

/** touched: 이번 기동에 세션 복원이 손댄 서버(되살렸거나 못 해서 세션을 지우고 나갔다). 건드리지 않는다 */
async function adoptLingeringVoice(client: Client<true>, PlayerCtor: PlayerClass, { touched = [] as string[] } = {}) {
  for (const guild of client.guilds.cache.values()) {
    const channel = guild.voiceStates.cache.get(client.user.id)?.channel;
    if (!channel?.isVoiceBased() || client.players.has(guild.id) || touched.includes(guild.id)) continue;
    // 저장된 세션이 있는 서버(이번 기동이 되살리지 않았다: 연달아 끊김 · 일시적 조회 실패)는 /join 이 이어 튼다. 붙들면 /join 이 막히고 퇴장 때 세션을 지운다
    if (sessions().load(guild.id)) {
      log.info(`세션이 있어 음성 채널의 봇을 이어받지 않습니다. /join 으로 이어 틉니다: "${channel.name}" (${guild.name})`);
      continue;
    }

    const player = new PlayerCtor(guild, null, channel);
    client.players.set(guild.id, player);
    try {
      await player.voice.connect();
    } catch (error) {
      log.warn(`세션 없이 남은 음성 채널에 다시 붙지 못해 정리합니다: "${channel.name}" (${guild.name}) | ${messageOf(error)}`);
      await player.dispose({ reason: "남은 채널 이어받기 실패", session: "keep" });
      continue;
    }
    log.info(`세션 없이 음성 채널에 남아 있던 봇을 이어받습니다: "${channel.name}" (${guild.name})`);
    bestEffort(log, player.updateVoiceStatus(config.voiceStatus.idleText), "음성 채널 상태 바꾸기");
    if (config.bot.leaveDelayQueueEmptyMs > 0) player.idle.scheduleEmpty("곡 없이 대기");
    if (channel.members.filter((member) => !member.user.bot).size === 0) player.idle.startAlone();
  }
}

export { adoptLingeringVoice };
