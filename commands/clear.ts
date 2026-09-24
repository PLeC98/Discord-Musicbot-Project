// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import config from "../config.ts";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";

const exported = {
  data: new SlashCommandBuilder().setName("clear").setDescription("Clear the queue").setDescriptionLocalizations({ ko: "대기열을 비웁니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.clear(client.players.get(guild.id), { member });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const embed = new EmbedBuilder()
      .setTitle("🗑️ 대기열 비워짐")
      .setDescription(`대기열에서 ${r.count}개의 노래가 제거되었습니다`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 변경한 사람", value: `${member}`, inline: true });

    if (r.track) {
      embed.addFields({
        name: "🎵 현재 재생 중",
        value: `**[${r.track.title}](${r.track.pageUrl})**`,
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },
};
export default exported;
export { exported as "module.exports" };
