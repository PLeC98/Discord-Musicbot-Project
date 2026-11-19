import { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "events" });
import config from "../../config/index.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import { checkControl, isBotOwner } from "../../usecases/permissions.ts";
import { nextLoopMode } from "../../rules/loop-cycle.ts";
import { answerPause, answerSkip, answerPrevious, answerStop, answerShuffle, answerLoop, answerHighlight } from "./control-answers.ts";
import * as controlText from "../../ui/text/ko/controls.ts";

import { PANEL, PING, SYSTEM, customId, partsOf } from "../../ui/custom-ids.ts";
import { openQueue } from "../commands/queue.ts";
import { systemScreen } from "../commands/system.ts";
import { pingAgain } from "../commands/ping.ts";
import { post } from "../../ui/frame.ts";
import { route, type Route } from "./route.ts";
import type { BotContext } from "../../app/bot-context.ts";
import type { Player } from "../../player/player.ts";
import { LIFETIME, keepSelf, noticeSelf } from "../../ui/delivery.ts";
import { VOLUME_MAX } from "../../rules/limits.ts";

/** 서버 메시지의 버튼 */
type Press = ButtonInteraction<"cached">;

// 재생 패널의 버튼. custom_id는 panel:동작:세션
const PANEL_ACTIONS: Record<string, (it: Press, player: Player) => unknown> = {
  pause: (it, player) => answerPause(it, player),
  skip: (it, player) => answerSkip(it, player),
  stop: (it, player) => answerStop(it, player),
  queue: (it, player) => openQueue(it, player),
  shuffle: (it, player) => answerShuffle(it, player),
  highlight: (it, player) => answerHighlight(it, player, { onNone: () => it.deferUpdate() }),
  volume: (it, player) => handleVolumeButton(it, player),
  // 순환: 끔 → 한 곡 반복 → 대기열 반복 → 끔. 라이브가 있으면 "끄기"에만 응한다
  loop: (it, player) => answerLoop(it, player, nextLoopMode(player.loop)),
  previous: (it, player) => answerPrevious(it, player),
};
// 운영자 설정으로 꺼지는 패널 동작. 꺼져 있으면 없는 버튼과 같다
const PANEL_ENABLED: Partial<Record<string, () => boolean>> = { highlight: () => config.sponsorblock.enabled };

// 재생 패널의 버튼. 플레이어가 있고 패널의 세션이 지금 세션이어야 한다.
// 동일 음성 채널, 계층 검사는 핸들러가 부르는 controls가 한다. 대기열 보기는 검사 없이 연다
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

async function handleVolumeButton(interaction: Press, player: Player) {
  const permErr = await checkControl(interaction.member);
  if (permErr) {
    return await noticeSelf(interaction, errors.notice(permErr));
  }

  await interaction.showModal(volumeModal(player.volume));
}

/** 볼륨을 입력하는 모달. 자리표시는 지금 볼륨. 받는 쪽은 panel-inputs의 handleVolumeSubmit */
function volumeModal(current: number) {
  const t = controlText.volumeModal(current);
  const volumeInput = new TextInputBuilder().setCustomId("level").setLabel(t.label).setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(String(VOLUME_MAX).length).setPlaceholder(t.placeholder).setRequired(true);
  return new ModalBuilder().setCustomId(customId(PANEL, "volume")).setTitle(t.title).addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(volumeInput));
}

// /system의 새로고침: 같은 메시지를 현재 값의 이미지로 고친다(기존 첨부는 attachments: []로 비운다)
async function handleSystemRefresh(interaction: Press, bot: BotContext) {
  // /system과 동일하게 봇 운영자 전용
  if (!isBotOwner(interaction.user.id)) {
    return await noticeSelf(interaction, errors.notice("must-owner"));
  }
  // 업데이트 전에 보낸 임베드 메시지는 Components V2 로 고칠 수 없다
  if (!interaction.message.flags.has(MessageFlags.IsComponentsV2)) return noticeSelf(interaction, errors.notice("unknown-interaction"));
  try {
    await interaction.deferUpdate();
    const { view, files } = await systemScreen(bot);
    await interaction.editReply({ ...post(view, files), attachments: [] });
    keepSelf(interaction, LIFETIME.screen);
  } catch (error) {
    log.error("시스템 정보 새로고침 실패:", error);
    try {
      await noticeSelf(interaction, errors.notice("refresh-failed"));
    } catch (err) {
      log.error("오류 안내 전송 실패:", err);
    }
  }
}

// custom_id 접두사로 구분한다. 플레이어 없이도 눌리는 것(새로고침, 다시 재기)과 재생 패널의 버튼. 대기열 화면의 버튼은 interactions/queue-handler
const routes: Route[] = [
  route("button", customId(SYSTEM, "refresh"), handleSystemRefresh),
  route("button", customId(PING, "again"), (interaction) => pingAgain(interaction)),
  // 재생 패널의 버튼. 자동재생 버튼은 접두사가 더 좁아 interactions/autoplay가 받는다
  route("button", customId(PANEL, ""), handlePanelButton),
];

export { routes, handlePanelButton, handleVolumeButton, volumeModal, handleSystemRefresh };
