import { EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonBuilder, type ButtonInteraction, type Client } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "events" });
import config from "../../config/index.ts";
import * as errors from "../../ui/text/ko/errors.ts";
import type { Notice } from "../../ui/text/notice.ts";
import { addFailureMessage } from "../../ui/error-messages.ts";
import { requestPlayback } from "../../usecases/add-tracks.ts";
import { channelResponder } from "../../usecases/responders.ts";
import { checkControl, checkAdd, checkSummon } from "../../usecases/permissions.ts";
import { nextLoopMode } from "../../rules/loop-cycle.ts";
import { answerPause, answerSkip, answerPrevious, answerStop, answerShuffle, answerLoop, answerHighlight } from "./control-answers.ts";
import * as controlText from "../../ui/text/ko/controls.ts";

import { PANEL, HELP, SYSTEM, SEARCH, customId, partsOf } from "../../ui/custom-ids.ts";
import { showFailureWith } from "../../ui/failure-notice.ts";
import { queueView, queueInfoOf, pageOf, PAGE_PREFIX } from "../../ui/queue-view.ts";
import { buildHelpEmbed } from "../commands/help.ts";
import { buildSystemEmbed } from "../commands/system.ts";
import { route, type Route } from "./route.ts";
import type { BotContext } from "../../app/bot-context.ts";
import type { Player } from "../../player/player.ts";
import { colorOf } from "../../ui/colors.ts";
import * as searchText from "../../ui/text/ko/search.ts";
import { LIFETIME, noticeInstead, noticeSelf, selfOnly, toSelf, unlessGone } from "../../ui/delivery.ts";
import { VOLUME_MAX } from "../../rules/limits.ts";
import { youtubeWatchUrl } from "../../rules/links.ts";

/** 서버 메시지의 버튼 */
type Press = ButtonInteraction<"cached">;

const VIDEO_ID = /^[\w-]{11}$/;

// 재생 패널의 버튼. custom_id 는 panel:동작:세션
const PANEL_ACTIONS: Record<string, (it: Press, player: Player) => unknown> = {
  pause: (it, player) => answerPause(it, player),
  skip: (it, player) => answerSkip(it, player),
  stop: (it, player) => answerStop(it, player),
  queue: (it, player) => handleQueue(it, player),
  shuffle: (it, player) => answerShuffle(it, player),
  highlight: (it, player) => answerHighlight(it, player, { onNone: () => it.deferUpdate() }),
  volume: (it) => handleVolumeModal(it),
  // 순환: 끔 → 한곡 → 대기열 → 끔. 라이브가 있으면 "끄기"에만 응한다
  loop: (it, player) => answerLoop(it, player, nextLoopMode(player.loop)),
  previous: (it, player) => answerPrevious(it, player),
};
// 운영자 설정으로 꺼지는 패널 동작. 꺼져 있으면 없는 버튼과 같다
const PANEL_ENABLED: Partial<Record<string, () => boolean>> = { highlight: () => config.sponsorblock.enabled };

// 재생 패널의 버튼. 플레이어가 있고 패널의 세션이 지금 세션이어야 한다.
// 재적 · 계층 검사는 처리기가 부르는 controls 가 한다. 대기열 보기는 검사 없이 연다
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

async function handleVolumeModal(interaction: Press) {
  const permErr = await checkControl(interaction.member);
  if (permErr) {
    return await noticeSelf(interaction, errors.notice(permErr));
  }

  await interaction.showModal(volumeModal());
}

/** 볼륨을 입력하는 모달. 받는 쪽은 modalHandler 의 볼륨 처리 */
function volumeModal() {
  const t = controlText.volumeModal();
  const volumeInput = new TextInputBuilder().setCustomId("volume_input").setLabel(t.label).setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(String(VOLUME_MAX).length).setPlaceholder("50").setRequired(true);
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
  if (interaction.user.id !== config.dashboard.ownerId) {
    return await noticeSelf(interaction, errors.notice("must-owner"));
  }
  return refreshMessage(interaction, (client) => buildSystemEmbed(client, players), { failed: "시스템 정보 새로고침 실패:", notice: errors.notice("refresh-failed") });
}

// 검색 결과 선택 · 취소. 검색한 사람만 누를 수 있다. 선택한 영상은 다시 찾는다(다운로드해 둔 곡이면 캐시에서)
async function handleSearchInteraction(interaction: Press, bot: BotContext) {
  const { member, guild } = interaction;
  const { action, rest } = partsOf(interaction.customId);
  const [userId, position, videoId = ""] = rest;

  if (userId !== interaction.user.id) {
    return await noticeSelf(interaction, errors.notice("search-owner-only"));
  }

  // 취소는 결과 화면(본인)을 바로 삭제한다
  if (action === "cancel") {
    await interaction.deferUpdate();
    return await interaction.deleteReply();
  }
  if (action !== "pick" || !VIDEO_ID.test(videoId)) return await noticeSelf(interaction, errors.notice("unknown-interaction"));

  // 곡 추가 경로. /play · /search 와 같은 검사
  const permErr = checkAdd(member) || checkSummon(member);
  if (permErr) return await noticeSelf(interaction, errors.notice(permErr));

  await interaction.deferUpdate();

  const adding = searchText.adding();
  const processingEmbed = new EmbedBuilder().setTitle(adding.title).setDescription(adding.description).setColor(colorOf("brand")).setTimestamp();

  await interaction.editReply({ embeds: [processingEmbed], components: [] });
  // 여기서부터 던지면 "처리 중" 자리표시자를 삭제하고 본인에게만 알린다(검색 메시지는 임베드라 안내로 고칠 수 없다)
  showFailureWith(interaction, (notice) => noticeInstead(interaction, notice));

  // 안내는 채널로, 자리표시자는 이 상호작용의 "처리 중" 응답.
  const responder = channelResponder(interaction.channel, () => interaction.deleteReply().catch(unlessGone(log, "자리표시자 삭제")));

  const result = await requestPlayback(bot, {
    guild,
    requester: member,
    query: youtubeWatchUrl(videoId),
    textChannel: interaction.channel,
    voiceChannel: member.voice.channel ?? null,
    responder,
    source: `/search ${position}번째`,
  });
  if (!result.success) return await noticeInstead(interaction, addFailureMessage(result));

  // "곡을 추가하는 중" 자리표시자(본인)를 치운다. 담은 안내 · 패널은 채널에 따로 갔다
  await responder.dismissPlaceholder();
}

// custom_id 접두사로 구분한다. 플레이어 없이도 눌리는 것(검색 · 새로고침 · 자동재생 · 대기열 넘기기)과 재생 패널의 버튼.
// 자동재생은 놀고 있을 때도 켤 수 있어 끝난 패널의 버튼도 여기로 온다
const routes: Route[] = [
  route("button", customId(SEARCH, ""), handleSearchInteraction),
  route("button", customId(HELP, "refresh"), handleHelpRefresh),
  route("button", customId(SYSTEM, "refresh"), handleSystemRefresh),
  route("button", PAGE_PREFIX, handleQueuePage),
  // 자동재생은 놀고 있을 때도 켤 수 있어 끝난 패널의 버튼도 여기로 온다. 재생 패널의 다른 버튼보다 좁다
  route("button", customId(PANEL, ""), handlePanelButton),
];

export { routes, handlePanelButton, handleQueue, handleQueuePage, handleVolumeModal, volumeModal, refreshMessage, handleHelpRefresh, handleSystemRefresh, handleSearchInteraction };
