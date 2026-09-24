import { SlashCommandBuilder } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";

const exported = {
  data: new SlashCommandBuilder().setName("previous").setDescription("Play the previous track").setDescriptionLocalizations({ ko: "이전 곡을 재생합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.previous(client.players.get(guild.id), { member });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    await interaction.reply({ content: r.restarted ? "🔂 한곡 반복 중. 현재 곡을 처음부터 다시 재생합니다!" : "⏮️ 이전 노래로 이동했습니다!", flags: [1 << 6] });
  },
};
export default exported;
export { exported as "module.exports" };
