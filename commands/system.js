"use strict";

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const os = require("os");
const config = require("../config");

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}일 ${h}시간 ${m}분`;
  if (h > 0) return `${h}시간 ${m}분 ${s}초`;
  return `${m}분 ${s}초`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function loadBar(used, total, width = 10) {
  const pct = Math.min(1, used / total);
  const filled = Math.round(pct * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${(pct * 100).toFixed(1)}%`;
}

module.exports = {
  data: new SlashCommandBuilder().setName("system").setDescription("Show bot system information").setDescriptionLocalizations({ ko: "봇 시스템 정보를 표시합니다" }),

  buildSystemEmbed(client) {
    const mem = process.memoryUsage();
    const cpus = os.cpus();
    const load = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const guildCount = client.guilds.cache.size;
    const activeCount = client.players?.size ?? 0;
    const djsVersion = require("discord.js").version;

    const embed = new EmbedBuilder()
      .setTitle("🖥️ 시스템 상태")
      .setColor(config.bot.embedColor)
      .setThumbnail(client.user.displayAvatarURL())
      .addFields(
        {
          name: "⏱️ 업타임",
          value: [`**봇:** ${formatUptime(process.uptime())}`, `**OS:** ${formatUptime(os.uptime())}`].join("\n"),
          inline: true,
        },
        {
          name: "🎵 봇 현황",
          value: [`**서버:** ${guildCount}개`, `**재생 중:** ${activeCount}개`].join("\n"),
          inline: true,
        },
        {
          name: "​",
          value: "​",
          inline: true,
        },
        {
          name: "💾 메모리",
          value: [`**시스템:** ${loadBar(usedMem, totalMem)} (${formatBytes(usedMem)} / ${formatBytes(totalMem)})`, `**Heap 사용:** ${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}`, `**RSS:** ${formatBytes(mem.rss)}`].join("\n"),
          inline: false,
        },
        {
          name: "⚙️ CPU",
          value: [`**모델:** ${cpus[0]?.model ?? "알 수 없음"} (${cpus.length}코어)`, `**부하 (1m/5m/15m):** \`${load[0].toFixed(2)}\` / \`${load[1].toFixed(2)}\` / \`${load[2].toFixed(2)}\``].join("\n"),
          inline: false,
        },
        {
          name: "🔧 런타임",
          value: [`**Node.js:** ${process.version}`, `**discord.js:** v${djsVersion}`, `**플랫폼:** ${os.platform()} ${os.arch()}`, `**PID:** ${process.pid}`].join("\n"),
          inline: false,
        },
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("system_refresh").setLabel("새로고침").setEmoji("🔄").setStyle(ButtonStyle.Secondary));

    return { embed, row };
  },

  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    const { embed, row } = this.buildSystemEmbed(client);
    await interaction.editReply({ embeds: [embed], components: [row] });
  },
};
