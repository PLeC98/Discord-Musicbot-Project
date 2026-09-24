import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import config from "../config.js";
import controls from "../src/usecases/controls.js";
import controlMessages from "../src/ui/controlMessages.js";
const { controlMessage } = controlMessages;

const exported = {
  data: new SlashCommandBuilder().setName("skip").setDescription("Skip the current track").setDescriptionLocalizations({ ko: "현재 재생 중인 곡을 건너뜁니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.skip(client.players.get(guild.id), { member });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    if (r.restarted) return interaction.reply({ content: `🔂 한곡 반복 중. **${r.track.title}**을(를) 처음부터 다시 재생합니다! (다음 곡으로 가려면 반복을 해제하세요)`, flags: [1 << 6] });

    const embed = new EmbedBuilder()
      .setTitle("⏭️ 노래 건너뜀")
      .setDescription(`**[${r.track.title}](${r.track.pageUrl})** 건너뜀!`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 건너뛴 사람", value: `${member}`, inline: true });

    if (r.track.thumbnail) embed.setThumbnail(r.track.thumbnail);

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },
};
export default exported;
export { exported as "module.exports" };
