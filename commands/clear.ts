import { SlashCommandBuilder } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import * as replies from "../src/ui/controlReplies.ts";
import { noticeReply, reply } from "../src/ui/frame.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("clear").setDescription("Clear the queue").setDescriptionLocalizations({ ko: "대기열을 비웁니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.clear(client.players.get(guild.id), { member });
    if (!r.ok) return interaction.reply(noticeReply(controlMessage(r)));

    await interaction.reply(reply(replies.cleared(r.count, member)));
  },
};
export default exported;
