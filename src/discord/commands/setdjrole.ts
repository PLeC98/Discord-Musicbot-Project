import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import * as GuildSettingsManager from "../../store/guild-settings.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { reply } from "../../ui/frame.ts";
import * as screens from "../../ui/settings-screens.ts";
import { LIFETIME, toSelf } from "../../ui/delivery.ts";

// 실제 저장/취소 처리는 src/discord/interactions/dj-role-config-handler.ts (customId: djrole:*)
// 복수 선택은 디스코드 셀렉트 메뉴 한계로 최대 25개.
const exported: GuildCommand = {
  help: { section: "channel", tier: "moderator" },
  data: new SlashCommandBuilder()
    .setName("setdjrole")
    .setDescription("Configure DJ roles for playback controls")
    .setDescriptionLocalizations({
      ko: "DJ 역할을 설정해요 (복수 선택 가능)",
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const guild = interaction.guild;
    const currentIds = await GuildSettingsManager.getDjRoles(guild.id);
    const validIds = currentIds.filter((id) => guild.roles.cache.has(id));

    await toSelf(interaction, reply(screens.djRoleMenu(validIds)), LIFETIME.screen);
  },
};
export default exported;
