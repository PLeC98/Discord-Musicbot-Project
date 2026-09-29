import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import type { AnywhereCommand } from "../src/app/commandLoader.ts";
import { colorOf } from "../src/ui/colors.ts";

const exported: AnywhereCommand = {
  anywhere: true,
  data: new SlashCommandBuilder().setName("ping").setDescription("Check bot latency").setDescriptionLocalizations({ ko: "봇 응답 레이턴시를 확인합니다" }).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, client) {
    const { resource } = await interaction.reply({ content: "핑 측정 중...", withResponse: true, flags: MessageFlags.Ephemeral });
    // 보낸 응답의 시각. 응답이 안 실려 오면 지금으로 본다
    const sentAt = resource?.message?.createdTimestamp ?? Date.now();

    const botLatency = sentAt - interaction.createdTimestamp;
    const wsLatency = Math.round(client.ws.ping);
    const wsReady = wsLatency >= 0;

    const botStatus = botLatency < 100 ? "🟢" : botLatency < 300 ? "🟡" : "🔴";
    const wsStatus = !wsReady ? "⚪" : wsLatency < 100 ? "🟢" : wsLatency < 300 ? "🟡" : "🔴";

    const embed = new EmbedBuilder()
      .setTitle("🏓 퐁!")
      .setColor(colorOf("brand"))
      .addFields({ name: `${botStatus} 봇 응답`, value: `\`${botLatency}ms\``, inline: true }, { name: `${wsStatus} Discord API`, value: wsReady ? `\`${wsLatency}ms\`` : "`측정 중...`", inline: true })
      .setTimestamp();

    await interaction.editReply({ content: "", embeds: [embed] });
  },
};
export default exported;
