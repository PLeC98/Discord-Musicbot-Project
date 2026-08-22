"use strict";

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const GuildSettingsManager = require("../src/GuildSettingsManager");
const sponsorConfig = require("../events/sponsorConfigHandler");

// 실제 저장/취소 처리는 events/sponsorConfigHandler.js (customId: sb:*)
module.exports = {
  data: new SlashCommandBuilder().setName("sponsorblock").setDescription("Configure SponsorBlock auto-skip").setDescriptionLocalizations({ ko: "SponsorBlock 자동 스킵을 설정합니다" }).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const per = await GuildSettingsManager.getSponsorBlock(interaction.guild.id);
    const eff = GuildSettingsManager.resolveSponsorBlock(interaction.guild.id);
    const state = {
      enabled: per.enabled === null ? true : per.enabled,
      categories: per.categories ?? eff.categories,
    };

    await interaction.reply({ ...sponsorConfig.buildSponsorConfigMessage(state), flags: MessageFlags.Ephemeral });
    // 보류 상태 등록 (셀렉트/토글이 이 기준값을 이어받음)
    const msg = await interaction.fetchReply();
    sponsorConfig.registerPending(msg.id, state);
  },
};
