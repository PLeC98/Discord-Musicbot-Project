import { SlashCommandBuilder } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import * as replies from "../src/ui/controlReplies.ts";
import { noticeReply, reply } from "../src/ui/frame.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("leave").setDescription("Leave the voice channel and save the current queue for later").setDescriptionLocalizations({ ko: "대기열을 저장하고 음성 채널에서 나가요" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.leave(guild, { member }, client.players);
    if (!r.ok) return interaction.reply(noticeReply(controlMessage(r)));

    // 플레이어는 없었지만 봇이 음성 채널에 남아 있었다(음악이 끝난 뒤 자동 퇴장 타이머가 아직 안 돌았다)
    if (r.left === "voice-only") return interaction.reply(reply(replies.left(null, member)));

    await interaction.reply(reply(replies.left(r.track ? { track: r.track, ...r.saved } : null, member)));
  },
};
export default exported;
