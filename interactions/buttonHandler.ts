import { EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonBuilder, type ButtonInteraction, type Client, MessageFlags } from "discord.js";
import logger from "../src/infra/log/logger.ts";
const log = logger.child({ category: "events" });
import config from "../config.ts";
import * as errors from "../src/ui/text/ko/errors.ts";
import { noticeReply, type Notice } from "../src/ui/frame.ts";
import { addFailureMessage } from "../src/ui/errorMessages.ts";
import { requestPlayback } from "../src/usecases/addTracks.ts";
import { channelResponder } from "../src/usecases/responders.ts";
import { checkControl, checkAdd, checkSummon } from "../src/usecases/permissions.ts";
import * as controls from "../src/usecases/controls.ts";
import { answerPause, answerSkip, answerPrevious, answerStop, answerShuffle, answerLoop, answerHighlight } from "./controlAnswers.ts";
import * as controlText from "../src/ui/text/ko/controls.ts";

import { PANEL, HELP, SYSTEM, SEARCH, customId, partsOf } from "../src/ui/customIds.ts";
import { noticeInstead, showFailureWith } from "../src/ui/failureNotice.ts";
import { queueView, queueInfoOf, pageOf, PAGE_PREFIX } from "../src/ui/queueView.ts";
import { buildHelpEmbed } from "../commands/help.ts";
import { buildSystemEmbed } from "../commands/system.ts";
import { route, type Route } from "./route.ts";
import type { Player } from "../src/player/Player.ts";
import { colorOf } from "../src/ui/colors.ts";
import * as searchText from "../src/ui/text/ko/search.ts";

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
  loop: (it, player) => answerLoop(it, player, controls.nextLoopMode(player.loop)),
  previous: (it, player) => answerPrevious(it, player),
};

// 재생 패널의 버튼. 플레이어가 있고 패널의 세션이 지금 세션이어야 한다.
// 재적 · 계층 검사는 처리기가 부르는 controls 가 한다. 대기열 보기는 검사 없이 연다
async function handlePanelButton(interaction: Press) {
  const player = interaction.client.players.get(interaction.guild.id);
  if (!player) return interaction.reply(noticeReply(errors.noSong()));

  const { action, rest } = partsOf(interaction.customId);
  const sessionId = rest[0];
  if (sessionId && player.sessionId && sessionId !== player.sessionId) {
    return interaction.reply(noticeReply(errors.staleSession()));
  }
  const handle = PANEL_ACTIONS[action];
  if (!handle) return interaction.reply(noticeReply(errors.unknownInteraction()));
  await handle(interaction, player);
}

async function handleQueue(interaction: Press, player: Player) {
  const queueInfo = queueInfoOf(player);

  if (queueInfo.queue.length === 0) {
    return await interaction.reply(noticeReply(errors.queueEmpty()));
  }

  await interaction.reply({ ...queueView(queueInfo), flags: MessageFlags.Ephemeral });
}

// 대기열 넘기기(◀ ▶). 버튼이 달린 대기열 메시지를 그때의 대기열로 다시 그린다. 플레이어나 곡이 없으면 그 메시지를 지우고 그렇다고 알린다
async function handleQueuePage(interaction: Press) {
  const player = interaction.client.players.get(interaction.guild.id);
  const info = player ? queueInfoOf(player) : null;
  if (!info || info.queue.length === 0) {
    return noticeInstead(interaction, player ? errors.queueEmpty() : errors.noSong());
  }
  return interaction.update(queueView(info, pageOf(interaction.customId) ?? 1));
}

async function handleVolumeModal(interaction: Press) {
  const permErr = await checkControl(interaction.member);
  if (permErr) {
    return await interaction.reply(noticeReply(errors.permission(permErr)));
  }

  await interaction.showModal(volumeModal());
}

/** 음량을 적는 모달. 받는 쪽은 modalHandler 의 음량 처리 */
function volumeModal() {
  const t = controlText.volumeModal();
  const volumeInput = new TextInputBuilder().setCustomId("volume_input").setLabel(t.label).setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(3).setPlaceholder("50").setRequired(true);
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
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(noticeReply(notice));
      } else {
        await interaction.followUp(noticeReply(notice));
      }
    } catch (err) {
      log.error("오류 안내 전송 실패:", err);
    }
  }
}

function handleHelpRefresh(interaction: Press) {
  return refreshMessage(interaction, (client) => buildHelpEmbed(client), { failed: "명령어 도움말 새로고침 실패:", notice: errors.refreshFailed() });
}

async function handleSystemRefresh(interaction: Press) {
  // /system과 동일하게 봇 운영자 전용
  if (interaction.user.id !== config.dashboard.ownerId) {
    return await interaction.reply(noticeReply(errors.mustOwner()));
  }
  return refreshMessage(interaction, (client) => buildSystemEmbed(client), { failed: "시스템 정보 새로고침 실패:", notice: errors.refreshFailed() });
}

// 검색 결과 고르기 · 취소. 검색한 사람만 누를 수 있다. 고른 영상은 다시 찾는다(받아 둔 곡이면 캐시에서)
async function handleSearchInteraction(interaction: Press, client: Client<true>) {
  const { member, guild } = interaction;
  const { action, rest } = partsOf(interaction.customId);
  const [userId, position, videoId = ""] = rest;

  if (userId !== interaction.user.id) {
    return await interaction.reply(noticeReply(errors.searchOwnerOnly()));
  }

  if (action === "cancel") {
    const t = searchText.cancelled();
    const embed = new EmbedBuilder().setTitle(t.title).setDescription(t.description).setColor(colorOf("brand")).setTimestamp();
    return await interaction.update({ embeds: [embed], components: [] });
  }
  if (action !== "pick" || !VIDEO_ID.test(videoId)) return await interaction.reply(noticeReply(errors.unknownInteraction()));

  // 곡 추가 경로. /play · /search 와 같은 검사
  const permErr = checkAdd(member) || checkSummon(member);
  if (permErr) return await interaction.reply(noticeReply(errors.permission(permErr)));

  await interaction.deferUpdate();

  const adding = searchText.adding();
  const processingEmbed = new EmbedBuilder().setTitle(adding.title).setDescription(adding.description).setColor(colorOf("brand")).setTimestamp();

  await interaction.editReply({ embeds: [processingEmbed], components: [] });
  // 여기서부터 던지면 "처리 중" 자리를 지우고 본인에게만 알린다(검색 메시지는 임베드라 안내로 고칠 수 없다)
  showFailureWith(interaction, (notice) => noticeInstead(interaction, notice));

  // 안내는 채널로, 자리표시자는 이 상호작용의 "처리 중" 응답.
  const responder = channelResponder(interaction.channel, () =>
    interaction.deleteReply().catch(() => {
      /* 이미 지워졌다 */
    }),
  );

  const result = await requestPlayback(client, {
    guild,
    requester: member,
    query: `https://www.youtube.com/watch?v=${videoId}`,
    textChannel: interaction.channel,
    voiceChannel: member.voice.channel ?? null,
    responder,
    source: `/search ${position}번째`,
  });
  if (!result.success) return await noticeInstead(interaction, addFailureMessage(result));

  // 검색 결과 메시지 제거. 현재 재생/대기열 정보는 별도로 전송됨
  await responder.dismissPlaceholder();
}

// custom_id 앞머리로 가른다. 플레이어 없이도 눌리는 것(검색 · 새로고침 · 자동재생 · 대기열 넘기기)과 재생 패널의 버튼.
// 자동재생은 놀고 있을 때도 켤 수 있어 끝난 패널의 버튼도 여기로 온다
const routes: Route[] = [
  route("button", customId(SEARCH, ""), (it) => handleSearchInteraction(it, it.client)),
  route("button", customId(HELP, "refresh"), handleHelpRefresh),
  route("button", customId(SYSTEM, "refresh"), handleSystemRefresh),
  route("button", PAGE_PREFIX, handleQueuePage),
  // 자동재생은 놀고 있을 때도 켤 수 있어 끝난 패널의 버튼도 여기로 온다. 재생 패널의 다른 버튼보다 좁다
  route("button", customId(PANEL, ""), handlePanelButton),
];

export { routes, handlePanelButton, handleQueue, handleQueuePage, handleVolumeModal, volumeModal, refreshMessage, handleHelpRefresh, handleSystemRefresh, handleSearchInteraction };
