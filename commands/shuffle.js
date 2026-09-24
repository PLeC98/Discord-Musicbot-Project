import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import config from "../config.ts";
import controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";

const exported = {
  data: new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the queue").setDescriptionLocalizations({ ko: "대기열을 무작위로 섞습니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.shuffle(client.players.get(guild.id), { member });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const embed = new EmbedBuilder()
      .setTitle("🔀 대기열 셔플됨")
      .setDescription(`${r.count}개의 노래가 셔플되었습니다!`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 셔플한 사람", value: `${member}`, inline: true });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },
};
export default exported;
export { exported as "module.exports" };
