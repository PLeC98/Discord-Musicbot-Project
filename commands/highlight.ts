// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import config from "../config.ts";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";

function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// SponsorBlock poi_highlight(커뮤니티 하이라이트 지점)로 점프. 핵심만 듣고 /skip 하는 용도.
const exported = {
  data: new SlashCommandBuilder().setName("highlight").setDescription("Jump to the community highlight of the current track").setDescriptionLocalizations({ ko: "현재 곡의 하이라이트 지점으로 이동합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.highlight(client.players.get(guild.id), { member }, { onAccepted: () => interaction.deferReply({ flags: [1 << 6] }) });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const embed = new EmbedBuilder()
      .setTitle("✨ 하이라이트로 이동")
      .setDescription(`**[${r.track.title}](${r.track.pageUrl})**`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "⏱️ 위치", value: `\`${formatMs(r.ms)}\``, inline: true });

    await interaction.editReply({ embeds: [embed] });
  },
};
export default exported;
export { exported as "module.exports" };
