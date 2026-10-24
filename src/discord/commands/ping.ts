import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import type { AnywhereCommand } from "../../app/command-loader.ts";
import { colorOf } from "../../ui/colors.ts";
import * as infoText from "../../ui/text/ko/info.ts";
import { LIFETIME, expireSelf } from "../../ui/delivery.ts";
import { latencyGrade, type LatencyGrade } from "../../rules/latency.ts";

// 응답 시간 등급의 표시
const MARK: Record<LatencyGrade, string> = { good: "🟢", fair: "🟡", poor: "🔴" };

const exported: AnywhereCommand = {
  help: { section: "info", tier: "moderator" },
  anywhere: true,
  data: new SlashCommandBuilder().setName("ping").setDescription("Check bot latency").setDescriptionLocalizations({ ko: "봇의 응답 시간을 측정해요" }).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const { resource } = await interaction.reply({ content: infoText.pinging(), withResponse: true, flags: MessageFlags.Ephemeral });
    // 보낸 응답의 시각. 응답이 안 실려 오면 지금으로 본다
    const sentAt = resource?.message?.createdTimestamp ?? Date.now();

    const botLatency = sentAt - interaction.createdTimestamp;
    const wsLatency = Math.round(interaction.client.ws.ping);
    const wsReady = wsLatency >= 0;

    const botStatus = MARK[latencyGrade(botLatency)];
    const wsStatus = !wsReady ? "⚪" : MARK[latencyGrade(wsLatency)];

    const t = infoText.ping({ botMark: botStatus, botMs: botLatency, apiMark: wsStatus, apiMs: wsReady ? wsLatency : null });
    const embed = new EmbedBuilder()
      .setTitle(t.title)
      .setColor(colorOf("brand"))
      .addFields({ ...t.bot, inline: true }, { ...t.api, inline: true })
      .setTimestamp();

    await interaction.editReply({ content: "", embeds: [embed] });
    expireSelf(interaction, LIFETIME.screen);
  },
};
export default exported;
