import { SlashCommandBuilder } from "discord.js";
import { answerSeek } from "../interactions/controlAnswers.ts";
import { noticeReply } from "../src/ui/frame.ts";
import * as errors from "../src/ui/text/errors.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";

/**
 * 시간 문자열을 밀리초로 파싱
 * 지원 형식: "120"(초), "1:20"(m:ss), "1:20:55"(h:mm:ss), "3m20s", "1m 50s", "1h20m30s"
 * 유효하지 않으면 null을 반환
 */
function parseTimeInput(input: string) {
  const str = input.trim();

  // 일반 정수 초
  if (/^\d+$/.test(str)) return parseInt(str) * 1000;

  // 콜론 형식: [h:]m:ss
  const colonMatch = str.match(/^(?:(\d+):)?(\d+):(\d{1,2})$/);
  if (colonMatch) {
    const h = parseInt(colonMatch[1] || "0");
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

const exported: GuildCommand = {
  data: new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Seek to a specific time in the current track")
    .setDescriptionLocalizations({ ko: "현재 곡의 특정 시간으로 이동해요" })
    .addStringOption((option) => option.setName("time").setDescription("Target time (e.g. 1:30, 3m20s, 90)").setDescriptionLocalizations({ ko: "이동할 시간 (예: 1:30 · 3m20s · 90)" }).setRequired(true)),

  async execute(interaction, client) {
    const seekMs = parseTimeInput(interaction.options.getString("time", true));
    if (seekMs === null) return interaction.reply(noticeReply(errors.badTime()));
    await answerSeek(interaction, client.players.get(interaction.guild.id), seekMs);
  },
};
export default exported;
