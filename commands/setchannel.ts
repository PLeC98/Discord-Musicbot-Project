import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from "discord.js";
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import logger from "../src/infra/log/logger.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import type { ChatInputCommandInteraction } from "discord.js";
import { messageOf } from "../src/rules/errorKind.ts";
import * as settingsText from "../src/ui/text/ko/settings.ts";
import * as errors from "../src/ui/text/ko/errors.ts";
import { noticeReply, post } from "../src/ui/frame.ts";
import * as screens from "../src/ui/settingsScreens.ts";
const log = logger.child({ category: "commands" });

const movePanel = (interaction: ChatInputCommandInteraction<"cached">) => interaction.client.panels?.onBotChannelChanged(interaction.guild).catch((error) => log.warn(`전용 채널 변경 뒤 패널 옮기기 실패: ${messageOf(error)}`));

const exported: GuildCommand = {
  help: { section: "channel", tier: "moderator" },
  data: new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("Set a dedicated bot channel for music requests and announcements")
    .setDescriptionLocalizations({
      ko: "제 전용 채널을 설정해요 (곡 요청 및 공지에 사용돼요)",
    })
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setNameLocalizations({ ko: "채널" })
        .setDescription("Channel to designate (defaults to current channel)")
        .setDescriptionLocalizations({
          ko: "설정할 채널 (비우면 명령어를 입력한 채널)",
        })
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("action")
        .setNameLocalizations({ ko: "동작" })
        .setDescription("Set or remove the bot channel")
        .setDescriptionLocalizations({
          ko: "설정 또는 해제",
        })
        .addChoices({ name: "Set", name_localizations: { ko: "설정" }, value: "set" }, { name: "Remove", name_localizations: { ko: "해제" }, value: "remove" })
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
    if (!channel) return interaction.reply(noticeReply(errors.notice("channel-set-failed"))); // 캐시에 없는 채널
    const success = await GuildSettingsManager.setBotChannel(guildId, channel.id);

    if (!success) {
      return await interaction.reply(noticeReply(errors.notice("channel-set-failed")));
    }

    await interaction.reply(post(screens.channelSet(`${channel}`)));
    // 안내 뒤에 올려야 패널이 맨 아래에 온다
    await movePanel(interaction);
  },
};
export default exported;
