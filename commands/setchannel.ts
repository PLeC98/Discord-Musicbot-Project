import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType, MessageFlags } from "discord.js";
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import logger from "../src/infra/log/logger.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import type { ChatInputCommandInteraction } from "discord.js";
import { messageOf } from "../src/rules/errorKind.ts";
import { colorOf } from "../src/ui/colors.ts";
import * as settingsText from "../src/ui/text/settings.ts";
import * as errors from "../src/ui/text/errors.ts";
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

      const t = settingsText.channelRemoved();
      return await interaction.reply({
        embeds: [new EmbedBuilder().setTitle(t.title).setDescription(t.description).setColor(colorOf("closed")).setTimestamp()],
      });
    }

    const channel = interaction.options.getChannel("channel") || interaction.channel;
    if (!channel) return interaction.reply({ content: errors.channelSetFailed(), flags: MessageFlags.Ephemeral }); // 캐시에 없는 채널
    const success = await GuildSettingsManager.setBotChannel(guildId, channel.id);

    if (!success) {
      return await interaction.reply({
        content: errors.channelSetFailed(),
        flags: MessageFlags.Ephemeral,
      });
    }

    const t = settingsText.channelSet(`${channel}`);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(t.title)
          .setDescription(t.description)
          .addFields({
            name: t.inputs,
            value: t.inputsValue,
            inline: false,
          })
          .setColor(colorOf("done"))
          .setTimestamp(),
      ],
    });
    // 안내 뒤에 올려야 패널이 맨 아래에 온다
    await movePanel(interaction);
  },
};
export default exported;
