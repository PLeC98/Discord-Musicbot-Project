import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags, ActionRowBuilder, RoleSelectMenuBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import type { GuildCommand } from "../src/app/commandLoader.ts";
import { colorOf } from "../src/ui/colors.ts";
import * as settingsText from "../src/ui/text/settings.ts";

// 실제 저장/취소 처리는 interactions/djRoleConfigHandler.ts (customId: djrole:*)
// 복수 선택은 디스코드 셀렉트 메뉴 한계로 최대 25개.
const exported: GuildCommand = {
  data: new SlashCommandBuilder()
    .setName("setdjrole")
    .setDescription("Configure DJ roles for playback controls")
    .setDescriptionLocalizations({
      ko: "DJ 역할을 지정합니다 (복수 선택 가능)",
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const guild = interaction.guild;
    const currentIds = await GuildSettingsManager.getDjRoles(guild.id);
    const validIds = currentIds.filter((id) => guild.roles.cache.has(id));

    const t = settingsText.djRoleMenu(validIds);
    const embed = new EmbedBuilder().setTitle(t.title).setDescription(t.description).setColor(colorOf("settings"));

    const select = new RoleSelectMenuBuilder().setCustomId("djrole:select").setPlaceholder(t.placeholder).setMinValues(0).setMaxValues(25);
    if (validIds.length) select.setDefaultRoles(validIds);

    await interaction.reply({
      embeds: [embed],
      components: [new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(select), new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("djrole:save").setLabel(settingsText.buttons().save).setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId("djrole:cancel").setLabel(settingsText.buttons().cancel).setStyle(ButtonStyle.Secondary))],
      flags: MessageFlags.Ephemeral,
    });
  },
};
export default exported;
