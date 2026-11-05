import { formatBytes, formatDuration, formatSpan } from "../../ui/format.ts";
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import * as audioCache from "../../store/audio-cache.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { isBotOwner } from "../../usecases/permissions.ts";
import { colorOf } from "../../ui/colors.ts";
import * as infoText from "../../ui/text/ko/info.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { LIFETIME, expireSelf, noticeSelf } from "../../ui/delivery.ts";

const GB2 = { gbDigits: 2 };

// 총 재생 시간. 100시간 이상이면 분은 뺀다
function totalPlayed(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  return hours >= 100 ? infoText.hours(hours) : formatSpan(seconds, { days: false });
}

function usageBar(used: number, max: number, width = 12) {
  if (!max) return "─".repeat(width);
  const pct = Math.min(1, used / max);
  const filled = Math.round(pct * width);
  const color = pct > 0.9 ? "🔴" : pct > 0.7 ? "🟡" : "🟢";
  return `${color} ${"█".repeat(filled)}${"░".repeat(width - filled)} ${(pct * 100).toFixed(1)}%`;
}

const exported: GuildCommand = {
  help: { section: "info", tier: "owner" },
  data: new SlashCommandBuilder().setName("cachestatus").setDescription("오디오 캐시 통계를 보여줘요"),

  async execute(interaction) {
    // 캐시는 모든 서버가 함께 쓴다. 다른 서버에서 들은 곡과 호스트 디스크 여유가 나간다
    if (!isBotOwner(interaction.user.id)) return noticeSelf(interaction, errors.notice("must-owner"));

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const stats = audioCache.getCacheStats();

    const sizeBar = usageBar(stats.totalSize, stats.maxSize);
    const countBar = usageBar(stats.fileCount, stats.maxFiles);
    const avgDuration = stats.fileCount > 0 ? Math.round(stats.totalDuration / stats.fileCount) : 0;
    const t = infoText.cache({
      sizeBar,
      size: formatBytes(stats.totalSize, GB2),
      maxSize: formatBytes(stats.maxSize, GB2),
      countBar,
      files: stats.fileCount,
      maxFiles: stats.maxFiles,
      diskFree: stats.diskFree !== Infinity ? formatBytes(stats.diskFree, GB2) : null,
      minFreeDisk: formatBytes(stats.minFreeDisk, GB2),
      plays: stats.totalPlays,
      played: totalPlayed(stats.totalDuration),
      averageLength: formatSpan(avgDuration, { days: false, withSeconds: true }),
      neverPlayed: stats.neverPlayed,
      platforms: stats.platforms,
      lookups: stats.lookupCount,
      downloading: stats.downloading,
      protectedCount: stats.protectedCount,
    });
    const blank = infoText.cacheBlank();

    let topTracksText = blank.noData;
    if (stats.topTracks.length > 0) {
      topTracksText = stats.topTracks
        .map((row, i) => {
          const dur = formatDuration(row.duration_sec, "?:??");
          const title = row.title && row.title.length > 35 ? row.title.slice(0, 33) + "…" : (row.title ?? blank.untitled);
          return infoText.topLine(i + 1, title, row.play_count, dur);
        })
        .join("\n");
    }

    let recentText = blank.noData;
    if (stats.recentTracks.length > 0) {
      recentText = stats.recentTracks
        .map((row) => {
          const date = row.downloaded_at ? new Date(row.downloaded_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : blank.unknownDate;
          const title = row.title && row.title.length > 35 ? row.title.slice(0, 33) + "…" : (row.title ?? blank.untitled);
          return infoText.recentLine(title, date);
        })
        .join("\n");
    }

    const embed = new EmbedBuilder()
      .setTitle(t.title)
      .setColor(colorOf("brand"))
      .addFields({ ...t.overview, inline: false }, { ...t.plays, inline: true }, { ...t.platforms, inline: true }, { ...t.misc, inline: false }, { name: t.top, value: topTracksText, inline: false }, { name: t.recent, value: recentText, inline: false })
      .setFooter({ text: t.footer })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    expireSelf(interaction, LIFETIME.screen);
  },
};
export default exported;
