const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const config = require("../config.js");
const YouTube = require("../src/YouTube.js");
const S = require("../src/strings");

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
    const channel = interaction.channel;

    try {
      await interaction.deferReply();

      // Temel kontroller
      const validationResult = await this.validateRequest(interaction, member, guild);
      if (!validationResult.success) {
        return await interaction.editReply({
          content: validationResult.message,
        });
      }

      // Arama yap
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

    // Create buttons (2 rows, max 4+5 buttons)
    const row1 = new ActionRowBuilder();
    const row2 = new ActionRowBuilder();

    // 9 songs + 1 cancel = 10 buttons max
    let hasSecondRow = false;

    for (let i = 0; i < maxResults; i++) {
      const button = new ButtonBuilder()
        .setCustomId(`search_select_${i}`)
        .setLabel(`${i + 1}`)
        .setStyle(ButtonStyle.Secondary);

      // First 4 buttons in first row, rest in second row (max 5)
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

    // Store search results temporarily
    if (!global.searchResults) global.searchResults = new Map();
    global.searchResults.set(interaction.user.id, {
      query: query,
      results: results,
      timestamp: Date.now(),
    });

    // Clean up after 5 minutes
    setTimeout(
      () => {
        global.searchResults.delete(interaction.user.id);
      },
      5 * 60 * 1000,
    );

    await interaction.editReply({
      embeds: [embed],
      components: components,
    });
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
