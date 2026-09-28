// 세션 없이 음성 채널에 남은 봇을 이어받는다(기동 때 세션 복원 뒤).
// 봇을 끌 때 음성 채널에는 남는다(app/shutdown). 곡도 대기열도 없이 끄면 세션이 없어, 다시 켠 뒤 채널에 앉은 봇을 아무도 모른다.
// 그 채널에 플레이어를 붙이고 /join 으로 곡 없이 들어왔을 때처럼 틀 게 없음 퇴장을, 사람이 없으면 혼자 남음 퇴장을 건다.

import type { Client } from "discord.js";
import config from "../../config.ts";
import logger from "../infra/log/logger.ts";
import { bestEffort } from "../infra/bestEffort.ts";
import { messageOf } from "../rules/errorKind.ts";
import type { Player } from "./Player.ts";

const log = logger.child({ category: "voice" });

// 플레이어는 부르는 쪽이 준 생성자로 만든다(이 폴더의 중심 파일을 부르지 않게)
type PlayerClass = typeof Player;

async function adoptLingeringVoice(client: Client<true>, PlayerCtor: PlayerClass) {
  for (const guild of client.guilds.cache.values()) {
    const channel = guild.voiceStates.cache.get(client.user.id)?.channel;
    if (!channel?.isVoiceBased() || client.players.has(guild.id)) continue;

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
