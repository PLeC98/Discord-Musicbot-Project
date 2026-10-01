import { SlashCommandBuilder } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import * as replies from "../src/ui/controlReplies.ts";
import { noticeReply, reply } from "../src/ui/frame.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a specific track from the queue")
    .setDescriptionLocalizations({ ko: "대기열에서 특정 곡을 제거합니다" })
    .addIntegerOption((option) => option.setName("position").setDescription("Position in queue (e.g. 1 = next song)").setDescriptionLocalizations({ ko: "대기열 순서 (예: 1 = 다음 곡)" }).setRequired(true).setMinValue(1)),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    // 사람은 1부터 센다
    const r = await controls.remove(client.players.get(guild.id), { member }, interaction.options.getInteger("position", true) - 1);
    if (!r.ok) return interaction.reply(noticeReply(controlMessage(r)));

    await interaction.reply(reply(replies.removed(r.track, r.left, member)));
  },
};
export default exported;
