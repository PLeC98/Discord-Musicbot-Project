import { SlashCommandBuilder } from "discord.js";
import * as controls from "../../usecases/controls.ts";
import * as replies from "../../ui/control-replies.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { LIFETIME, toAll } from "../../ui/delivery.ts";
import { acceptWith, refuse } from "../interactions/control-answers.ts";

const exported: GuildCommand = {
  help: { section: "channel", tier: "dj" },
  data: new SlashCommandBuilder().setName("leave").setDescription("대기열을 저장하고 음성 채널에서 나가요"),

  async execute(interaction, bot) {
    const { guild, member } = interaction;
    // 플레이어가 있으면 결과는 정리를 시작한 뒤, 끝난 패널을 그리기 전에 답한다(유스케이스의 onAccepted).
    // 플레이어 없이 음성에만 남았으면 나가기가 몇 초 걸릴 수 있어 "나가는 중" 자리표시자를 먼저 본인에게 보낸다(onLeaving). 그 뒤의 거절은 그 자리표시자를 안내로 바꾼다(refuse)
    const r = await controls.leave(guild, { member }, bot.players, {
      onAccepted: (facts) => toAll(interaction, replies.left(facts.track ? { track: facts.track, ...facts.saved } : null, member, facts.stayOff), LIFETIME.farewell),
      onLeaving: acceptWith(interaction, replies.leaving()),
    });
    if (!r.ok) return refuse(interaction, r);

    // 봇이 음성 채널에 없고 상주 모드만 켜져 있었다(StayKeeper가 재접속을 기다리는 중). 상주 모드를 끈 것만 알린다
    if (r.left === "seat-only") return toAll(interaction, replies.stayOff(false, member), LIFETIME.result);
    // 플레이어 없이 봇만 음성 채널에 남아 있었다(곡이 끝난 뒤 나갈 예약이 아직 돌지 않았다)
    if (r.left === "voice-only") return toAll(interaction, replies.left(null, member, r.stayOff), LIFETIME.farewell);
  },
};
export default exported;
