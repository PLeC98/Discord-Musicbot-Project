"use strict";

const { Events, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const GuildSettingsManager = require("../src/GuildSettingsManager");

// /setdjrole UI (드롭메뉴 + 저장/취소) 처리.
// 드롭메뉴 선택값은 셀렉트 인터랙션으로만 오므로, 저장 버튼이 읽을 수 있게
// 메시지 ID 기준으로 보류 중 선택을 잠시 들고 있는다. (에페메랄이라 호출자만 조작 가능)
const pending = new Map(); // messageId → { roleIds: string[], at: number }
const PENDING_TTL_MS = 15 * 60 * 1000;

function sweepPending() {
  const now = Date.now();
  for (const [key, value] of pending) {
    if (now - value.at > PENDING_TTL_MS) pending.delete(key);
  }
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const isSelect = interaction.isRoleSelectMenu() && interaction.customId === "djrole:select";
    const isButton = interaction.isButton() && interaction.customId.startsWith("djrole:");
    if (!isSelect && !isButton) return;

    sweepPending();

    // 커맨드 진입 조건과 동일 기준 재확인 (심층 방어 — 원본이 에페메랄이라 실질 노출은 없음)
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: "❌ 서버 관리 권한이 필요해요.", flags: MessageFlags.Ephemeral });
    }

    // 드롭메뉴 선택 — 즉시 저장하지 않고 보류만 (저장 버튼이 확정)
    if (isSelect) {
      pending.set(interaction.message.id, { roleIds: [...interaction.values], at: Date.now() });
      return interaction.deferUpdate();
    }

    if (interaction.customId === "djrole:cancel") {
      pending.delete(interaction.message.id);
      return interaction.update({
        embeds: [new EmbedBuilder().setTitle("🎧 DJ 역할 설정 취소됨").setDescription("변경 사항 없이 닫았어요.").setColor("#99AAB5")],
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
        return interaction.update({
          embeds: [new EmbedBuilder().setTitle("🎧 DJ 역할 제한 해제됨").setDescription("이제 모든 유저가 재생을 제어할 수 있어요.\n(모더레이터는 설정과 무관하게 항상 가능합니다)").setColor("#FF6B6B").setTimestamp()],
          components: [],
        });
      }

      const success = await GuildSettingsManager.setDjRoles(guild.id, roleIds);
      if (!success) {
        return interaction.update({
          embeds: [new EmbedBuilder().setTitle("❌ 저장 실패").setDescription("DJ 역할 설정 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.").setColor("#ED4245")],
          components: [],
        });
      }

      return interaction.update({
        embeds: [
          new EmbedBuilder()
            .setTitle("✅ DJ 역할 설정됨")
            .setDescription(`DJ 역할: ${roleIds.map((id) => `<@&${id}>`).join(" ")}\n\n이제 🔒 재생 제어(스킵/정지/볼륨 등)는 이 역할 보유자만 사용할 수 있어요.\n모더레이터(서버 관리·추방·차단·타임아웃 권한 보유자)는 항상 제어할 수 있습니다.`)
            .setColor("#57F287")
            .setTimestamp(),
        ],
        components: [],
      });
    }
  },
};
