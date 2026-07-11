const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const config = require("../config.js");
const YouTube = require("../src/YouTube.js");
const S = require("../src/strings");
const { checkAdd } = require("../src/permissions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search and select music on YouTube")
    .setDescriptionLocalizations({
      ko: "유튜브에서 음악을 검색/선택합니다",
    })
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Music name or artist to search")
        .setDescriptionLocalizations({
          ko: "검색할 음악 이름 또는 아티스트",
        })
        .setRequired(true),
    ),

  async execute(interaction) {
    const query = interaction.options.getString("query");
    const guildId = interaction.guild.id;
    const member = interaction.member;
    const guild = interaction.guild;

    try {
      await interaction.deferReply();

      // 기본 검사
      const validationResult = await this.validateRequest(interaction, member, guild);
      if (!validationResult.success) {
        return await interaction.editReply({
          content: validationResult.message,
        });
      }

      // 검색 수행
      const results = await YouTube.search(query, 9, guildId);

      if (!results || results.length === 0) {
        return await interaction.editReply({
          content: "❌ 검색 결과가 없습니다!",
        });
      }

      await this.showSearchMenu(interaction, results, query);
    } catch (error) {
      await interaction.editReply({
        content: S.ERR_PROCESSING,
      });
    }
  },

  async validateRequest(interaction, member, guild) {
    // 검색 후 선택은 곡 추가 경로 — 전 계층 가능, 봇 동작 중에는 접속 규칙만 적용
    const botVoiceChannel = guild.members.me.voice.channel;
    if (botVoiceChannel) {
      const permErr = checkAdd(member);
      if (permErr) return { success: false, message: permErr };
      return { success: true };
    }

    // 봇 유휴: 선택 시 요청자의 채널로 접속해야 하므로 관리자여도 음성 채널 접속 필수
    if (!member.voice.channel) {
      return { success: false, message: S.ERR_VOICE_REQUIRED };
    }

    const permissions = member.voice.channel.permissionsFor(guild.members.me);
    if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
      return { success: false, message: S.ERR_NO_PERMISSIONS };
    }

    return { success: true };
  },

  async showSearchMenu(interaction, results, query) {
    const embed = new EmbedBuilder()
      .setTitle(`🔍 "${query}" 검색 결과`)
      .setColor(config.bot.embedColor)
      .setDescription("번호 버튼을 눌러 노래를 선택하세요.")
      .setFooter({ text: `${results.length}개의 결과` })
      .setTimestamp();

    const maxResults = Math.min(results.length, 9);
    for (let index = 0; index < maxResults; index++) {
      const result = results[index];
      const title = result.title || "알 수 없는 제목";
      const uploader = result.artist || "알 수 없는 채널";
      const duration = this.formatDuration(result?.duration);
      const value = `👤 ${uploader} • ⏱️ ${duration}`;

      embed.addFields({
        name: `${index + 1}. ${title}`,
        value,
        inline: false,
      });
    }

    // 버튼 생성 (2행, 최대 4+5개)
    const row1 = new ActionRowBuilder();
    const row2 = new ActionRowBuilder();

    // 노래 9개 + 취소 1개 = 최대 버튼 10개
    let hasSecondRow = false;

    for (let i = 0; i < maxResults; i++) {
      const button = new ButtonBuilder()
        .setCustomId(`search_select_${i}`)
        .setLabel(`${i + 1}`)
        .setStyle(ButtonStyle.Secondary);

      // 첫 4개 버튼은 첫 번째 행에, 나머지는 두 번째 행에 배치 (최대 5개)
      if (i < 4) {
        row1.addComponents(button);
      } else if (i < 9) {
        row2.addComponents(button);
        hasSecondRow = true;
      }
    }

    const cancelButton = new ButtonBuilder().setCustomId("search_cancel").setLabel("취소").setStyle(ButtonStyle.Danger).setEmoji("❌");

    row1.addComponents(cancelButton);

    const components = [row1];
    if (hasSecondRow && row2.components.length > 0) {
      components.push(row2);
    }

    const message = await interaction.editReply({
      embeds: [embed],
      components: components,
    });

    // 검색 결과를 메시지 ID로 키잉해 임시 저장 — 사용자 ID 키는 같은 사용자의
    // 재검색이 이전 메시지의 버튼과 뒤섞이는 문제가 있었음(감사 M-08).
    // userId는 버튼 처리에서 요청자 본인 확인용
    const client = interaction.client;
    if (!client.searchResults) client.searchResults = new Map();
    client.searchResults.set(message.id, {
      userId: interaction.user.id,
      query: query,
      results: results,
      timestamp: Date.now(),
    });

    // 5분 후 정리 — 메시지별 키라 다른 검색의 타이머와 간섭하지 않음
    const timer = setTimeout(
      () => {
        client.searchResults.delete(message.id);
      },
      5 * 60 * 1000,
    );
    timer.unref?.();
  },

  formatDuration(seconds, unknownLabel = "알 수 없음") {
    if (!seconds || seconds === 0) return unknownLabel;

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, "0")}`;
    }
  },
};
