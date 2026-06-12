const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const MusicPlayer = require("../src/MusicPlayer");
const MusicEmbedManager = require("../src/MusicEmbedManager");
const ErrorHandler = require("../src/ErrorHandler");
const S = require("../src/strings");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("playfirst")
    .setDescription("Add a song to the front of the queue")
    .setDescriptionLocalizations({
      ko: "대기열 맨 앞에 곡을 추가합니다",
    })
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Song name, artist, YouTube/Spotify/SoundCloud URL or direct link")
        .setDescriptionLocalizations({
          ko: "곡 이름, 아티스트, YouTube/Spotify/SoundCloud URL 또는 직접 링크",
        })
        .setRequired(true),
    ),

  async execute(interaction, client) {
    try {
      const query = interaction.options.getString("query");
      const member = interaction.member;
      const guild = interaction.guild;
      const channel = interaction.channel;

      const validationResult = await this.validateRequest(interaction, member, guild);
      if (!validationResult.success) {
        return await interaction.reply({ content: validationResult.message, ephemeral: true });
      }

      let player = client.players.get(guild.id);
      if (!player) {
        player = new MusicPlayer(guild, channel, member.voice.channel);
        client.players.set(guild.id, player);
      }

      player.voiceChannel = member.voice.channel;
      player.textChannel = channel;

      if (!client.musicEmbedManager) {
        client.musicEmbedManager = new MusicEmbedManager(client);
      }
      const searchingMsg = `**${query}** 검색 중...`;
      const searchingContainer = client.musicEmbedManager.createSearchingContainer(searchingMsg);
      await interaction.reply({ components: [searchingContainer], flags: MessageFlags.IsComponentsV2 });

      // Cache hit shortcut — skip getTrackData() for single cached tracks.
      // Playlist URLs must bypass the cache: URL normalization strips list=,
      // so a cached single video would shadow the whole playlist.
      const CacheManager = require("../src/CacheManager");
      const YouTube = require("../src/YouTube");
      const _cacheHit = YouTube.isPlaylist(query) ? { hit: false } : CacheManager.resolveFromCache(query);
      let trackData;
      if (_cacheHit.hit) {
        trackData = { success: true, isPlaylist: false, tracks: [_cacheHit.track] };
      } else {
        trackData = await this.getTrackData(query, guild.id);
      }
      // The initial reply is CV2 — editing it with `content` is rejected, use containers
      if (!trackData.success) {
        return await interaction.editReply({
          components: [client.musicEmbedManager.createErrorContainer(trackData.message)],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      trackData.insertFirst = true;

      const embedResult = await client.musicEmbedManager.handleMusicData(guild.id, trackData, member, interaction);

      if (!embedResult.success) {
        return await interaction.editReply({
          components: [client.musicEmbedManager.createErrorContainer(embedResult.message)],
          flags: MessageFlags.IsComponentsV2,
        });
      }
    } catch (error) {
      const errorMsg = await ErrorHandler.handle(error, interaction.guild?.id, "playfirst.execute");

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({
            components: [client.musicEmbedManager.createErrorContainer(errorMsg)],
            flags: MessageFlags.IsComponentsV2,
          });
        } else {
          await interaction.reply({ content: errorMsg, ephemeral: true });
        }
      } catch (responseError) {
        console.error("Error sending error response:", responseError);
      }
    }
  },

  async validateRequest(interaction, member, guild) {
    if (!member.voice.channel) {
      return { success: false, message: S.ERR_VOICE_REQUIRED };
    }

    const permissions = member.voice.channel.permissionsFor(guild.members.me);
    if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
      return { success: false, message: S.ERR_NO_PERMISSIONS };
    }

    const botVoiceChannel = guild.members.me.voice.channel;
    if (botVoiceChannel && botVoiceChannel.id !== member.voice.channel.id) {
      return { success: false, message: S.ERR_SAME_CHANNEL };
    }

    return { success: true };
  },

  async getTrackData(query, guildId) {
    const YouTube = require("../src/YouTube");
    const Spotify = require("../src/Spotify");
    const SoundCloud = require("../src/SoundCloud");
    const DirectLink = require("../src/DirectLink");

    try {
      let tracks = [];
      let isPlaylist = false;

      const platform = this.detectPlatform(query);

      switch (platform) {
        case "youtube":
          if (YouTube.isPlaylist && YouTube.isPlaylist(query)) {
            const playlistData = await YouTube.getPlaylist(query, guildId);
            if (playlistData && playlistData.tracks && playlistData.tracks.length > 0) {
              tracks = playlistData.tracks;
              isPlaylist = true;
            } else {
              tracks = await YouTube.search(query, 1, guildId);
            }
          } else {
            tracks = await YouTube.search(query, 1, guildId);
          }
          break;

        case "spotify":
          if (Spotify.isSpotifyURL(query)) {
            const spotifyData = await Spotify.getFromURL(query, guildId);
            tracks = spotifyData || [];
            const { type } = Spotify.parseSpotifyURL(query);
            isPlaylist = type === "playlist" || type === "album" || type === "artist";
          } else {
            const spotifyData = await Spotify.search(query, 1, "track", guildId);
            tracks = spotifyData || [];
          }
          break;

        case "soundcloud":
          const soundcloudData = await SoundCloud.search(query, 1, guildId);
          tracks = soundcloudData || [];
          break;

        case "direct":
          const directData = await DirectLink.getInfo(query);
          tracks = directData || [];
          break;

        default:
          tracks = await YouTube.search(query, 1, guildId);
      }

      if (!tracks || tracks.length === 0) {
        return { success: false, message: "❌ 결과를 찾을 수 없습니다!" };
      }

      return { success: true, isPlaylist, tracks };
    } catch (error) {
      const errorMsg = await ErrorHandler.handle(error, guildId, "playfirst.getTrackData");
      return { success: false, message: errorMsg };
    }
  },

  detectPlatform(query) {
    if (query.includes("youtube.com") || query.includes("youtu.be")) return "youtube";
    if (query.includes("spotify.com")) return "spotify";
    if (query.includes("soundcloud.com")) return "soundcloud";
    if (query.startsWith("http") && (query.includes(".mp3") || query.includes(".wav") || query.includes(".ogg"))) return "direct";
    return "youtube";
  },
};
