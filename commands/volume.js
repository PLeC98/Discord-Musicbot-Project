import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import config from "../config.ts";
import controls from "../src/usecases/controls.js";
import controlMessages from "../src/ui/controlMessages.ts";
const { controlMessage } = controlMessages;

const exported = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set the playback volume")
    .setDescriptionLocalizations({ ko: "재생 볼륨을 설정합니다" })
    .addIntegerOption((option) => option.setName("level").setDescription("Volume level (0. 100)").setDescriptionLocalizations({ ko: "볼륨 크기 (0. 100)" }).setRequired(true).setMinValue(0).setMaxValue(100)),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.volume(client.players.get(guild.id), { member }, interaction.options.getInteger("level"));
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const volumeBar = "█".repeat(Math.round(r.level / 10)) + "░".repeat(10 - Math.round(r.level / 10));

    const embed = new EmbedBuilder()
      .setTitle("🔊 볼륨이 변경되었습니다")
      .setDescription(`볼륨이 **${r.level}%**로 설정되었습니다!\n\`[${volumeBar}] ${r.level}%\``)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "이전", value: `${r.before}%`, inline: true }, { name: "현재", value: `${r.level}%`, inline: true }, { name: "👤 변경한 사람", value: `${member}`, inline: true });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },
};
export default exported;
export { exported as "module.exports" };
