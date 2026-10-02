import { type Client, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import * as errors from "../src/ui/text/ko/errors.ts";
import { noticeReply, reply } from "../src/ui/frame.ts";
import * as replies from "../src/ui/controlReplies.ts";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import { answerVolume } from "./controlAnswers.ts";
import { route, type Route } from "./route.ts";
import { PANEL, customId, partsOf } from "../src/ui/customIds.ts";

async function handleJumpTo(interaction: StringSelectMenuInteraction<"cached">, client: Client<true>) {
  const player = client.players.get(interaction.guild.id);
  const sessionId = partsOf(interaction.customId).rest[0];
  if (player && sessionId && player.sessionId && sessionId !== player.sessionId) {
    return await interaction.reply(noticeReply(errors.notice("stale-session")));
  }

  const r = await controls.jump(player, { member: interaction.member }, Number(interaction.values[0]));
  if (!r.ok && r.code === "bad-position") return await interaction.reply(noticeReply(errors.notice("jump-target-gone")));
  if (!r.ok) return await interaction.reply(noticeReply(controlMessage(r)));

  await interaction.reply(reply(replies.jumped(r.track)));
}

async function handleVolumeModal(interaction: ModalSubmitInteraction<"cached">, client: Client<true>) {
  // 숫자만 받는다. parseInt 는 "50abc" 를 50 으로 읽는다. 범위는 controls.volume 이 본다
  const raw = interaction.fields.getTextInputValue("volume_input").trim();
  const volume = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  await answerVolume(interaction, client.players.get(interaction.guild.id), volume);
}

// 곡으로 건너뛰기 메뉴와 음량 입력 모달
const routes: Route[] = [route("select", customId(PANEL, "jump", ""), (it) => handleJumpTo(it, it.client)), route("modal", customId(PANEL, "volume"), (it) => handleVolumeModal(it, it.client))];

export { routes, handleJumpTo, handleVolumeModal };
