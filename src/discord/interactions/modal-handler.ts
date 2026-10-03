import { type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import type { BotContext } from "../../app/bot-context.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import * as replies from "../../ui/control-replies.ts";
import * as controls from "../../usecases/controls.ts";
import { controlMessage } from "../../ui/control-messages.ts";
import { answerVolume } from "./control-answers.ts";
import { route, type Route } from "./route.ts";
import { PANEL, customId, partsOf } from "../../ui/custom-ids.ts";
import { LIFETIME, noticeSelf, toAll } from "../../ui/delivery.ts";

async function handleJumpTo(interaction: StringSelectMenuInteraction<"cached">, { players }: BotContext) {
  const player = players.get(interaction.guild.id);
  const sessionId = partsOf(interaction.customId).rest[0];
  if (player && sessionId && player.sessionId && sessionId !== player.sessionId) {
    return await noticeSelf(interaction, errors.notice("stale-session"));
  }

  const r = await controls.jump(player, { member: interaction.member }, Number(interaction.values[0]));
  if (!r.ok && r.code === "bad-position") return await noticeSelf(interaction, errors.notice("jump-target-gone"));
  if (!r.ok) return await noticeSelf(interaction, controlMessage(r));

  await toAll(interaction, replies.jumped(r.track), LIFETIME.result);
}

async function handleVolumeModal(interaction: ModalSubmitInteraction<"cached">, { players }: BotContext) {
  // 숫자만 받는다. parseInt 는 "50abc" 를 50 으로 읽는다. 범위는 controls.volume 이 본다
  const raw = interaction.fields.getTextInputValue("volume_input").trim();
  const volume = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  await answerVolume(interaction, players.get(interaction.guild.id), volume);
}

// 곡으로 건너뛰기 메뉴와 음량 입력 모달
const routes: Route[] = [route("select", customId(PANEL, "jump", ""), handleJumpTo), route("modal", customId(PANEL, "volume"), handleVolumeModal)];

export { routes, handleJumpTo, handleVolumeModal };
