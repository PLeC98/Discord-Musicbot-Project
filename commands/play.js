const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const MusicPlayer = require("../src/MusicPlayer");
const MusicEmbedManager = require("../src/MusicEmbedManager");
const ErrorHandler = require("../src/ErrorHandler");
const TrackResolver = require("../src/TrackResolver");
const S = require("../src/strings");
const { checkAdd } = require("../src/permissions");

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

      // 응답 전 검증 (빠른 동기 확인)
      const validationResult = await this.validateRequest(interaction, member, guild);
      if (!validationResult.success) {
        return await interaction.reply({
          content: validationResult.message,
          flags: MessageFlags.Ephemeral,
        });
      }

      console.log(`[Play] /play | 서버=${guild.id} | 사용자=${member.user.tag} | 검색어="${query}"`);

      // 음악 플레이어를 가져오거나 생성 — 봇이 이미 접속 중이면 그 채널을 기준으로 (관리자 원격 추가 대응)
      let player = client.players.get(guild.id);
      if (!player) {
        player = new MusicPlayer(guild, channel, member.voice.channel ?? guild.members.me?.voice?.channel ?? null);
        client.players.set(guild.id, player);
      }

      // 봇이 유휴 상태에서 소환될 때만 음성 대상을 갱신 — 재생 중 다른 채널 참조로 오염 방지
      if (!guild.members.me?.voice?.channel && member.voice.channel) {
        player.voiceChannel = member.voice.channel;
      }
      player.textChannel = channel;

      // 처음부터 Components V2로 즉시 응답 — 초기 메시지에 IS_COMPONENTS_V2 플래그가 설정되도록 보장
      if (!client.musicEmbedManager) {
        client.musicEmbedManager = new MusicEmbedManager(client);
      }
      const searchingMsg = `**${query}** 검색 중...`;
      const searchingContainer = client.musicEmbedManager.createSearchingContainer(searchingMsg);
      await interaction.reply({ components: [searchingContainer], flags: MessageFlags.IsComponentsV2 });

      // 캐시 숏컷 포함 해석 (플랫폼 감지·메타데이터 조회는 TrackResolver 한 곳에서)
      const trackData = await TrackResolver.resolveQuery(query, guild.id, "play.getTrackData");

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
      const errorMsg = ErrorHandler.handle(error, interaction.guild?.id, "play.execute");

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({
            components: [client.musicEmbedManager.createErrorContainer(errorMsg)],
            flags: MessageFlags.IsComponentsV2,
          });
        } else {
          await interaction.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
        }
      } catch (responseError) {
        console.error("오류 응답 전송 중 오류:", responseError);
      }
    }
  },

  async validateRequest(interaction, member, guild) {
    // 곡 추가는 전 계층 가능 — 봇 동작 중에는 접속 규칙만 적용 (관리자 면제는 checkAdd 내부)
    const botVoiceChannel = guild.members.me.voice.channel;
    if (botVoiceChannel) {
      const permErr = checkAdd(member);
      if (permErr) return { success: false, message: permErr };
      return { success: true };
    }

    // 봇 유휴: 요청자의 채널로 접속해야 하므로 관리자여도 음성 채널 접속 필수
    if (!member.voice.channel) {
      return { success: false, message: S.ERR_VOICE_REQUIRED };
    }

    const permissions = member.voice.channel.permissionsFor(guild.members.me);
    if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
      return { success: false, message: S.ERR_NO_PERMISSIONS };
    }

    return { success: true };
  },
};
