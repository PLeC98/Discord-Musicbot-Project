'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');
const S = require('../src/strings');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Leave the voice channel and save the current queue for later')
        .setDescriptionLocalizations({ ko: '음성 채널에서 나가고 현재 대기열을 저장합니다' }),

    async execute(interaction, client) {
        const { guild, member } = interaction;

        if (!member.voice.channel)
            return interaction.reply({ content: S.ERR_VOICE_REQUIRED, flags: [1 << 6] });

        const player = client.players.get(guild.id);

        // Player gone but bot still in voice (music ended, auto-leave timer not fired yet)
        if (!player) {
            const botVoiceChannel = guild.members.me?.voice?.channel;
            if (!botVoiceChannel)
                return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });
            if (botVoiceChannel.id !== member.voice.channel.id)
                return interaction.reply({ content: S.ERR_SAME_CHANNEL, flags: [1 << 6] });
            if (!member.permissions.has('ManageGuild') &&
                !member.roles.cache.some(r => r.name.toLowerCase().includes('dj')))
                return interaction.reply({ content: S.ERR_NOT_AUTHORIZED, flags: [1 << 6] });

            await guild.members.me.voice.disconnect();
            return interaction.reply({
                content: '👋 음성 채널에서 나갔습니다!',
                flags: [1 << 6]
            });
        }

        if (player.voiceChannel?.id !== member.voice.channel.id)
            return interaction.reply({ content: S.ERR_SAME_CHANNEL, flags: [1 << 6] });

        if (!member.permissions.has('ManageGuild') &&
            !member.roles.cache.some(r => r.name.toLowerCase().includes('dj')))
            return interaction.reply({ content: S.ERR_NOT_AUTHORIZED, flags: [1 << 6] });

        const currentTrack = player.currentTrack;
        const queueLength = player.queue.length;
        const positionSec = Math.floor((player.getCurrentTime?.() || 0) / 1000);

        // Save state and disconnect (session preserved in DB for /join restoration)
        await player.leaveAndSave();
        client.players.delete(guild.id);

        if (client.musicEmbedManager)
            await client.musicEmbedManager.handlePlaybackEnd(player);

        const embed = new EmbedBuilder()
            .setTitle('👋 채널에서 나갔습니다')
            .setColor(config.bot.embedColor)
            .setTimestamp()
            .addFields({ name: '👤 실행한 사람', value: `${member}`, inline: true });

        if (currentTrack) {
            const m = Math.floor(positionSec / 60);
            const s = String(positionSec % 60).padStart(2, '0');
            embed.setDescription(`**[${currentTrack.title}](${currentTrack.url})**`)
                .addFields(
                    { name: '⏱️ 저장된 위치', value: `\`${m}:${s}\``, inline: true },
                    { name: '📋 저장된 대기열', value: `${queueLength}곡`, inline: true }
                );
        }

        embed.setFooter({ text: '/join 으로 이전 세션을 복구할 수 있습니다.' });

        await interaction.reply({ embeds: [embed], flags: [1 << 6] });
    }
};
