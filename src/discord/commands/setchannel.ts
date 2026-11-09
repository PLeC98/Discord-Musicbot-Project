import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from "discord.js";
import * as GuildSettingsManager from "../../store/guild-settings.ts";
import logger from "../../infra/log/logger.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import type { BotContext } from "../../app/bot-context.ts";
import type { ChatInputCommandInteraction } from "discord.js";
import { messageOf } from "../../rules/error-kind.ts";
import * as settingsText from "../../ui/text/ko/settings.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { post } from "../../ui/frame.ts";
import * as screens from "../../ui/settings-screens.ts";
import { noticeSelf } from "../../ui/delivery.ts";
const log = logger.child({ category: "commands" });

const movePanel = (interaction: ChatInputCommandInteraction<"cached">, { panels }: BotContext) => panels.onBotChannelChanged(interaction.guild).catch((error) => log.warn(`전용 채널 변경 후 패널 이동 실패: ${messageOf(error)}`));

const exported: GuildCommand = {
  help: { section: "channel", tier: "server-manager" },
  data: new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("제 전용 채널을 설정해요 (곡 요청 및 공지에 사용돼요)")
    .addChannelOption((option) => option.setName("channel").setNameLocalizations({ ko: "채널" }).setDescription("설정할 채널 (비우면 명령어를 입력한 채널)").addChannelTypes(ChannelType.GuildText).setRequired(false))
    .addStringOption((option) => option.setName("action").setNameLocalizations({ ko: "동작" }).setDescription("설정 또는 해제").addChoices({ name: "설정", value: "set" }, { name: "해제", value: "remove" }).setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, bot) {
    const guildId = interaction.guild.id;
    const action = interaction.options.getString("action") || "set";

    // 안내를 먼저 보내고(패널 옮기기를 기다리지 않고 답한다) 패널은 그 뒤에 옮긴다. 안내가 실패해도 설정과 패널이 어긋나지 않게 끝까지 옮긴다
    if (action === "remove") {
      await GuildSettingsManager.clearBotChannel(guildId);
      try {
        await interaction.reply(post(screens.saved(settingsText.channelRemoved())));
      } finally {
        await movePanel(interaction, bot);
      }
      return;
    }

    const channel = interaction.options.getChannel("channel") || interaction.channel;
    if (!channel) return noticeSelf(interaction, errors.notice("channel-set-failed")); // 캐시에 없는 채널
    const success = await GuildSettingsManager.setBotChannel(guildId, channel.id);

    if (!success) {
      return await noticeSelf(interaction, errors.notice("channel-set-failed"));
    }

    // 안내 뒤에 올려야 패널이 맨 아래에 온다
    try {
      await interaction.reply(post(screens.channelSet(channel.toString())));
    } finally {
      await movePanel(interaction, bot);
    }
  },
};
export default exported;
