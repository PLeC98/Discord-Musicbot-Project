"use strict";

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const config = require("../config");

module.exports = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Check bot latency").setDescriptionLocalizations({ ko: "봇 응답 레이턴시를 확인합니다" }).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, client) {
    const { resource } = await interaction.reply({ content: "핑 측정 중...", withResponse: true, flags: [1 << 6] });
    const sent = resource.message;

    const botLatency = sent.createdTimestamp - interaction.createdTimestamp;
    const wsLatency = Math.round(client.ws.ping);
    const wsReady = wsLatency >= 0;

    const botStatus = botLatency < 100 ? "🟢" : botLatency < 300 ? "🟡" : "🔴";
    const wsStatus = !wsReady ? "⚪" : wsLatency < 100 ? "🟢" : wsLatency < 300 ? "🟡" : "🔴";

    const embed = new EmbedBuilder()
      .setTitle("🏓 퐁!")
      .setColor(config.bot.embedColor)
      .addFields({ name: `${botStatus} 봇 응답`, value: `\`${botLatency}ms\``, inline: true }, { name: `${wsStatus} Discord API`, value: wsReady ? `\`${wsLatency}ms\`` : "`측정 중...`", inline: true })
      .setTimestamp();

    await interaction.editReply({ content: "", embeds: [embed] });
  },
};
