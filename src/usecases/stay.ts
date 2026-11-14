// 상주 모드(24/7) 켜기, 끄기(디스코드 /247). 판정과 처리는 여기서, 결과를 어떻게 알릴지는 입구가 정한다.
// 상주 채널은 봇이 지금 있는 채널이고, 없으면 요청자의 채널에 접속한 뒤 그 채널로 한다(봇을 옮기지 않는다). 상주 판정은 player/idle-leave가 이 설정을 본다.
// 켜고 끄기는 재생 조작과 같은 DJ 조작이다(checkControl: DJ, 봇이 음성에 있으면 같은 채널)

import { ChannelType, type Guild, type GuildMember, type GuildTextBasedChannel, type VoiceBasedChannel } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player", sub: "stay" });
import * as staySeats from "../store/stay-seats.ts";
import * as playerEvents from "../player/events.ts";
import type { PlayerSeats } from "../player/registry.ts";
import type { Code } from "../rules/problems.ts";
import { checkControl } from "./permissions.ts";
import { join, summonRefusal } from "./join.ts";

type StayRefusal = Extract<Code, "stay-stage" | "must-dj" | "must-be-in-same-voice" | "must-be-in-voice" | "permission-voice" | "bot-in-other-voice" | "voice-failed" | "restore-failed" | "bot-shutting-down">;
/** on: 켰다(이미 켜져 있던 같은 채널이면 already), off: 껐다(이미 꺼져 있었으면 already) */
type StayResult = { ok: true; kind: "on"; channelId: string; already: boolean } | { ok: true; kind: "off"; already: boolean } | { ok: false; code: StayRefusal };

type Bot = { players: Pick<PlayerSeats, "get" | "set"> };

const isStage = (channel: VoiceBasedChannel | null | undefined) => channel?.type === ChannelType.GuildStageVoice;

/** 그 서버의 자리 채널. 없으면 null */
const seatChannelOf = (guildId: string) => staySeats.seatOf(guildId)?.channelId ?? null;

/** 켜기 전 확인: DJ 조작이고, 봇이 음성에 없으면 그 사람이 봇을 부를 수 있어야 한다(스테이지는 막는다). 되면 null */
async function onRefusal(bot: Pick<Bot, "players">, member: GuildMember): Promise<StayRefusal | null> {
  const denied = await checkControl(member);
  if (denied) return denied;
  if (bot.players.get(member.guild.id)?.voice.isAlive()) return null;
  if (isStage(member.voice.channel)) return "stay-stage";
  return summonRefusal(member);
}

/** 끄기 전 확인: DJ 조작. 되면 null */
const offRefusal = (member: GuildMember): Promise<StayRefusal | null> => checkControl(member);

/** 그 사람이 지금 상주 모드를 바꿀 수 없는 까닭(켜져 있으면 끄기, 꺼져 있으면 켜기의 확인). 대시보드가 바꾸기 전에 보인다 */
const stayRefusal = (bot: Pick<Bot, "players">, member: GuildMember) => (seatChannelOf(member.guild.id) ? offRefusal(member) : onRefusal(bot, member));

/** 켠다. 봇이 음성에 없으면 부른 사람의 채널에 붙는다(저장된 세션이 있으면 /join 과 같이 복원한다). go: 붙기 직전에 부르는 확인(대시보드의 로그인 세션, join 의 go) */
async function turnOn(bot: Bot, { guild, member, textChannel = null }: { guild: Guild; member: GuildMember; textChannel?: GuildTextBasedChannel | null }, { go }: { go?: () => void } = {}): Promise<StayResult> {
  const denied = await onRefusal(bot, member);
  if (denied) return { ok: false, code: denied };

  let player = bot.players.get(guild.id);
  if (!player?.voice.isAlive()) {
    const joined = await join(bot, { guild, member, textChannel }, { go });
    if (joined.kind === "refused") return { ok: false, code: joined.code };
    if (joined.kind === "restore-error") return { ok: false, code: "restore-failed" };
    player = joined.player;
  }
  const channel = player.voiceChannel;
  if (!channel) return { ok: false, code: "voice-failed" };
  if (isStage(channel)) return { ok: false, code: "stay-stage" };
  // 붙는 사이에 바뀐 것을 저장 직전에 다시 본다: 확인(로그인 세션), 봇이 다른 채널로 복원됐으면 같은 채널 규칙
  go?.();
  const late = await checkControl(member);
  if (late) return { ok: false, code: late };

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
async function turnOff(bot: Pick<Bot, "players">, { guild, member }: { guild: Guild; member: GuildMember }): Promise<StayResult> {
  const denied = await offRefusal(member);
  if (denied) return { ok: false, code: denied };
  if (!clearSeat(guild, member)) return { ok: true, kind: "off", already: true };
  bot.players.get(guild.id)?.idle.reconsider();
  return { ok: true, kind: "off", already: false };
}

/**
 * 상주 설정을 해제하고 로그를 남긴 뒤 대시보드에 알린다(권한은 호출하는 쪽에서 확인한다). /247 끄기와 /leave가 함께 쓴다. 설정된 채널이 없었으면 false다.
 * 자동 퇴장 타이머는 다시 설정하지 않는다(/247 끄기에서 설정한다. /leave는 곧바로 플레이어를 정리하므로 타이머를 걸면 종료 패널과 퇴장 예정 시각 표시가 겹친다)
 */
function clearSeat(guild: Guild, by: GuildMember) {
  if (!staySeats.clear(guild.id)) return false;
  log.info(`상주 모드 끔: ${guild.name} | 실행 ${by.user.tag}`);
  playerEvents.touched(guild.id);
  return true;
}

export { turnOn, turnOff, clearSeat, seatChannelOf, stayRefusal };
export type { StayResult, StayRefusal };
