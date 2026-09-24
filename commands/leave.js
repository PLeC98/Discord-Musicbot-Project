import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import config from "../config.ts";
import controls from "../src/usecases/controls.js";
import controlMessages from "../src/ui/controlMessages.js";
const { controlMessage } = controlMessages;

const exported = {
  data: new SlashCommandBuilder().setName("leave").setDescription("Leave the voice channel and save the current queue for later").setDescriptionLocalizations({ ko: "음성 채널에서 나가고 현재 대기열을 저장합니다" }),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const r = await controls.leave(guild, { member }, client.players);
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    // 플레이어는 없었지만 봇이 음성 채널에 남아 있었다(음악이 끝난 뒤 자동 퇴장 타이머가 아직 안 돌았다)
    if (r.left === "voice-only") return interaction.reply({ content: "👋 음성 채널에서 나갔습니다!", flags: [1 << 6] });

    const embed = new EmbedBuilder()
      .setTitle("👋 채널에서 나갔습니다")
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 실행한 사람", value: `${member}`, inline: true });

    if (r.track) {
      const m = Math.floor(r.saved.positionSec / 60);
      const s = String(r.saved.positionSec % 60).padStart(2, "0");
      embed.setDescription(`**[${r.track.title}](${r.track.pageUrl})**`).addFields({ name: "⏱️ 저장된 위치", value: `\`${m}:${s}\``, inline: true }, { name: "📋 저장된 대기열", value: `${r.saved.queue}곡`, inline: true });
    }

    embed.setFooter({ text: "/join 으로 이전 세션을 복구할 수 있습니다." });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },
};
export default exported;
export { exported as "module.exports" };
