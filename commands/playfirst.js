const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const log = require("../src/logger").child({ category: "commands" });
const ErrorHandler = require("../src/ErrorHandler");
const { requestPlayback } = require("../src/playRequest");
const { interactionResponder } = require("../src/playbackResponder");
const { checkControl, checkSummon } = require("../src/permissions");

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
      const { member, guild, channel } = interaction;

      const validationResult = await this.validateRequest(member);
      if (!validationResult.success) {
        return await interaction.reply({ content: validationResult.message, flags: MessageFlags.Ephemeral });
      }

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
        insertFirst: true,
        responder: interactionResponder(interaction, client.musicEmbedManager),
        source: "/playfirst",
      });

      if (!result.success) {
        return await interaction.editReply({
          components: [client.musicEmbedManager.createErrorContainer(result.message)],
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

  async validateRequest(member) {
    // 우선 추가(대기열 맨 앞 삽입)는 재생 순서를 바꾸는 조작 — DJ 계층 필요
    const permErr = (await checkControl(member)) || checkSummon(member);
    if (permErr) return { success: false, message: permErr };
    return { success: true };
  },
};
