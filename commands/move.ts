// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import config from "../config.ts";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";

const exported = {
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a track to a different position in the queue")
    .setDescriptionLocalizations({ ko: "대기열에서 곡 순서를 변경합니다" })
    .addIntegerOption((option) => option.setName("from").setDescription("Current position of the track").setDescriptionLocalizations({ ko: "변경할 곡의 현재 위치" }).setRequired(true).setMinValue(1))
    .addIntegerOption((option) => option.setName("to").setDescription("New position for the track").setDescriptionLocalizations({ ko: "변경할 위치" }).setRequired(true).setMinValue(1)),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const from = interaction.options.getInteger("from");
    const to = interaction.options.getInteger("to");
    // 사람은 1부터 센다
    const r = await controls.move(client.players.get(guild.id), { member }, from - 1, to - 1);
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const embed = new EmbedBuilder()
      .setTitle("🔀 순서 변경됨")
      .setDescription(`**[${r.track.title}](${r.track.pageUrl})**`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "📍 이동 전", value: `${from}번째`, inline: true }, { name: "📍 이동 후", value: `${to}번째`, inline: true }, { name: "👤 변경한 사람", value: `${member}`, inline: true });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },
};
export default exported;
export { exported as "module.exports" };
