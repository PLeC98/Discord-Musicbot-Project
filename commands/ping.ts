import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import type { AnywhereCommand } from "../src/app/commandLoader.ts";
import { colorOf } from "../src/ui/colors.ts";
import * as infoText from "../src/ui/text/ko/info.ts";

const exported: AnywhereCommand = {
  help: { section: "info", tier: "moderator" },
  anywhere: true,
  data: new SlashCommandBuilder().setName("ping").setDescription("Check bot latency").setDescriptionLocalizations({ ko: "봇의 응답 시간을 측정해요" }).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, client) {
    const { resource } = await interaction.reply({ content: infoText.pinging(), withResponse: true, flags: MessageFlags.Ephemeral });
    // 보낸 응답의 시각. 응답이 안 실려 오면 지금으로 본다
    const sentAt = resource?.message?.createdTimestamp ?? Date.now();

    const botLatency = sentAt - interaction.createdTimestamp;
    const wsLatency = Math.round(client.ws.ping);
    const wsReady = wsLatency >= 0;

    const botStatus = botLatency < 100 ? "🟢" : botLatency < 300 ? "🟡" : "🔴";
    const wsStatus = !wsReady ? "⚪" : wsLatency < 100 ? "🟢" : wsLatency < 300 ? "🟡" : "🔴";

    const t = infoText.ping({ botMark: botStatus, botMs: botLatency, apiMark: wsStatus, apiMs: wsReady ? wsLatency : null });
    const embed = new EmbedBuilder()
      .setTitle(t.title)
      .setColor(colorOf("brand"))
      .addFields({ ...t.bot, inline: true }, { ...t.api, inline: true })
      .setTimestamp();

    await interaction.editReply({ content: "", embeds: [embed] });
  },
};
export default exported;
