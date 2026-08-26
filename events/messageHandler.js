const { Events, MessageFlags } = require("discord.js");
const log = require("../src/logger").child({ category: "events" });
const GuildSettingsManager = require("../src/GuildSettingsManager");
const { checkAdd } = require("../src/permissions");
const MusicPlayer = require("../src/MusicPlayer");
const MusicEmbedManager = require("../src/MusicEmbedManager");

module.exports = {
  name: Events.MessageCreate,

  async execute(message) {
    if (message.author.bot) return;
    if (!message.guild) return;

    const guildId = message.guild.id;
    const content = message.content.trim();
    if (!content) return;

    // 지정된 봇 채널인지 확인
    const botChannelId = await GuildSettingsManager.getBotChannel(guildId);
    if (!botChannelId || message.channel.id !== botChannelId) return;

    const client = message.client;
    const member = message.member;

    // 곡 추가 권한: 봇 동작 중에는 재적 규칙(관리자 면제), 유휴 시에는 소환을 위해 본인 접속 필수
    const botVoiceChannel = message.guild.members.me?.voice?.channel;
    let permError = null;
    if (botVoiceChannel) {
      permError = checkAdd(member);
    } else if (!member.voice.channel) {
      permError = "🔇 음성 채널에 먼저 접속해주세요!";
    }
    if (permError) {
      const reply = await message.reply(permError);
      setTimeout(() => {
        reply.delete().catch(() => {});
        message.delete().catch(() => {});
      }, 5000);
      return;
    }

    // 채널을 깔끔하게 유지하기 위해 사용자 메시지 삭제
    await message.delete().catch(() => {});

    // 음악 플레이어를 가져오거나 생성 — 봇이 이미 접속 중이면 그 채널 기준 (관리자 원격 추가 대응)
    let player = client.players.get(guildId);
    if (!player) {
      player = new MusicPlayer(message.guild, message.channel, member.voice.channel ?? botVoiceChannel ?? null);
      client.players.set(guildId, player);
    } else {
      // 플레이어 출력을 봇 채널로 리디렉션
      player.textChannel = message.channel;
    }

    // 봇이 유휴 상태에서 소환될 때만 음성 대상을 갱신 — 재생 중 다른 채널 참조로 오염 방지
    if (!botVoiceChannel && member.voice.channel) {
      player.voiceChannel = member.voice.channel;
    }

    // 임베드 매니저가 준비되지 않았으면 초기화
    if (!client.musicEmbedManager) {
      client.musicEmbedManager = new MusicEmbedManager(client);
    }

    // 초기 CV2 검색 자리표시자 전송 — 생성 시점부터 CV2여야 IS_COMPONENTS_V2
    // 플래그가 현재 재생 메시지 수정 전에 설정되어 /play 상호작용 응답 흐름과 맞음
    const query = content.length > 60 ? content.slice(0, 60) + "…" : content;
    const searchingContainer = client.musicEmbedManager.createSearchingContainer(`🔍 **${query}** 검색 중...`);
    const loadingMsg = await message.channel.send({
      components: [searchingContainer],
      flags: MessageFlags.IsComponentsV2,
    });

    try {
      // 캐시 숏컷 포함 해석 (플랫폼 감지·메타데이터 조회는 TrackResolver 한 곳에서)
      const TrackResolver = require("../src/TrackResolver");
      const trackData = await TrackResolver.resolveQuery(content, guildId, "messageHandler.getTrackData");

      await loadingMsg.delete().catch(() => {});

      if (!trackData.success) {
        const errMsg = await message.channel.send({ content: `❌ ${trackData.message}` });
        setTimeout(() => errMsg.delete().catch(() => {}), 8000);
        return;
      }

      await client.musicEmbedManager.handleMusicData(guildId, trackData, member, null);
    } catch (error) {
      log.error({ sub: "message" }, "❌ error:", error);
      await loadingMsg.delete().catch(() => {});
      const errMsg = await message.channel.send({ content: "❌ 처리 중 오류가 발생했어요." });
      setTimeout(() => errMsg.delete().catch(() => {}), 8000);
    }
  },
};
