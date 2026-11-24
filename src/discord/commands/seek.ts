import { SlashCommandBuilder } from "discord.js";
import { answerSeek } from "../interactions/control-answers.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { noticeSelf } from "../../ui/delivery.ts";
import { privateText } from "../../ui/language.ts";

/** 시간 문자열을 밀리초로. "120"(초), "1:20", "1:20:55", "3m20s", "1m 50s", "1h20m30s" 형식을 읽고, 못 읽으면 null */
function parseTimeInput(input: string) {
  const str = input.trim();

  // 숫자만이면 초
  if (/^\d+$/.test(str)) return parseInt(str) * 1000;

  // 콜론 형식: [h:]m:ss
  const colonMatch = str.match(/^(?:(\d+):)?(\d+):(\d{1,2})$/);
  if (colonMatch) {
    const h = parseInt(colonMatch[1] || "0");
    const m = parseInt(colonMatch[2]);
    const s = parseInt(colonMatch[3]);
    return (h * 3600 + m * 60 + s) * 1000;
  }

  // h, m, s 형식: 1h20m30s, 3m20s, 45s
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
  help: { section: "play", tier: "dj" },
  name: "seek",
  data: (C) =>
    new SlashCommandBuilder()
      .setName("seek")
      .setDescription(C.seek.description)
      .addStringOption((option) => option.setName("time").setDescription(C.seek.options.time.description).setRequired(true)),

  async execute(interaction, bot) {
    const seekMs = parseTimeInput(interaction.options.getString("time", true));
    if (seekMs === null) return noticeSelf(interaction, privateText(interaction).errors.notice("bad-time"));
    await answerSeek(interaction, bot.players.get(interaction.guild.id), seekMs);
  },
};
export default exported;
