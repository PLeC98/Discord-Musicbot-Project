import { EmbedBuilder, PermissionFlagsBits, MessageFlags, type ButtonInteraction, type RoleSelectMenuInteraction } from "discord.js";
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import { route, type Route } from "./route.ts";
import { colorOf } from "../src/ui/colors.ts";
import * as settingsText from "../src/ui/text/settings.ts";
import * as errors from "../src/ui/text/errors.ts";

// /setdjrole UI (드롭메뉴 + 저장/취소) 처리.
// 드롭메뉴 선택값은 셀렉트 인터랙션으로만 오므로, 저장 버튼이 읽을 수 있게
// 메시지 ID 기준으로 보류 중 선택을 잠시 들고 있는다. (에페메랄이라 호출자만 조작 가능)
const pending = new Map<string, { roleIds: string[]; at: number }>(); // messageId → { roleIds, at }
const PENDING_TTL_MS = 15 * 60 * 1000;

function sweepPending() {
  const now = Date.now();
  for (const [key, value] of pending) {
    if (now - value.at > PENDING_TTL_MS) pending.delete(key);
  }
}

// 역할 고르기 메뉴(djrole:select)와 저장 · 취소 버튼(djrole:)
async function handleDjRoleConfig(interaction: RoleSelectMenuInteraction<"cached"> | ButtonInteraction<"cached">) {
  sweepPending();

  // 커맨드 진입 조건과 동일 기준 재확인 (심층 방어. 원본이 에페메랄이라 실질 노출은 없음)
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: errors.needManageGuild(), flags: MessageFlags.Ephemeral });
  }

  // 드롭메뉴 선택. 즉시 저장하지 않고 보류만 (저장 버튼이 확정)
  if (interaction.isRoleSelectMenu()) {
    pending.set(interaction.message.id, { roleIds: [...interaction.values], at: Date.now() });
    return interaction.deferUpdate();
  }

  if (interaction.customId === "djrole:cancel") {
    pending.delete(interaction.message.id);
    const t = settingsText.djRoleCancelled();
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle(t.title).setDescription(t.description).setColor(colorOf("closed"))],
      components: [],
    });
  }

  if (interaction.customId === "djrole:save") {
    const guild = interaction.guild;
    const stash = pending.get(interaction.message.id);
    pending.delete(interaction.message.id);

    // 드롭메뉴를 건드리지 않고 저장하면 현재 설정 유지, 선택 후 저장이면 그 값으로.
    // 선택~저장 사이에 삭제된 역할은 걸러낸다.
    const chosen = stash ? stash.roleIds : await GuildSettingsManager.getDjRoles(guild.id);
    const roleIds = chosen.filter((id) => guild.roles.cache.has(id));

    if (!roleIds.length) {
      await GuildSettingsManager.clearDjRoles(guild.id);
      const t = settingsText.djRoleCleared();
      return interaction.update({
        embeds: [new EmbedBuilder().setTitle(t.title).setDescription(t.description).setColor(colorOf("closed")).setTimestamp()],
        components: [],
      });
    }

    const success = await GuildSettingsManager.setDjRoles(guild.id, roleIds);
    if (!success) {
      const t = settingsText.djRoleSaveFailed();
      return interaction.update({
        embeds: [new EmbedBuilder().setTitle(t.title).setDescription(t.description).setColor(colorOf("error"))],
        components: [],
      });
    }

    const t = settingsText.djRoleSaved(roleIds);
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle(t.title).setDescription(t.description).setColor(colorOf("done")).setTimestamp()],
      components: [],
    });
  }
}

const routes: Route[] = [route("roleSelect", "djrole:select", handleDjRoleConfig), route("button", "djrole:", handleDjRoleConfig)];

export { routes };
