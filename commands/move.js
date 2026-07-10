'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');
const S = require('../src/strings');
const { checkControl } = require('../src/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('move')
        .setDescription('Move a track to a different position in the queue')
        .setDescriptionLocalizations({ ko: '대기열에서 곡 순서를 변경합니다' })
        .addIntegerOption(option =>
            option.setName('from')
                .setDescription('Current position of the track')
                .setDescriptionLocalizations({ ko: '변경할 곡의 현재 위치' })
                .setRequired(true)
                .setMinValue(1)
        )
        .addIntegerOption(option =>
            option.setName('to')
                .setDescription('New position for the track')
                .setDescriptionLocalizations({ ko: '변경할 위치' })
                .setRequired(true)
                .setMinValue(1)
        ),

    async execute(interaction, client) {
        const { guild, member } = interaction;

        const player = client.players.get(guild.id);
        if (!player)
            return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

        const permErr = await checkControl(member);
        if (permErr) return interaction.reply({ content: permErr, flags: [1 << 6] });

        if (player.queue.length < 2)
            return interaction.reply({ content: '❌ 순서를 변경하려면 대기열에 2곡 이상 있어야 합니다.', flags: [1 << 6] });

        const from = interaction.options.getInteger('from');
        const to = interaction.options.getInteger('to');
        const max = player.queue.length;

        if (from > max || to > max)
            return interaction.reply({ content: `❌ 유효한 범위를 입력하세요. (1–${max})`, flags: [1 << 6] });

        if (from === to)
            return interaction.reply({ content: '❌ 현재 위치와 이동할 위치가 같습니다.', flags: [1 << 6] });

        const track = player.queue[from - 1];
        player.moveInQueue(from - 1, to - 1);

        const embed = new EmbedBuilder()
            .setTitle('🔀 순서 변경됨')
            .setDescription(`**[${track.title}](${track.url})**`)
            .setColor(config.bot.embedColor)
            .setTimestamp()
            .addFields(
                { name: '📍 이동 전', value: `${from}번째`, inline: true },
                { name: '📍 이동 후', value: `${to}번째`, inline: true },
                { name: '👤 변경한 사람', value: `${member}`, inline: true }
            );

        await interaction.reply({ embeds: [embed], flags: [1 << 6] });

        if (client.musicEmbedManager)
            await client.musicEmbedManager.updateNowPlayingEmbed(player);
    }
};
