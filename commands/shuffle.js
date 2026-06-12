'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');
const S = require('../src/strings');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Shuffle the queue')
        .setDescriptionLocalizations({ ko: '대기열을 무작위로 섞습니다' }),

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

        if (player.queue.length < 2)
            return interaction.reply({ content: '❌ 셔플하려면 대기열에 최소 2개의 노래가 있어야 합니다!', flags: [1 << 6] });

        player.shuffleQueue();

        const embed = new EmbedBuilder()
            .setTitle('🔀 대기열 셔플됨')
            .setDescription(`${player.queue.length}개의 노래가 셔플되었습니다!`)
            .setColor(config.bot.embedColor)
            .setTimestamp()
            .addFields({ name: '👤 셔플한 사람', value: `${member}`, inline: true });

        if (player.queue.length > 0) {
            const nextTracks = player.queue.slice(0, 3);
            let trackList = '';
            nextTracks.forEach((track, i) => { trackList += `${i + 1}. **[${track.title}](${track.url})**\n`; });
            embed.addFields({ name: '🔜 다음 노래들', value: trackList, inline: false });
        }

        await interaction.reply({ embeds: [embed], flags: [1 << 6] });

        if (client.musicEmbedManager)
            await client.musicEmbedManager.updateNowPlayingEmbed(player);
    }
};
