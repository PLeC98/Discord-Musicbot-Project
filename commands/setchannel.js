const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType, MessageFlags } = require("discord.js");
const GuildSettingsManager = require("../src/GuildSettingsManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set a dedicated bot channel for music requests and announcements")
    .setDescriptionLocalizations({
      ko: "음악 요청 및 공지용 봇 전용 채널을 설정합니다",
    })
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Channel to designate (defaults to current channel)")
        .setDescriptionLocalizations({
          ko: "지정할 채널 (기본값: 현재 채널)",
        })
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Set or remove the bot channel")
        .setDescriptionLocalizations({
          ko: "봇 채널 설정 또는 제거",
        })
        .addChoices({ name: "Set", value: "set" }, { name: "Remove", value: "remove" })
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const action = interaction.options.getString("action") || "set";

    if (action === "remove") {
      await GuildSettingsManager.clearBotChannel(guildId);

      return await interaction.reply({
        embeds: [new EmbedBuilder().setTitle("🔧 봇 채널 제거됨").setDescription("봇 전용 채널 설정이 해제됐어요.\n이제 `/play` 명령어로만 음악을 요청할 수 있어요.").setColor("#FF6B6B").setTimestamp()],
      });
    }

    const channel = interaction.options.getChannel("channel") || interaction.channel;
    const success = await GuildSettingsManager.setBotChannel(guildId, channel.id);

    if (!success) {
      return await interaction.reply({
        content: "❌ 채널 설정 중 오류가 발생했어요.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ 봇 채널 설정됨")
          .setDescription(`${channel}이(가) 봇 전용 채널로 설정됐어요!\n\n` + `이 채널에 음악 링크나 검색어를 입력하면 자동으로 재생해요.\n` + `대시보드의 공지 발송도 이 채널을 우선으로 사용해요.`)
          .addFields({
            name: "📋 지원 입력",
            value: "• YouTube, Spotify, SoundCloud URL\n• 곡 이름이나 아티스트 검색어",
            inline: false,
          })
          .setColor("#57F287")
          .setTimestamp(),
      ],
    });
  },
};
