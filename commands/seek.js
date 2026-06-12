'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');
const S = require('../src/strings');

/**
 * Parses a time string into milliseconds.
 * Supports: "120" (seconds), "1:20" (m:ss), "1:20:55" (h:mm:ss), "3m20s", "1m 50s", "1h20m30s"
 * Returns null if invalid.
 */
function parseTimeInput(input) {
    const str = input.trim();

    // Plain integer seconds
    if (/^\d+$/.test(str)) return parseInt(str) * 1000;

    // Colon format: [h:]m:ss
    const colonMatch = str.match(/^(?:(\d+):)?(\d+):(\d{1,2})$/);
    if (colonMatch) {
        const h = parseInt(colonMatch[1] || 0);
        const m = parseInt(colonMatch[2]);
        const s = parseInt(colonMatch[3]);
        return (h * 3600 + m * 60 + s) * 1000;
    }

    // hms format: 1h20m30s, 3m20s, 45s, etc.
    const hMatch = str.match(/(\d+)\s*h/i);
    const mMatch = str.match(/(\d+)\s*m(?!s)/i);
    const sMatch = str.match(/(\d+)\s*s/i);
    if (hMatch || mMatch || sMatch) {
        const h = hMatch ? parseInt(hMatch[1]) : 0;
        const m = mMatch ? parseInt(mMatch[1]) : 0;
        const s = sMatch ? parseInt(sMatch[1]) : 0;
        return (h * 3600 + m * 60 + s) * 1000;
    }

    return null;
}

function formatMs(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('seek')
        .setDescription('Seek to a specific time in the current track')
        .setDescriptionLocalizations({ ko: '현재 곡의 특정 시간으로 이동합니다' })
        .addStringOption(option =>
            option.setName('time')
                .setDescription('Target time (e.g. 1:30, 3m20s, 90)')
                .setDescriptionLocalizations({ ko: '이동할 시간 (예: 1:30, 3m20s, 90)' })
                .setRequired(true)
        ),

    async execute(interaction, client) {
        const { guild, member } = interaction;

        if (!member.voice.channel)
            return interaction.reply({ content: S.ERR_VOICE_REQUIRED, flags: [1 << 6] });

        const player = client.players.get(guild.id);
        if (!player)
            return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

        if (player.voiceChannel?.id !== member.voice.channel.id)
            return interaction.reply({ content: S.ERR_SAME_CHANNEL, flags: [1 << 6] });

        if (!member.permissions.has('ManageGuild') &&
            !member.roles.cache.some(r => r.name.toLowerCase().includes('dj')))
            return interaction.reply({ content: S.ERR_NOT_AUTHORIZED, flags: [1 << 6] });

        if (!player.currentTrack)
            return interaction.reply({ content: S.ERR_NO_SONG_PLAYING, flags: [1 << 6] });

        const timeInput = interaction.options.getString('time');
        const seekMs = parseTimeInput(timeInput);

        if (seekMs === null)
            return interaction.reply({ content: '❌ 올바른 형식으로 입력하세요. (예: `1:30`, `3m20s`, `90`)', flags: [1 << 6] });

        const durationMs = (player.currentTrack.duration || 0) * 1000;
        if (durationMs > 0 && seekMs >= durationMs)
            return interaction.reply({ content: `❌ 입력한 시간이 곡 길이를 초과합니다. (최대: ${formatMs(durationMs)})`, flags: [1 << 6] });

        await interaction.deferReply({ flags: [1 << 6] });

        await player.play(null, seekMs);

        const embed = new EmbedBuilder()
            .setTitle('⏩ 시간 이동')
            .setDescription(`**[${player.currentTrack.title}](${player.currentTrack.url})**`)
            .setColor(config.bot.embedColor)
            .setTimestamp()
            .addFields({ name: '⏱️ 이동한 위치', value: `\`${formatMs(seekMs)}\``, inline: true });

        await interaction.editReply({ embeds: [embed] });

        if (client.musicEmbedManager)
            await client.musicEmbedManager.updateNowPlayingEmbed(player);
    }
};
