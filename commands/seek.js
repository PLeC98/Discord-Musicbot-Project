import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import config from "../config.ts";
import controls from "../src/usecases/controls.js";
import controlMessages from "../src/ui/controlMessages.ts";
const { controlMessage } = controlMessages;

/**
 * 시간 문자열을 밀리초로 파싱
 * 지원 형식: "120"(초), "1:20"(m:ss), "1:20:55"(h:mm:ss), "3m20s", "1m 50s", "1h20m30s"
 * 유효하지 않으면 null을 반환
 */
function parseTimeInput(input) {
  const str = input.trim();

  // 일반 정수 초
  if (/^\d+$/.test(str)) return parseInt(str) * 1000;

  // 콜론 형식: [h:]m:ss
  const colonMatch = str.match(/^(?:(\d+):)?(\d+):(\d{1,2})$/);
  if (colonMatch) {
    const h = parseInt(colonMatch[1] || 0);
    const m = parseInt(colonMatch[2]);
    const s = parseInt(colonMatch[3]);
    return (h * 3600 + m * 60 + s) * 1000;
  }

  // hms 형식: 1h20m30s, 3m20s, 45s 등
  const hMatch = str.match(/(\d+)\s*h/i);
  const mMatch = str.match(/(\d+)\s*m(?!s)/i);
  const sMatch = str.match(/(\d+)\s*s/i);
  if (hMatch || mMatch || sMatch) {
    const h = hMatch ? parseInt(hMatch[1]) : 0;
    const m = mMatch ? parseInt(mMatch[1]) : 0;
    const s = sMatch ? parseInt(sMatch[1]) : 0;
    return (h * 3600 + m * 60 + s) * 1000;
  }

  return null;
}

function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const exported = {
  data: new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Seek to a specific time in the current track")
    .setDescriptionLocalizations({ ko: "현재 곡의 특정 시간으로 이동합니다" })
    .addStringOption((option) => option.setName("time").setDescription("Target time (e.g. 1:30, 3m20s, 90)").setDescriptionLocalizations({ ko: "이동할 시간 (예: 1:30, 3m20s, 90)" }).setRequired(true)),

  async execute(interaction, client) {
    const { guild, member } = interaction;
    const seekMs = parseTimeInput(interaction.options.getString("time"));
    if (seekMs === null) return interaction.reply({ content: "❌ 올바른 형식으로 입력하세요. (예: `1:30`, `3m20s`, `90`)", flags: [1 << 6] });

    const r = await controls.seek(client.players.get(guild.id), { member }, seekMs, { reason: "seek", onAccepted: () => interaction.deferReply({ flags: [1 << 6] }) });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const embed = new EmbedBuilder()
      .setTitle("⏩ 시간 이동")
      .setDescription(`**[${r.track.title}](${r.track.pageUrl})**`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "⏱️ 이동한 위치", value: `\`${formatMs(r.ms)}\``, inline: true });

    await interaction.editReply({ embeds: [embed] });
  },
};
export default exported;
export { exported as "module.exports" };
