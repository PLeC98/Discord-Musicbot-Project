import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import config from "../config.ts";
import controls from "../src/usecases/controls.js";
import { controlMessage } from "../src/ui/controlMessages.ts";

const exported = {
  data: new SlashCommandBuilder().setName("pause").setDescription("Pause or resume the current track").setDescriptionLocalizations({ ko: "일시정지를 토글합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.pause(client.players.get(guild.id), { member });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const message = r.paused ? "음악 일시정지됨" : "음악 재개됨";
    const emoji = r.paused ? "⏸️" : "▶️";
    const embed = new EmbedBuilder()
      .setTitle(`${emoji} ${message}`)
      .setDescription(`**[${r.track.title}](${r.track.pageUrl})** ${message}!`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 작업자", value: `${member}`, inline: true });

    if (r.track.thumbnail) embed.setThumbnail(r.track.thumbnail);

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },
};
export default exported;
export { exported as "module.exports" };
