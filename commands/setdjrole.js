"use strict";

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags, ActionRowBuilder, RoleSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const GuildSettingsManager = require("../src/GuildSettingsManager");

// 실제 저장/취소 처리는 events/djRoleConfigHandler.js (customId: djrole:*)
// 복수 선택은 디스코드 셀렉트 메뉴 한계로 최대 25개.
module.exports = {
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

    const statusLine = validIds.length ? `현재 DJ 역할: ${validIds.map((id) => `<@&${id}>`).join(" ")}` : "현재 DJ 역할이 설정되어 있지 않아 **모든 유저**가 재생을 제어할 수 있습니다.";

    const embed = new EmbedBuilder().setTitle("🎧 DJ 역할 설정").setDescription([statusLine, "", "아래 메뉴에서 DJ로 지정할 역할을 고른 뒤 **저장**을 누르세요. (복수 선택 가능)", "아무 역할도 선택하지 않고 저장하면 제한이 해제됩니다.", "모더레이터(서버 관리·추방·차단·타임아웃 권한 보유자)는 설정과 무관하게 항상 제어할 수 있어요."].join("\n")).setColor("#5865F2");

    const select = new RoleSelectMenuBuilder().setCustomId("djrole:select").setPlaceholder("DJ로 지정할 역할 선택").setMinValues(0).setMaxValues(25);
    if (validIds.length) select.setDefaultRoles(validIds);

    await interaction.reply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("djrole:save").setLabel("저장").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId("djrole:cancel").setLabel("취소").setStyle(ButtonStyle.Secondary))],
      flags: MessageFlags.Ephemeral,
    });
  },
};
