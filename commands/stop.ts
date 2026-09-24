// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";

const exported = {
  data: new SlashCommandBuilder().setName("stop").setDescription("Stop playback and disconnect from voice channel").setDescriptionLocalizations({ ko: "재생을 정지하고 음성 채널에서 퇴장합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.stop(client.players.get(guild.id), { member }, client.players);
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const embed = new EmbedBuilder()
      .setTitle("⏹️ 음악 중지됨")
      .setDescription(`${r.track ? `**[${r.track.title}](${r.track.pageUrl})**` : "Music"} 중지됨!`)
      .setColor("#FF0000")
      .setTimestamp()
      .addFields({ name: "👤 중지한 사람", value: `${member}`, inline: true });

    if (r.cleared > 0) embed.setFooter({ text: `대기열에서 ${r.cleared}개의 노래가 제거되었습니다` });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },
};
export default exported;
export { exported as "module.exports" };
