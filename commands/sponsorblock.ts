import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import sponsorConfig from "../events/sponsorConfigHandler.js";
import type { GuildCommand } from "../src/app/commandLoader.ts";

// 실제 저장/취소 처리는 events/sponsorConfigHandler.js (customId: sb:*)
const exported: GuildCommand = {
  data: new SlashCommandBuilder().setName("sponsorblock").setDescription("Configure SponsorBlock auto-skip").setDescriptionLocalizations({ ko: "SponsorBlock 자동 스킵을 설정합니다" }).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const per = await GuildSettingsManager.getSponsorBlock(interaction.guild.id);
    const eff = GuildSettingsManager.resolveSponsorBlock(interaction.guild.id);
    const state = {
      enabled: per.enabled === null ? true : per.enabled,
      categories: per.categories ?? eff.categories,
    };

    // @ts-expect-error events(JS) 가 만든 행의 타입을 추론하지 못한다. events 를 TS 로 옮기면 없어진다
    await interaction.reply({ ...sponsorConfig.buildSponsorConfigMessage(state), flags: MessageFlags.Ephemeral });
    // 보류 상태 등록 (셀렉트/토글이 이 기준값을 이어받음)
    const msg = await interaction.fetchReply();
    sponsorConfig.registerPending(msg.id, state);
  },
};
export default exported;
export { exported as "module.exports" };
