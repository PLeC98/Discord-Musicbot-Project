// 상주 모드(24/7) 켜기 · 끄기(디스코드 /247). 판정과 일은 여기서, 결과를 어떻게 알릴지는 입구가 정한다.
// 자리는 봇이 지금 있는 채널, 없으면 부른 사람의 채널에 붙은 뒤 그 채널이다(봇을 옮기지 않는다). 머무는 판정은 player/idle-leave 가 자리를 본다

import { ChannelType, type Guild, type GuildMember, type GuildTextBasedChannel, type VoiceBasedChannel } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player", sub: "stay" });
import * as staySeats from "../store/stay-seats.ts";
import * as playerEvents from "../player/events.ts";
import type { PlayerSeats } from "../player/registry.ts";
import type { Code } from "../rules/problems.ts";
import { isModerator } from "./permissions.ts";
import { join } from "./join.ts";

type StayRefusal = Extract<Code, "stay-stage" | "must-moderator" | "must-be-in-voice" | "permission-voice" | "bot-in-other-voice" | "voice-failed" | "restore-failed">;
/** on: 켰다(이미 켜져 있던 같은 채널이면 already) · off: 껐다(이미 꺼져 있었으면 already) */
type StayResult = { ok: true; kind: "on"; channelId: string; already: boolean } | { ok: true; kind: "off"; already: boolean } | { ok: false; code: StayRefusal };

type Bot = { players: Pick<PlayerSeats, "get" | "set"> };

const isStage = (channel: VoiceBasedChannel | null | undefined) => channel?.type === ChannelType.GuildStageVoice;

/** 그 서버의 자리 채널. 없으면 null */
const seatChannelOf = (guildId: string) => staySeats.seatOf(guildId)?.channelId ?? null;

/** 켠다. 봇이 음성에 없으면 부른 사람의 채널에 붙는다(저장된 세션이 있으면 /join 과 같이 복원한다) */
async function turnOn(bot: Bot, { guild, member, textChannel = null }: { guild: Guild; member: GuildMember; textChannel?: GuildTextBasedChannel | null }): Promise<StayResult> {
  if (!isModerator(member)) return { ok: false, code: "must-moderator" };

  let player = bot.players.get(guild.id);
  if (!player?.voice.isAlive()) {
    if (isStage(member.voice.channel)) return { ok: false, code: "stay-stage" };
    const joined = await join(bot, { guild, member, textChannel });
    if (joined.kind === "refused") return { ok: false, code: joined.code };
    if (joined.kind === "restore-error") return { ok: false, code: "restore-failed" };
    player = joined.player;
  }
  const channel = player.voiceChannel;
  if (!channel) return { ok: false, code: "voice-failed" };
  if (isStage(channel)) return { ok: false, code: "stay-stage" };

  const already = seatChannelOf(guild.id) === channel.id;
  if (!already) {
    staySeats.set(guild.id, channel.id, member.id);
    log.info(`상주 모드 켬: "${channel.name}" (${guild.name}) | 실행 ${member.user.tag}`);
  }
  player.idle.reconsider();
  playerEvents.touched(guild.id);
  return { ok: true, kind: "on", channelId: channel.id, already };
}

/** 끈다. 봇이 음성에 있으면 지금부터 평소처럼 나갈 시각을 건다 */
function turnOff(bot: Pick<Bot, "players">, { guild, member }: { guild: Guild; member: GuildMember }): StayResult {
  if (!isModerator(member)) return { ok: false, code: "must-moderator" };
  if (!staySeats.clear(guild.id)) return { ok: true, kind: "off", already: true };
  log.info(`상주 모드 끔: ${guild.name} | 실행 ${member.user.tag}`);
  bot.players.get(guild.id)?.idle.reconsider();
  playerEvents.touched(guild.id);
  return { ok: true, kind: "off", already: false };
}

export { turnOn, turnOff, seatChannelOf };
export type { StayResult, StayRefusal };
