import { SlashCommandBuilder } from "discord.js";
import { answerSeek } from "../interactions/control-answers.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { noticeSelf } from "../../ui/delivery.ts";

/** 시간 글자를 밀리초로. "120"(초) · "1:20" · "1:20:55" · "3m20s" · "1m 50s" · "1h20m30s" 꼴을 읽고, 못 읽으면 null */
function parseTimeInput(input: string) {
  const str = input.trim();

  // 숫자만이면 초
  if (/^\d+$/.test(str)) return parseInt(str) * 1000;

  // 쌍점 꼴: [h:]m:ss
  const colonMatch = str.match(/^(?:(\d+):)?(\d+):(\d{1,2})$/);
  if (colonMatch) {
    const h = parseInt(colonMatch[1] || "0");
    const m = parseInt(colonMatch[2]);
    const s = parseInt(colonMatch[3]);
    return (h * 3600 + m * 60 + s) * 1000;
  }

  // h · m · s 꼴: 1h20m30s · 3m20s · 45s
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
  data: new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Seek to a specific time in the current track")
    .setDescriptionLocalizations({ ko: "현재 곡의 특정 시간으로 이동해요" })
    .addStringOption((option) => option.setName("time").setNameLocalizations({ ko: "시간" }).setDescription("Target time (e.g. 1:30, 3m20s, 90)").setDescriptionLocalizations({ ko: "이동할 시간 (예: 1:30 · 3m20s · 90)" }).setRequired(true)),

  async execute(interaction, bot) {
    const seekMs = parseTimeInput(interaction.options.getString("time", true));
    if (seekMs === null) return noticeSelf(interaction, errors.notice("bad-time"));
    await answerSeek(interaction, bot.players.get(interaction.guild.id), seekMs);
  },
};
export default exported;
