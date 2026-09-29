import { SlashCommandBuilder, MessageFlags } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import * as controlText from "../src/ui/text/controls.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("previous").setDescription("Play the previous track").setDescriptionLocalizations({ ko: "이전 곡을 재생합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.previous(client.players.get(guild.id), { member });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

    await interaction.reply({ content: controlText.previous(r.restarted), flags: MessageFlags.Ephemeral });
  },
};
export default exported;
