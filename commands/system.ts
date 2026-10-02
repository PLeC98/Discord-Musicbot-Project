import { formatBytes, formatSpan } from "../src/ui/format.ts";
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, version as djsVersion } from "discord.js";
import os from "os";
import config from "../config.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import type { Client } from "discord.js";
import { SYSTEM, customId } from "../src/ui/customIds.ts";
import { colorOf } from "../src/ui/colors.ts";
import * as infoText from "../src/ui/text/ko/info.ts";
import * as errors from "../src/ui/text/ko/errors.ts";
import { noticeReply } from "../src/ui/frame.ts";

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

  const t = infoText.system({
    botUptime: formatSpan(process.uptime(), UPTIME),
    osUptime: formatSpan(os.uptime(), UPTIME),
    guilds: guildCount,
    playing: activeCount,
    memoryBar: loadBar(usedMem, totalMem),
    memoryUsed: formatBytes(usedMem),
    memoryTotal: formatBytes(totalMem),
    heapUsed: formatBytes(mem.heapUsed),
    heapTotal: formatBytes(mem.heapTotal),
    rss: formatBytes(mem.rss),
    cpuModel: cpus[0]?.model,
    cores: cpus.length,
    load: load.map((n) => n.toFixed(2)),
    node: process.version,
    discordJs: djsVersion,
    platform: `${os.platform()} ${os.arch()}`,
    pid: process.pid,
  });
  const embed = new EmbedBuilder()
    .setTitle(t.title)
    .setColor(colorOf("brand"))
    .setThumbnail(client.user.displayAvatarURL())
    .addFields(
      { ...t.uptime, inline: true },
      { ...t.bot, inline: true },
      {
        name: "​",
        value: "​",
        inline: true,
      },
      { ...t.memory, inline: false },
      { ...t.cpu, inline: false },
      { ...t.runtime, inline: false },
    )
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(customId(SYSTEM, "refresh")).setLabel(infoText.refresh()).setEmoji("🔄").setStyle(ButtonStyle.Secondary));

  return { embed, row };
}

const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("system").setDescription("Show bot system information").setDescriptionLocalizations({ ko: "봇의 시스템 정보를 보여줘요" }),

  async execute(interaction, client) {
    // 호스트 CPU/메모리/디스크 정보 노출. Discord 권한으로 표현할 수 없는 봇 운영자(OWNER_ID) 전용
    if (interaction.user.id !== config.dashboard.ownerId) {
      return interaction.reply(noticeReply(errors.notice("must-owner")));
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { embed, row } = buildSystemEmbed(client);
    await interaction.editReply({ embeds: [embed], components: [row] });
  },
};
export default exported;
export { buildSystemEmbed };
