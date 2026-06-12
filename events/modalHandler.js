const { Events, EmbedBuilder } = require('discord.js');
const config = require('../config');
const S = require('../src/strings');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return;

        const client = interaction.client;
        const guild = interaction.guild;
        const member = interaction.member;

        try {
            // Handle select menus
            if (interaction.isStringSelectMenu()) {
                if (interaction.customId.startsWith('autoplay_genre:')) {
                    await this.handleAutoplayGenre(interaction, client);
                    return;
                }
                if (interaction.customId.startsWith('music_jumpto:')) {
                    await this.handleJumpTo(interaction, client);
                    return;
                }
            }

            // Handle modals
            switch (interaction.customId) {
                case 'volume_modal':
                    await this.handleVolumeModal(interaction, client);
                    break;

                default:
                    await interaction.reply({
                        content: '❌ 알 수 없는 모달!',
                        ephemeral: true
                    });
            }
        } catch (error) {
            if (!interaction.replied && !interaction.deferred) {
                try {
                    await interaction.reply({
                        content: S.ERR_PROCESSING,
                        ephemeral: true
                    });
                } catch (replyError) {
                }
            }
        }
    },

    async handleAutoplayGenre(interaction, client) {
        const guild = interaction.guild;
        const member = interaction.member;

        const GENRE_LABELS = {
            pop: '팝', rock: '록', hiphop: '힙합', electronic: '일렉트로닉',
            jazz: '재즈', classical: '클래식', metal: '메탈', country: '컨트리',
            rnb: 'R&B', indie: '인디', latin: '라틴', kpop: 'K-POP',
            anime: '애니메', lofi: '로파이', random: '랜덤'
        };

        // Check if user is in a voice channel
        if (!member.voice.channel) {
            return await interaction.reply({
                content: S.ERR_VOICE_REQUIRED,
                flags: [1 << 6]
            });
        }

        // Get music player
        const player = client.players.get(guild.id);
        if (!player) {
            return await interaction.reply({
                content: S.ERR_NO_MUSIC,
                flags: [1 << 6]
            });
        }

        // Check if user is in the same voice channel as bot
        if (player.voiceChannel?.id !== member.voice.channel.id) {
            return await interaction.reply({
                content: S.ERR_SAME_CHANNEL,
                flags: [1 << 6]
            });
        }

        const selectedGenre = interaction.values[0];

        // Enable autoplay with selected genre
        player.autoplay = selectedGenre;

        const genreName = GENRE_LABELS[selectedGenre] || selectedGenre;
        const embed = new EmbedBuilder()
            .setTitle('🎲 자동 재생이 활성화되었습니다')
            .setDescription(`**${genreName}** 장르로 자동 재생이 설정되었습니다. 대기열이 끝나면 자동으로 재생됩니다.`)
            .setColor(config.bot.embedColor)
            .setTimestamp()
            .addFields({
                name: '👤 변경한 사람',
                value: `${member}`,
                inline: true
            });

        await interaction.reply({ embeds: [embed], flags: [1 << 6] });

        // Update the main embed to show autoplay is enabled
        if (client.musicEmbedManager) {
            await client.musicEmbedManager.updateNowPlayingEmbed(player);
        }
    },

    async handleVolumeModal(interaction, client) {

        const guild = interaction.guild;
        const member = interaction.member;

        // Check if user is in a voice channel
        if (!member.voice.channel) {
            return await interaction.reply({
                content: S.ERR_VOICE_REQUIRED,
                ephemeral: true
            });
        }

        // Get music player
        const player = client.players.get(guild.id);
        if (!player) {
            return await interaction.reply({
                content: S.ERR_NO_MUSIC,
                ephemeral: true
            });
        }

        // Check if user is in the same voice channel as bot
        if (player.voiceChannel?.id !== member.voice.channel.id) {
            return await interaction.reply({
                content: S.ERR_SAME_CHANNEL,
                ephemeral: true
            });
        }

        const volumeInput = interaction.fields.getTextInputValue('volume_input');
        const volume = parseInt(volumeInput);

        // Validate volume
        if (isNaN(volume) || volume < 0 || volume > 100) {
            return await interaction.reply({
                content: '❌ 볼륨은 0에서 100 사이의 숫자여야 합니다!',
                ephemeral: true
            });
        }

        // Set volume
        const success = player.setVolume(volume);

        if (success) {
            const embed = new EmbedBuilder()
                .setTitle('🔊 볼륨이 변경되었습니다')
                .setDescription(`볼륨이 **${volume}%**로 설정되었습니다!`)
                .setColor(config.bot.embedColor)
                .setTimestamp()
                .addFields({
                    name: '👤 설정한 사람',
                    value: `${member}`,
                    inline: true
                });

            // Visual volume bar
            const volumeBar = this.createVolumeBar(volume);
            embed.addFields({
                name: '🔉 레벨',
                value: volumeBar,
                inline: false
            });

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else {
            await interaction.reply({
                content: '❌ 볼륨을 설정하는 중 오류가 발생했습니다!',
                ephemeral: true
            });
        }
    },

    createVolumeBar(volume) {
        const barLength = 20;
        const filledBars = Math.floor((volume / 100) * barLength);
        const emptyBars = barLength - filledBars;

        const bar = '▓'.repeat(filledBars) + '░'.repeat(emptyBars);
        return `\`${bar}\` ${volume}%`;
    },

    isAuthorized(interaction, requesterId) {
        const member = interaction.member;
        if (member.permissions.has('ManageGuild')) return true;
        if (member.roles.cache.some(role => role.name.toLowerCase().includes('dj'))) return true;
        if (member.id === requesterId) return true;
        return false;
    },

    async handleJumpTo(interaction, client) {
        const guild = interaction.guild;
        const member = interaction.member;

        if (!member.voice.channel) {
            return await interaction.reply({
                content: S.ERR_VOICE_REQUIRED,
                flags: [1 << 6]
            });
        }

        const player = client.players.get(guild.id);
        if (!player) {
            return await interaction.reply({
                content: S.ERR_NO_MUSIC,
                flags: [1 << 6]
            });
        }

        if (player.voiceChannel?.id !== member.voice.channel.id) {
            return await interaction.reply({
                content: S.ERR_SAME_CHANNEL,
                flags: [1 << 6]
            });
        }

        const [, requesterId, sessionId] = interaction.customId.split(':');

        if (sessionId && player.sessionId && sessionId !== player.sessionId) {
            return await interaction.reply({
                content: S.ERR_SESSION_INVALID,
                flags: [1 << 6]
            });
        }

        if (!this.isAuthorized(interaction, requesterId)) {
            return await interaction.reply({
                content: S.ERR_NOT_AUTHORIZED,
                flags: [1 << 6]
            });
        }

        const selectedIndex = parseInt(interaction.values[0]);

        if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= player.queue.length) {
            return await interaction.reply({
                content: '❌ 선택한 곡을 대기열에서 찾을 수 없습니다!',
                flags: [1 << 6]
            });
        }

        // Splice out from current position, unshift to front
        const [selectedTrack] = player.queue.splice(selectedIndex, 1);
        player.queue.unshift(selectedTrack);
        // Force the next transition to take queue[0] even when shuffle is on
        player.nextFromFront = true;

        // Skip current → selectedTrack plays next
        const skipped = player.skip();

        if (skipped) {
            await interaction.reply({
                content: `⏭️ **${selectedTrack.title}**로 이동했습니다!`,
                flags: [1 << 6]
            });
        } else {
            // Rollback if skip failed
            player.nextFromFront = false;
            player.queue.shift();
            player.queue.splice(selectedIndex, 0, selectedTrack);
            await interaction.reply({
                content: '❌ 곡으로 이동하지 못했습니다!',
                flags: [1 << 6]
            });
        }
    }
};