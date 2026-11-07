import { EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonBuilder, type ButtonInteraction, type Client } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "events" });
import config from "../../config/index.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import type { Notice } from "../../ui/text/notice.ts";
import { checkControl, isBotOwner } from "../../usecases/permissions.ts";
import { nextLoopMode } from "../../rules/loop-cycle.ts";
import { answerPause, answerSkip, answerPrevious, answerStop, answerShuffle, answerLoop, answerHighlight } from "./control-answers.ts";
import * as controlText from "../../ui/text/ko/controls.ts";

import { PANEL, HELP, SYSTEM, customId, partsOf } from "../../ui/custom-ids.ts";
import { queueView, queueInfoOf, pageOf, PAGE_PREFIX } from "../../ui/queue-view.ts";
import { buildHelpEmbed } from "../commands/help.ts";
import { buildSystemEmbed } from "../commands/system.ts";
import { route, type Route } from "./route.ts";
import type { BotContext } from "../../app/bot-context.ts";
import type { Player } from "../../player/player.ts";
import { LIFETIME, noticeInstead, noticeSelf, selfOnly, toSelf } from "../../ui/delivery.ts";
import { VOLUME_MAX } from "../../rules/limits.ts";

/** 서버 메시지의 버튼 */
type Press = ButtonInteraction<"cached">;

// 재생 패널의 버튼. custom_id 는 panel:동작:세션
const PANEL_ACTIONS: Record<string, (it: Press, player: Player) => unknown> = {
  pause: (it, player) => answerPause(it, player),
  skip: (it, player) => answerSkip(it, player),
  stop: (it, player) => answerStop(it, player),
  queue: (it, player) => handleQueue(it, player),
  shuffle: (it, player) => answerShuffle(it, player),
  highlight: (it, player) => answerHighlight(it, player, { onNone: () => it.deferUpdate() }),
  volume: (it) => handleVolumeButton(it),
  // 순환: 끔 → 한 곡 반복 → 대기열 반복 → 끔. 라이브가 있으면 "끄기"에만 응한다
  loop: (it, player) => answerLoop(it, player, nextLoopMode(player.loop)),
  previous: (it, player) => answerPrevious(it, player),
};
// 운영자 설정으로 꺼지는 패널 동작. 꺼져 있으면 없는 버튼과 같다
const PANEL_ENABLED: Partial<Record<string, () => boolean>> = { highlight: () => config.sponsorblock.enabled };

// 재생 패널의 버튼. 플레이어가 있고 패널의 세션이 지금 세션이어야 한다.
// 동일 음성 채널, 계층 검사는 핸들러가 부르는 controls 가 한다. 대기열 보기는 검사 없이 연다
async function handlePanelButton(interaction: Press, { players }: BotContext) {
  const player = players.get(interaction.guild.id);
  if (!player) return noticeSelf(interaction, errors.notice("no-song"));

  const { action, rest } = partsOf(interaction.customId);
  const sessionId = rest[0];
  if (sessionId && player.sessionId && sessionId !== player.sessionId) {
    return noticeSelf(interaction, errors.notice("stale-session"));
  }
  const handle = PANEL_ACTIONS[action];
  if (!handle || PANEL_ENABLED[action]?.() === false) return noticeSelf(interaction, errors.notice("unknown-interaction"));
  await handle(interaction, player);
}

async function handleQueue(interaction: Press, player: Player) {
  const queueInfo = queueInfoOf(player);

  if (queueInfo.queue.length === 0) {
    return await noticeSelf(interaction, errors.notice("queue-empty"));
  }

  await toSelf(interaction, selfOnly(queueView(queueInfo)), LIFETIME.screen);
}

// 대기열 넘기기(◀ ▶). 버튼이 달린 대기열 메시지를 그때의 대기열로 다시 그린다. 플레이어나 곡이 없으면 그 메시지를 삭제하고 그렇다고 알린다
async function handleQueuePage(interaction: Press, { players }: BotContext) {
  const player = players.get(interaction.guild.id);
  const info = player ? queueInfoOf(player) : null;
  if (!info || info.queue.length === 0) {
    return noticeInstead(interaction, player ? errors.notice("queue-empty") : errors.notice("no-song"));
  }
  return interaction.update(queueView(info, pageOf(interaction.customId) ?? 1));
}

async function handleVolumeButton(interaction: Press) {
  const permErr = await checkControl(interaction.member);
  if (permErr) {
    return await noticeSelf(interaction, errors.notice(permErr));
  }

  await interaction.showModal(volumeModal());
}

/** 볼륨을 입력하는 모달. 받는 쪽은 modal-handler 의 handleVolumeSubmit */
function volumeModal() {
  const t = controlText.volumeModal();
  const volumeInput = new TextInputBuilder().setCustomId("level").setLabel(t.label).setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(String(VOLUME_MAX).length).setPlaceholder("50").setRequired(true);
  return new ModalBuilder().setCustomId(customId(PANEL, "volume")).setTitle(t.title).addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(volumeInput));
}

/** 새로 그린 화면 */
type Built = { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> };

// 새로고침 버튼: 버튼이 달린 메시지를 새 내용으로 고친다
async function refreshMessage(interaction: Press, build: (client: Client<true>) => Built | Promise<Built>, { failed, notice }: { failed: string; notice: Notice }) {
  try {
    await interaction.deferUpdate();
    const { embed, row } = await build(interaction.client);
    await interaction.editReply({ embeds: [embed], components: [row] });
  } catch (error) {
    log.error(failed, error);
    try {
      await noticeSelf(interaction, notice);
    } catch (err) {
      log.error("오류 안내 전송 실패:", err);
    }
  }
}

function handleHelpRefresh(interaction: Press, bot: BotContext) {
  return refreshMessage(interaction, (client) => buildHelpEmbed(client, bot), { failed: "명령어 도움말 새로고침 실패:", notice: errors.notice("refresh-failed") });
}

async function handleSystemRefresh(interaction: Press, { players }: BotContext) {
  // /system과 동일하게 봇 운영자 전용
  if (!isBotOwner(interaction.user.id)) {
    return await noticeSelf(interaction, errors.notice("must-owner"));
  }
  return refreshMessage(interaction, (client) => buildSystemEmbed(client, players), { failed: "시스템 정보 새로고침 실패:", notice: errors.notice("refresh-failed") });
}

// custom_id 접두사로 구분한다. 플레이어 없이도 눌리는 것(새로고침, 대기열 넘기기)과 재생 패널의 버튼.
const routes: Route[] = [
  route("button", customId(HELP, "refresh"), handleHelpRefresh),
  route("button", customId(SYSTEM, "refresh"), handleSystemRefresh),
  route("button", PAGE_PREFIX, handleQueuePage),
  // 재생 패널의 버튼. 자동재생 버튼은 접두사가 더 좁아 interactions/autoplay 가 받는다
  route("button", customId(PANEL, ""), handlePanelButton),
];

export { routes, handlePanelButton, handleQueue, handleQueuePage, handleVolumeButton, volumeModal, refreshMessage, handleHelpRefresh, handleSystemRefresh };
