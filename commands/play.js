const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const log = require("../src/logger").child({ category: "commands" });
const ErrorHandler = require("../src/ErrorHandler");
const { requestPlayback } = require("../src/playRequest");
const { interactionResponder } = require("../src/playbackResponder");
const { checkAdd, checkSummon } = require("../src/permissions");

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
      const { member, guild, channel } = interaction;

      const validationResult = await this.validateRequest(member);
      if (!validationResult.success) {
        return await interaction.reply({ content: validationResult.message, flags: MessageFlags.Ephemeral });
      }

      // 처음부터 Components V2로 응답 — 초기 메시지에 IS_COMPONENTS_V2 플래그가 서야 이후 편집이 가능하다
      await interaction.reply({
        components: [client.musicEmbedManager.createSearchingContainer(`**${query}** 검색 중...`)],
        flags: MessageFlags.IsComponentsV2,
      });

      const result = await requestPlayback(client, {
        guild,
        requester: member,
        query,
        textChannel: channel,
        voiceChannel: member.voice.channel ?? null,
        responder: interactionResponder(interaction, client.musicEmbedManager),
        source: "/play",
      });

      if (!result.success) {
        return await interaction.editReply({
          components: [client.musicEmbedManager.createErrorContainer(result.message)],
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
        log.error("오류 응답 전송 중 오류:", responseError);
      }
    }
  },

  async validateRequest(member) {
    // 곡 추가는 전 계층 가능 — 봇 동작 중에는 재적 규칙, 유휴 시에는 소환 가능 여부
    const permErr = checkAdd(member) || checkSummon(member);
    if (permErr) return { success: false, message: permErr };
    return { success: true };
  },
};
