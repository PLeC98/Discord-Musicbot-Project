// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import config from "../config.ts";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";

const exported = {
  data: new SlashCommandBuilder().setName("replay").setDescription("Restart the current track from the beginning").setDescriptionLocalizations({ ko: "현재 곡을 처음부터 재생합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.replay(client.players.get(guild.id), { member }, { onAccepted: () => interaction.deferReply({ flags: [1 << 6] }) });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const embed = new EmbedBuilder()
      .setTitle("🔄 처음부터 다시 재생")
      .setDescription(`**[${r.track.title}](${r.track.pageUrl})**`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 요청한 사람", value: `${member}`, inline: true });

    if (r.track.thumbnail) embed.setThumbnail(r.track.thumbnail);

    await interaction.editReply({ embeds: [embed] });
  },
};
export default exported;
export { exported as "module.exports" };
