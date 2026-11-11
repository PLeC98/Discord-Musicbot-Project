// 플레이어 없이 음성 채널에만 남은 봇을 뺀다. /leave(controls)와 기동 때 복원하지 않은 서버(voice-adopt)가 쓴다.
// 게이트웨이(op 4)는 봇이 자기 음성 상태를 바꾸는 것이라 권한이 필요 없지만, 이전 실행이 남긴 음성 상태는 새 접속의 나가기 요청만으로는 빠지지 않는 일이 있다.
// 그래서 지금 채널에 참가를 보내 음성 상태를 새 접속으로 넘겨받은 뒤 나간다. 그래도 빠지지 않으면 REST(멤버 옮기기 권한이 필요하다)로 뺀다

import { RESTJSONErrorCodes, Status, type Guild, type VoiceState } from "discord.js";
import logger from "../infra/log/logger.ts";
import { codeOf, describeError, messageOf } from "../rules/error-kind.ts";
import { joinPayload, leavePayload } from "../infra/voice-adapter.ts";
import type { PlayerSeats } from "./registry.ts";

const log = logger.child({ category: "voice" });

const GATEWAY_STEP_MS = 1500; // 게이트웨이 요청(넘겨받기, 나가기)마다 봇의 음성 상태 알림을 기다리는 시간. 넘으면 다음 단계로

/** 어떻게 나갔나. 로그에 남기는 이름 */
const LEFT_BY = { gateway: "게이트웨이", rest: "REST", already: "이미 나가 있음" } as const;
type Left = keyof typeof LEFT_BY;

/**
 * 플레이어 없이 음성 채널에만 남은 봇을 뺀다.
 * 먼저 디스코드에 봇의 지금 채널을 묻는다(캐시는 끊긴 동안 낡는다). 없으면 아무것도 보내지 않는다(넘겨받기가 봇을 다시 들여보내지 않게).
 * 그사이 플레이어가 생겼으면(누가 다시 불렀다) 새로 붙은 연결을 쫓아내지 않는다(superseded)
 */
async function leaveLingeringVoice(guild: Guild, players: Pick<PlayerSeats, "get">, caller = "leave"): Promise<Left | "superseded" | "failed"> {
  // 묻지 못하면 캐시로 판단한다
  const asked = await botChannelAtDiscord(guild, caller, "캐시 사용");
  const channelId = asked === undefined ? (guild.members.me?.voice?.channelId ?? null) : asked;
  if (!channelId) return "already";
  if (players.get(guild.id)) return "superseded";
  if (guild.shard.status === Status.Ready) {
    const how = await leaveByGateway(guild, channelId, players);
    if (how) return how;
  }
  if (players.get(guild.id)) return "superseded";
  return leaveByRest(guild);
}

/** 넘겨받은 뒤 나간다. 나갔으면 gateway, 그사이 플레이어가 생겼으면 superseded, 나가지 못했으면 null */
async function leaveByGateway(guild: Guild, channelId: string, players: Pick<PlayerSeats, "get">): Promise<"gateway" | "superseded" | null> {
  const voice = guild.members.me?.voice;
  const flags = { selfDeaf: Boolean(voice?.selfDeaf), selfMute: Boolean(voice?.selfMute) };
  // 넘겨받기: 같은 채널에 참가를 보내면 디스코드가 음성 상태를 이 접속의 것으로 바꾸고 알린다. 어떤 알림이 오든, 오지 않든 나가기는 보내 본다
  const taken = botVoiceChanged(guild, () => true, GATEWAY_STEP_MS);
  guild.shard.send(joinPayload(guild.id, channelId, flags));
  await taken;
  if (players.get(guild.id)) return "superseded";
  const left = botVoiceChanged(guild, (state) => !state.channelId, GATEWAY_STEP_MS);
  guild.shard.send(leavePayload(guild.id, flags));
  return (await left) ? "gateway" : null;
}

/** REST 로 뺀다(멤버 옮기기 권한이 필요하다). 캐시에 채널이 없어도 보낸다(디스코드가 있다고 했다). 40032 는 이미 나간 것 */
async function leaveByRest(guild: Guild): Promise<"rest" | "already" | "failed"> {
  try {
    const voice = guild.members.me?.voice;
    if (!voice) throw new Error("봇의 멤버 정보가 캐시에 없음");
    await voice.disconnect();
    return "rest";
  } catch (error) {
    if (codeOf(error) === RESTJSONErrorCodes.TargetUserIsNotConnectedToVoice) return "already";
    log.warn(`플레이어 없이 남은 음성 채널에서 나가기 실패: ${guild.name} | ${messageOf(error)}`);
    return "failed";
  }
}

/** 디스코드가 아는 봇의 이 서버 음성 채널. 없으면 null, 묻지 못하면 undefined */
async function botChannelAtDiscord(guild: Guild, caller: string, fallback: string): Promise<string | null | undefined> {
  try {
    return (await guild.voiceStates.fetch("@me", { force: true, cache: false })).channelId;
  } catch (error) {
    if (codeOf(error) === RESTJSONErrorCodes.UnknownVoiceState) return null;
    log.warn(`봇 음성 상태 REST 조회 실패(${fallback}): ${guild.name} (${guild.id}) | 호출=${caller} | ${describeError(error)}`);
    return undefined;
  }
}

/**
 * 봇의 이 서버 음성 상태 알림이 matches 에 맞으면 true, ms 안에 오지 않으면 false.
 * 리스너는 요청을 보내기 전에 붙이고(부르는 쪽이 이 함수를 먼저 부른다) 끝나면 뗀다
 */
function botVoiceChanged(guild: Guild, matches: (state: VoiceState) => boolean, ms: number): Promise<boolean> {
  const client = guild.client;
  return new Promise((resolve) => {
    const finish = (seen: boolean) => {
      clearTimeout(timer);
      client.off("voiceStateUpdate", listen);
      resolve(seen);
    };
    const listen = (_before: VoiceState, after: VoiceState) => {
      if (after.guild.id === guild.id && after.id === client.user?.id && matches(after)) finish(true);
    };
    const timer = setTimeout(() => finish(false), ms);
    client.on("voiceStateUpdate", listen);
  });
}

export { botChannelAtDiscord, leaveLingeringVoice, LEFT_BY };
