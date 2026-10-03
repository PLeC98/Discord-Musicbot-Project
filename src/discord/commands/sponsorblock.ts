import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import * as GuildSettingsManager from "../../store/guild-settings.ts";
import { sponsorConfigView, registerPending } from "../interactions/sponsor-config-handler.ts";
import { reply } from "../../ui/frame.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import config from "../../config/index.ts";
import { LIFETIME, toSelf } from "../../ui/delivery.ts";

// 실제 저장/취소 처리는 src/discord/interactions/sponsor-config-handler.ts (customId: sb:*)
const exported: GuildCommand = {
  help: { section: "channel", tier: "moderator" },
  // 봇 전체에서 SponsorBlock 을 껐으면(SPONSORBLOCK_ENABLED=false) 등록하지 않는다
  enabled: () => config.sponsorblock.enabled,
  data: new SlashCommandBuilder().setName("sponsorblock").setDescription("Configure SponsorBlock auto-skip").setDescriptionLocalizations({ ko: "SponsorBlock 기능 설정 패널을 열어요" }).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const per = await GuildSettingsManager.getSponsorBlock(interaction.guild.id);
    const eff = GuildSettingsManager.resolveSponsorBlock(interaction.guild.id);
    const state = {
      enabled: per.enabled === null ? true : per.enabled,
      categories: per.categories ?? eff.categories,
    };

    await toSelf(interaction, reply(sponsorConfigView(state)), LIFETIME.screen);
    // 보류 상태 등록 (셀렉트/토글이 이 기준값을 이어받음)
    const msg = await interaction.fetchReply();
    registerPending(msg.id, state);
  },
};
export default exported;
