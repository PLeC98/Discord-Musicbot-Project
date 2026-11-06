import { SlashCommandBuilder } from "discord.js";
import * as controls from "../../usecases/controls.ts";
import { controlMessage } from "../../ui/control-messages.ts";
import * as replies from "../../ui/control-replies.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { LIFETIME, noticeSelf, toAll } from "../../ui/delivery.ts";

const exported: GuildCommand = {
  help: { section: "channel", tier: "dj" },
  data: new SlashCommandBuilder().setName("leave").setDescription("대기열을 저장하고 음성 채널에서 나가요"),

  async execute(interaction, bot) {
    const { guild, member } = interaction;
    const r = await controls.leave(guild, { member }, bot.players);
    if (!r.ok) return noticeSelf(interaction, controlMessage(r));

    // 봇이 음성에 없고 24/7 자리만 있었다(자리 지킴이가 다시 붙기를 기다리는 중). 자리를 끈 것만 알린다
    if (r.left === "seat-only") return toAll(interaction, replies.stayOff(false, member), LIFETIME.result);
    // 플레이어 없이 봇만 음성 채널에 남아 있었다(곡이 끝난 뒤 나갈 예약이 아직 돌지 않았다)
    if (r.left === "voice-only") return toAll(interaction, replies.left(null, member, r.stayOff), LIFETIME.farewell);

    await toAll(interaction, replies.left(r.track ? { track: r.track, ...r.saved } : null, member, r.stayOff), LIFETIME.farewell);
  },
};
export default exported;
