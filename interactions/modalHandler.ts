import { MessageFlags, type Client, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import * as S from "../src/ui/strings.ts";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import { volumeChanged } from "../src/ui/volumeReply.ts";
import { route, type Route } from "./route.ts";
import { PANEL, customId, partsOf } from "../src/ui/customIds.ts";

async function handleJumpTo(interaction: StringSelectMenuInteraction<"cached">, client: Client<true>) {
  const player = client.players.get(interaction.guild.id);
  const sessionId = partsOf(interaction.customId).rest[0];
  if (player && sessionId && player.sessionId && sessionId !== player.sessionId) {
    return await interaction.reply({
      content: S.ERR_SESSION_INVALID,
      flags: [1 << 6],
    });
  }

  const r = await controls.jump(player, { member: interaction.member }, Number(interaction.values[0]));
  if (!r.ok && r.code === "bad-position") return await interaction.reply({ content: "❌ 선택한 곡을 대기열에서 찾을 수 없습니다!", flags: [1 << 6] });
  if (!r.ok) return await interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

  await interaction.reply({
    content: `⏭️ **${r.track.title}**로 이동했습니다!`,
    flags: [1 << 6],
  });
}

async function handleVolumeModal(interaction: ModalSubmitInteraction<"cached">, client: Client<true>) {
  // 숫자만 받는다. parseInt 는 "50abc" 를 50 으로 읽는다. 범위는 controls.volume 이 본다
  const raw = interaction.fields.getTextInputValue("volume_input").trim();
  const volume = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  const r = await controls.volume(client.players.get(interaction.guild.id), { member: interaction.member }, volume);
  if (!r.ok) return await interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

  await interaction.reply({ embeds: [volumeChanged({ before: r.before, level: r.level, by: interaction.member })], flags: MessageFlags.Ephemeral });
}

// 곡으로 건너뛰기 메뉴와 음량 입력 모달
const routes: Route[] = [route("select", customId(PANEL, "jump", ""), (it) => handleJumpTo(it, it.client)), route("modal", customId(PANEL, "volume"), (it) => handleVolumeModal(it, it.client))];

export { routes, handleJumpTo, handleVolumeModal };
