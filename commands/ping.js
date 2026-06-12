'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency')
        .setDescriptionLocalizations({ ko: '봇 응답 레이턴시를 확인합니다' }),

    async execute(interaction, client) {
        const sent = await interaction.reply({ content: '핑 측정 중...', fetchReply: true, flags: [1 << 6] });

        const botLatency  = sent.createdTimestamp - interaction.createdTimestamp;
        const wsLatency   = Math.round(client.ws.ping);

        const botStatus  = botLatency  < 100 ? '🟢' : botLatency  < 300 ? '🟡' : '🔴';
        const wsStatus   = wsLatency   < 100 ? '🟢' : wsLatency   < 300 ? '🟡' : '🔴';

        const embed = new EmbedBuilder()
            .setTitle('🏓 퐁!')
            .setColor(config.bot.embedColor)
            .addFields(
                { name: `${botStatus} 봇 응답`,       value: `\`${botLatency}ms\``,  inline: true },
                { name: `${wsStatus} Discord API`,    value: `\`${wsLatency}ms\``,   inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ content: '', embeds: [embed] });
    }
};
