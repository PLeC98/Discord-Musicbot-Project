const { Events, MessageFlags } = require("discord.js");
const log = require("../src/logger").child({ category: "events" });
const GuildSettingsManager = require("../src/GuildSettingsManager");
const { checkAdd, checkSummon } = require("../src/permissions");
const { requestPlayback } = require("../src/playRequest");
const { channelResponder } = require("../src/playbackResponder");
const S = require("../src/strings");

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

    // 곡 추가 권한: 봇 동작 중에는 재적 규칙(관리자 면제), 유휴 시에는 소환 가능 여부 — /play와 동일 기준
    const permError = checkAdd(member) || checkSummon(member);
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

    // 초기 CV2 검색 자리표시자 — 생성 시점부터 CV2여야 이후 현재 재생 메시지 흐름과 맞는다
    const preview = content.length > 60 ? content.slice(0, 60) + "…" : content;
    const loadingMsg = await message.channel.send({
      components: [client.musicEmbedManager.createSearchingContainer(`🔍 **${preview}** 검색 중...`)],
      flags: MessageFlags.IsComponentsV2,
    });

    const responder = channelResponder(message.channel, () => loadingMsg.delete().catch(() => {}));

    try {
      const result = await requestPlayback(client, {
        guild: message.guild,
        requester: member,
        query: content,
        textChannel: message.channel,
        voiceChannel: member.voice.channel ?? null,
        responder,
        source: "전용채널",
      });

      // 해석 실패·재생 시작 실패를 사용자에게 알림 — 침묵하면 왜 안 되는지 알 수 없다
      if (!result.success) {
        await responder.dismissPlaceholder();
        const errMsg = await message.channel.send({ content: S.withErrorMark(result.message || "재생을 시작할 수 없어요.") });
        setTimeout(() => errMsg.delete().catch(() => {}), 8000);
      }
    } catch (error) {
      log.error({ sub: "message" }, "❌ error:", error);
      await responder.dismissPlaceholder();
      const errMsg = await message.channel.send({ content: "❌ 처리 중 오류가 발생했어요." });
      setTimeout(() => errMsg.delete().catch(() => {}), 8000);
    }
  },
};
