import { SlashCommandBuilder } from "discord.js";
import * as controls from "../../usecases/controls.ts";
import { controlMessage } from "../../ui/control-messages.ts";
import * as replies from "../../ui/control-replies.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { LIFETIME, noticeSelf, toAll } from "../../ui/delivery.ts";

const exported: GuildCommand = {
  help: { section: "channel", tier: "dj" },
  data: new SlashCommandBuilder().setName("leave").setDescription("Leave the voice channel and save the current queue for later").setDescriptionLocalizations({ ko: "대기열을 저장하고 음성 채널에서 나가요" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.leave(guild, { member }, client.players);
    if (!r.ok) return noticeSelf(interaction, controlMessage(r));

    // 플레이어 없이 봇만 음성 채널에 남아 있었다(곡이 끝난 뒤 나갈 예약이 아직 돌지 않았다)
    if (r.left === "voice-only") return toAll(interaction, replies.left(null, member), LIFETIME.farewell);

    await toAll(interaction, replies.left(r.track ? { track: r.track, ...r.saved } : null, member), LIFETIME.farewell);
  },
};
export default exported;
