const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const log = require("../src/logger").child({ category: "commands" });
const MusicPlayer = require("../src/MusicPlayer");
const MusicEmbedManager = require("../src/MusicEmbedManager");
const ErrorHandler = require("../src/ErrorHandler");
const TrackResolver = require("../src/TrackResolver");
const S = require("../src/strings");
const { checkControl } = require("../src/permissions");

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
        return await interaction.reply({ content: validationResult.message, flags: MessageFlags.Ephemeral });
      }

      // 봇이 이미 접속 중이면 그 채널을 기준으로 (관리자 원격 추가 대응)
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

      if (!client.musicEmbedManager) {
        client.musicEmbedManager = new MusicEmbedManager(client);
      }
      const searchingMsg = `**${query}** 검색 중...`;
      const searchingContainer = client.musicEmbedManager.createSearchingContainer(searchingMsg);
      await interaction.reply({ components: [searchingContainer], flags: MessageFlags.IsComponentsV2 });

      // 캐시 숏컷 포함 해석 (플랫폼 감지·메타데이터 조회는 TrackResolver 한 곳에서)
      const trackData = await TrackResolver.resolveQuery(query, guild.id, "playfirst.getTrackData");
      // 초기 응답은 CV2 — `content`로 수정하면 거부되므로 컨테이너 사용
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
      const errorMsg = ErrorHandler.handle(error, interaction.guild?.id, "playfirst.execute");

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
        log.error("오류 응답 전송 중 오류:", responseError);
      }
    }
  },

  async validateRequest(interaction, member, guild) {
    // 우선 추가(대기열 맨 앞 삽입)는 재생 순서를 바꾸는 조작 — DJ 계층 필요
    const permErr = await checkControl(member);
    if (permErr) return { success: false, message: permErr };

    // 봇 유휴: 요청자의 채널로 접속해야 하므로 관리자여도 음성 채널 접속 필수
    const botVoiceChannel = guild.members.me.voice.channel;
    if (!botVoiceChannel) {
      if (!member.voice.channel) {
        return { success: false, message: S.ERR_VOICE_REQUIRED };
      }

      const permissions = member.voice.channel.permissionsFor(guild.members.me);
      if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
        return { success: false, message: S.ERR_NO_PERMISSIONS };
      }
    }

    return { success: true };
  },
};
