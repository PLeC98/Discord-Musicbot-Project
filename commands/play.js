const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const MusicPlayer = require("../src/MusicPlayer");
const MusicEmbedManager = require("../src/MusicEmbedManager");
const ErrorHandler = require("../src/ErrorHandler");
const S = require("../src/strings");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Plays music - Supports YouTube, Spotify, SoundCloud or direct links")
    .setDescriptionLocalizations({
      ko: "음악을 재생합니다",
    })
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Song name, artist, YouTube/Spotify/SoundCloud URL or direct link")
        .setDescriptionLocalizations({
          ko: "곡 이름, 아티스트, 유튜브/스포티파이/사운드클라우드 URL, 직접 링크",
        })
        .setRequired(true),
    ),

  async execute(interaction, client) {
    try {
      const query = interaction.options.getString("query");
      const member = interaction.member;
      const guild = interaction.guild;
      const channel = interaction.channel;

      // Validation before any reply (fast sync check)
      const validationResult = await this.validateRequest(interaction, member, guild);
      if (!validationResult.success) {
        return await interaction.reply({
          content: validationResult.message,
          ephemeral: true,
        });
      }

      // Music player al veya oluştur
      let player = client.players.get(guild.id);
      if (!player) {
        player = new MusicPlayer(guild, channel, member.voice.channel);
        client.players.set(guild.id, player);
      }

      // Player kanallarını güncelle
      player.voiceChannel = member.voice.channel;
      player.textChannel = channel;

      // Reply immediately as Components V2 from the start — ensures IS_COMPONENTS_V2 flag is set on initial message
      if (!client.musicEmbedManager) {
        client.musicEmbedManager = new MusicEmbedManager(client);
      }
      const searchingMsg = `**${query}** 검색 중...`;
      const searchingContainer = client.musicEmbedManager.createSearchingContainer(searchingMsg);
      await interaction.reply({ components: [searchingContainer], flags: MessageFlags.IsComponentsV2 });

      // Cache hit shortcut — skip getTrackData() for single cached tracks
      // Do NOT use cache shortcut for playlist URLs: the cache normalizes watch?v=ID&list=... to
      // watch?v=ID, so a previously-cached video would produce a false hit and skip playlist fetch.
      const CacheManager = require("../src/CacheManager");
      const YouTube = require("../src/YouTube");
      const _cacheHit = YouTube.isPlaylist(query) ? { hit: false } : CacheManager.resolveFromCache(query);
      let trackData;
      if (_cacheHit.hit) {
        trackData = { success: true, isPlaylist: false, tracks: [_cacheHit.track] };
      } else {
        trackData = await this.getTrackData(query, guild.id);
      }

      if (!trackData.success) {
        return await interaction.editReply({
          components: [client.musicEmbedManager.createErrorContainer(trackData.message)],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      const embedResult = await client.musicEmbedManager.handleMusicData(guild.id, trackData, member, interaction);

      if (!embedResult.success) {
        return await interaction.editReply({
          components: [client.musicEmbedManager.createErrorContainer(embedResult.message)],
          flags: MessageFlags.IsComponentsV2,
        });
      }
    } catch (error) {
      const errorMsg = await ErrorHandler.handle(error, interaction.guild?.id, "play.execute");

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

      // Platform tespiti
      const platform = this.detectPlatform(query);

      switch (platform) {
        case "youtube":
          // YouTube playlist/video kontrolü
          if (YouTube.isPlaylist && YouTube.isPlaylist(query)) {
            const playlistData = await YouTube.getPlaylist(query, guildId);
            if (playlistData && playlistData.tracks && playlistData.tracks.length > 0) {
              tracks = playlistData.tracks;
              isPlaylist = true;
            } else {
              // Playlist yüklenemezse normal arama yap
              tracks = await YouTube.search(query, 1, guildId);
            }
          } else {
            tracks = await YouTube.search(query, 1, guildId);
          }
          break;

        case "spotify":
          // Check if it's a Spotify URL (playlist, album, track, or artist)
          if (Spotify.isSpotifyURL(query)) {
            const spotifyData = await Spotify.getFromURL(query, guildId);
            tracks = spotifyData || [];
            // Check if it's a playlist/album/artist (multiple tracks)
            const { type } = Spotify.parseSpotifyURL(query);
            isPlaylist = type === "playlist" || type === "album" || type === "artist";
          } else {
            // Regular search
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
          // Varsayılan YouTube arama
          tracks = await YouTube.search(query, 1, guildId);
      }

      if (!tracks || tracks.length === 0) {
        return { success: false, message: "❌ 결과를 찾을 수 없습니다!" };
      }

      return {
        success: true,
        isPlaylist: isPlaylist,
        tracks: tracks,
      };
    } catch (error) {
      const errorMsg = await ErrorHandler.handle(error, guildId, "play.getTrackData");
      return { success: false, message: errorMsg };
    }
  },

  detectPlatform(query) {
    if (query.includes("youtube.com") || query.includes("youtu.be")) {
      return "youtube";
    } else if (query.includes("spotify.com")) {
      return "spotify";
    } else if (query.includes("soundcloud.com")) {
      return "soundcloud";
    } else if (query.startsWith("http") && (query.includes(".mp3") || query.includes(".wav") || query.includes(".ogg"))) {
      return "direct";
    } else {
      return "youtube"; // Default to YouTube search
    }
  },
};
