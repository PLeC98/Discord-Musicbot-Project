const { Events, MessageFlags } = require('discord.js');
const GuildSettingsManager = require('../src/GuildSettingsManager');
const MusicPlayer = require('../src/MusicPlayer');
const MusicEmbedManager = require('../src/MusicEmbedManager');

module.exports = {
    name: Events.MessageCreate,

    async execute(message) {
        if (message.author.bot) return;
        if (!message.guild) return;

        const guildId = message.guild.id;
        const content = message.content.trim();
        if (!content) return;

        // Check if this is the designated bot channel
        const botChannelId = await GuildSettingsManager.getBotChannel(guildId);
        if (!botChannelId || message.channel.id !== botChannelId) return;

        const client = message.client;
        const member = message.member;

        // User must be in a voice channel
        if (!member.voice.channel) {
            const reply = await message.reply('🔇 음성 채널에 먼저 접속해주세요!');
            setTimeout(() => {
                reply.delete().catch(() => {});
                message.delete().catch(() => {});
            }, 5000);
            return;
        }

        // Delete user's message to keep channel clean
        await message.delete().catch(() => {});

        // Get or create music player
        let player = client.players.get(guildId);
        if (!player) {
            player = new MusicPlayer(message.guild, message.channel, member.voice.channel);
            client.players.set(guildId, player);
        } else {
            // Redirect player output to bot channel
            player.textChannel = message.channel;
        }

        if (!player.voiceChannel || player.voiceChannel.id !== member.voice.channel.id) {
            player.voiceChannel = member.voice.channel;
        }

        // Initialize embed manager if not ready
        if (!client.musicEmbedManager) {
            client.musicEmbedManager = new MusicEmbedManager(client);
        }

        // Send initial CV2 searching placeholder — must be CV2 from creation so IS_COMPONENTS_V2
        // flag is set before the now-playing edit, matching the /play interaction reply flow
        const query = content.length > 60 ? content.slice(0, 60) + '…' : content;
        const searchingContainer = client.musicEmbedManager.createSearchingContainer(`🔍 **${query}** 검색 중...`);
        const loadingMsg = await message.channel.send({
            components: [searchingContainer],
            flags: MessageFlags.IsComponentsV2
        });

        try {
            const playCommand = require('../commands/play.js');
            // Cache hit shortcut — skip getTrackData() for single cached tracks.
            // Playlist URLs must bypass the cache: URL normalization strips list=,
            // so a cached single video would shadow the whole playlist.
            const CacheManager = require('../src/CacheManager');
            const YouTube = require('../src/YouTube');
            const _cacheHit = YouTube.isPlaylist(content) ? { hit: false } : CacheManager.resolveFromCache(content);
            let trackData;
            if (_cacheHit.hit) {
                trackData = { success: true, isPlaylist: false, tracks: [_cacheHit.track] };
            } else {
                trackData = await playCommand.getTrackData(content, guildId);
            }

            await loadingMsg.delete().catch(() => {});

            if (!trackData.success) {
                const errMsg = await message.channel.send({ content: `❌ ${trackData.message}` });
                setTimeout(() => errMsg.delete().catch(() => {}), 8000);
                return;
            }

            await client.musicEmbedManager.handleMusicData(guildId, trackData, member, null);

        } catch (error) {
            console.error('❌ [messageHandler] error:', error);
            await loadingMsg.delete().catch(() => {});
            const errMsg = await message.channel.send({ content: '❌ 처리 중 오류가 발생했어요.' });
            setTimeout(() => errMsg.delete().catch(() => {}), 8000);
        }
    }
};
