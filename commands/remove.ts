// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import config from "../config.ts";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";

const exported = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a specific track from the queue")
    .setDescriptionLocalizations({ ko: "대기열에서 특정 곡을 제거합니다" })
    .addIntegerOption((option) => option.setName("position").setDescription("Position in queue (e.g. 1 = next song)").setDescriptionLocalizations({ ko: "대기열 순서 (예: 1 = 다음 곡)" }).setRequired(true).setMinValue(1)),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    // 사람은 1부터 센다
    const r = await controls.remove(client.players.get(guild.id), { member }, interaction.options.getInteger("position") - 1);
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const embed = new EmbedBuilder()
      .setTitle("🗑️ 곡 제거됨")
      .setDescription(`**[${r.track.title}](${r.track.pageUrl})**`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 제거한 사람", value: `${member}`, inline: true }, { name: "📋 남은 대기열", value: `${r.left}곡`, inline: true });

    if (r.track.thumbnail) embed.setThumbnail(r.track.thumbnail);

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },
};
export default exported;
export { exported as "module.exports" };
