import { formatBytes, formatSpan } from "../src/ui/format.ts";
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, version as djsVersion } from "discord.js";
import os from "os";
import config from "../config.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import type { Client } from "discord.js";
import { SYSTEM, customId } from "../src/ui/customIds.ts";

const UPTIME = { withSeconds: true };

function loadBar(used: number, total: number, width = 10) {
  const pct = Math.min(1, used / total);
  const filled = Math.round(pct * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${(pct * 100).toFixed(1)}%`;
}

function buildSystemEmbed(client: Client<true>) {
  const mem = process.memoryUsage();
  const cpus = os.cpus();
  const load = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const guildCount = client.guilds.cache.size;
  const activeCount = client.players?.size ?? 0;

  const embed = new EmbedBuilder()
    .setTitle("🖥️ 시스템 상태")
    .setColor(config.bot.embedColor)
    .setThumbnail(client.user.displayAvatarURL())
    .addFields(
      {
        name: "⏱️ 업타임",
        value: [`**봇:** ${formatSpan(process.uptime(), UPTIME)}`, `**OS:** ${formatSpan(os.uptime(), UPTIME)}`].join("\n"),
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

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(customId(SYSTEM, "refresh")).setLabel("새로고침").setEmoji("🔄").setStyle(ButtonStyle.Secondary));

  return { embed, row };
}

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("system").setDescription("Show bot system information").setDescriptionLocalizations({ ko: "봇 시스템 정보를 표시합니다" }),

  async execute(interaction, client) {
    // 호스트 CPU/메모리/디스크 정보 노출. Discord 권한으로 표현할 수 없는 봇 운영자(OWNER_ID) 전용
    if (interaction.user.id !== config.dashboard.ownerId) {
      return interaction.reply({ content: "❌ 봇 운영자만 사용할 수 있습니다!", flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { embed, row } = buildSystemEmbed(client);
    await interaction.editReply({ embeds: [embed], components: [row] });
  },
};
export default exported;
export { buildSystemEmbed };
