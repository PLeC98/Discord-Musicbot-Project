import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from "discord.js";
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import logger from "../src/infra/log/logger.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import type { ChatInputCommandInteraction } from "discord.js";
import { messageOf } from "../src/rules/errorKind.ts";
import * as settingsText from "../src/ui/text/settings.ts";
import * as errors from "../src/ui/text/errors.ts";
import { noticeReply, post } from "../src/ui/frame.ts";
import * as screens from "../src/ui/settingsScreens.ts";
const log = logger.child({ category: "commands" });

const movePanel = (interaction: ChatInputCommandInteraction<"cached">) => interaction.client.panels?.onBotChannelChanged(interaction.guild).catch((error) => log.warn(`전용 채널 변경 뒤 패널 옮기기 실패: ${messageOf(error)}`));

const exported: GuildCommand = {
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
      await movePanel(interaction);

      return await interaction.reply(post(screens.saved(settingsText.channelRemoved())));
    }

    const channel = interaction.options.getChannel("channel") || interaction.channel;
    if (!channel) return interaction.reply(noticeReply(errors.channelSetFailed())); // 캐시에 없는 채널
    const success = await GuildSettingsManager.setBotChannel(guildId, channel.id);

    if (!success) {
      return await interaction.reply(noticeReply(errors.channelSetFailed()));
    }

    await interaction.reply(post(screens.channelSet(`${channel}`)));
    // 안내 뒤에 올려야 패널이 맨 아래에 온다
    await movePanel(interaction);
  },
};
export default exported;
