import { formatBytes, formatDuration, formatSpan } from "../src/ui/format.ts";
import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } from "discord.js";
import config from "../config.ts";
import * as audioCache from "../src/store/audioCache.ts";
import type { AnywhereCommand } from "../src/app/commandLoader.ts";

const GB2 = { gbDigits: 2 };

// 총 재생 시간. 100시간이 넘으면 분은 뺀다
function totalPlayed(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  return hours >= 100 ? `${hours}시간` : formatSpan(seconds, { days: false });
}

function usageBar(used: number, max: number, width = 12) {
  if (!max) return "─".repeat(width);
  const pct = Math.min(1, used / max);
  const filled = Math.round(pct * width);
  const color = pct > 0.9 ? "🔴" : pct > 0.7 ? "🟡" : "🟢";
  return `${color} ${"█".repeat(filled)}${"░".repeat(width - filled)} ${(pct * 100).toFixed(1)}%`;
}

const exported: AnywhereCommand = {
  anywhere: true,
  data: new SlashCommandBuilder().setName("cachestatus").setDescription("Show audio cache statistics").setDescriptionLocalizations({ ko: "오디오 캐시 통계를 표시합니다" }).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, _client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const stats = audioCache.getCacheStats();

    // 캐시 현황
    const sizeBar = usageBar(stats.totalSize, stats.maxSize);
    const countBar = usageBar(stats.fileCount, stats.maxFiles);
    const diskPct = stats.diskFree !== Infinity ? `${formatBytes(stats.diskFree, GB2)} 여유` : "측정 불가";

    const overview = [`**용량:** ${sizeBar}`, `\`${formatBytes(stats.totalSize, GB2)}\` / \`${formatBytes(stats.maxSize, GB2)}\``, `**파일 수:** ${countBar}`, `\`${stats.fileCount}개\` / \`${stats.maxFiles}개\``, `**디스크 여유:** ${diskPct} (최소 ${formatBytes(stats.minFreeDisk, GB2)})`].join("\n");

    // 재생 통계
    const avgDuration = stats.fileCount > 0 ? Math.round(stats.totalDuration / stats.fileCount) : 0;

    const playStats = [`**총 재생 횟수:** ${stats.totalPlays.toLocaleString()}회`, `**총 재생 시간:** ${totalPlayed(stats.totalDuration)}`, `**평균 곡 길이:** ${formatSpan(avgDuration, { days: false, withSeconds: true })}`, `**한 번도 안 재생:** ${stats.neverPlayed}개`].join("\n");

    // 플랫폼 분포
    const platforms = [`🔴 YouTube: **${stats.platforms.youtube}**개`, `🟠 SoundCloud: **${stats.platforms.soundcloud}**개`, `🔗 직접 링크: **${stats.platforms.direct}**개`].join("\n");

    // 기타
    const misc = [`**URL 매핑:** ${stats.lookupCount}개`, `**다운로드 중:** ${stats.downloading}개`, `**재생 보호 중:** ${stats.protectedCount}개`].join("\n");

    // 인기 TOP 5
    let topTracksText = "데이터 없음";
    if (stats.topTracks.length > 0) {
      topTracksText = stats.topTracks
        .map((t, i) => {
          const dur = formatDuration(t.duration_sec, "?:??");
          const title = t.title && t.title.length > 35 ? t.title.slice(0, 33) + "…" : (t.title ?? "제목 없음");
          return `\`${i + 1}.\` **${title}**: ${t.play_count}회 (${dur})`;
        })
        .join("\n");
    }

    // 최근 추가 TOP 3
    let recentText = "데이터 없음";
    if (stats.recentTracks.length > 0) {
      recentText = stats.recentTracks
        .map((t) => {
          const date = t.downloaded_at ? new Date(t.downloaded_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "알 수 없음";
          const title = t.title && t.title.length > 35 ? t.title.slice(0, 33) + "…" : (t.title ?? "제목 없음");
          return `**${title}** (${date})`;
        })
        .join("\n");
    }

    const embed = new EmbedBuilder()
      .setTitle("📦 오디오 캐시 현황")
      .setColor(config.bot.embedColor)
      .addFields({ name: "💿 캐시 현황", value: overview, inline: false }, { name: "▶️ 재생 통계", value: playStats, inline: true }, { name: "🌐 플랫폼 분포", value: platforms, inline: true }, { name: "🔧 기타", value: misc, inline: false }, { name: "🏆 재생 TOP 5", value: topTracksText, inline: false }, { name: "🆕 최근 추가", value: recentText, inline: false })
      .setFooter({ text: `캐시 경로: audio_cache/` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
export default exported;
