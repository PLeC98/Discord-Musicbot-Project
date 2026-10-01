// 재생목록 "더 넣기" 메뉴(셀렉트)와 직접 입력(모달). 상태는 custom_id에 있다(src/usecases/playlistMore.ts).

import { type ActionRowBuilder, type EmbedBuilder, type ModalMessageModalSubmitInteraction, type StringSelectMenuBuilder, type StringSelectMenuInteraction } from "discord.js";
import logger from "../src/infra/log/logger.ts";
const log = logger.child({ category: "events" });
import * as errors from "../src/ui/text/errors.ts";
import { noticeEmbed, noticeReply, type Notice } from "../src/ui/frame.ts";
import * as moreText from "../src/ui/text/more.ts";
import { addFailureMessage, errorMessage } from "../src/ui/errorMessages.ts";
import { checkAdd } from "../src/usecases/permissions.ts";
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import { continueCollection } from "../src/usecases/addTracks.ts";
import * as More from "../src/usecases/playlistMore.ts";
import { route, type Route } from "./route.ts";
import type { MoreState } from "../src/usecases/playlistMore.ts";
import type { Player } from "../src/player/Player.ts";

const PROGRESS_EVERY_MS = 2000;

/** 더 넣기 메뉴(셀렉트) 또는 곡 수 입력(메뉴 메시지에서 연 모달) */
type MoreInteraction = StringSelectMenuInteraction<"cached"> | ModalMessageModalSubmitInteraction<"cached">;

const closed = () => {
  /* 상호작용이 이미 닫혔다 */
};

const refuser = (interaction: MoreInteraction) => (notice: Notice) => interaction.reply(noticeReply(notice)).catch(closed);

// 그만 넣기. 넣은 사람이면 시간이 지났든 권한이 바뀌었든 바로 지운다
async function stop(interaction: StringSelectMenuInteraction<"cached">, state: MoreState) {
  if (state.requesterId && state.requesterId !== interaction.user.id) return refuser(interaction)(moreText.refusal("not-requester-close"));
  More.clearExpiry(interaction.message.id);
  await interaction.deferUpdate().catch(closed);
  return interaction.deleteReply().catch(closed);
}

// 넣을 곡 수. 직접 입력을 고르면 모달을 띄우고, 받을 수 없는 값이면 거절한다(둘 다 null)
async function countOf(interaction: MoreInteraction, state: MoreState, player: Player): Promise<number | null> {
  const refuse = refuser(interaction);
  let count: number | null;
  if (interaction.isStringSelectMenu()) {
    const value = interaction.values[0];
    if (value === "custom") {
      const room = More.roomFor(player);
      if (room <= 0) await refuse(moreText.refusal("full"));
      else await interaction.showModal(More.countModal(state, Number.isFinite(room) ? room : More.MAX_COUNT, GuildSettingsManager.resolvePlaylistAddMax(interaction.guild.id)));
      return null;
    }
    count = More.parseCount(value);
  } else count = More.parseCount(interaction.fields.getTextInputValue("count"));
  if (!count) await refuse(moreText.refusal("bad-count"));
  return count || null;
}

// 이어 받아 넣고 결과로 메시지를 바꾼다
async function addMore(interaction: MoreInteraction, state: MoreState, count: number, player: Player) {
  const message = interaction.message;
  // 메뉴를 떼어 두 번 누르지 못하게 하면서 3초 안에 응답한다
  if (message) More.clearExpiry(message.id);
  await interaction.update({ content: moreText.fetching(), components: [] });

  let lastEdit = 0;
  const onProgress = (done: number, want: number) => {
    const now = Date.now();
    if (done >= want || now - lastEdit < PROGRESS_EVERY_MS) return;
    lastEdit = now;
    interaction.editReply({ content: moreText.fetchingCount(done, want) }).catch(() => {
      /* 진행 표시는 놓쳐도 된다 */
    });
  };

  // 메뉴 메시지는 글자 메시지라 실패는 임베드로 바꾼다
  let payload: { content: string; embeds?: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] };
  try {
    const result = await continueCollection(interaction.client, {
      guild: interaction.guild,
      requester: interaction.member,
      state,
      count,
      textChannel: interaction.channel,
      voiceChannel: interaction.member.voice?.channel ?? null,
      onProgress,
    });
    payload = result.success ? More.resultMessage(state, result, More.roomFor(player)) : { content: "", embeds: [noticeEmbed(addFailureMessage(result))], components: [] };
  } catch (error) {
    log.error("재생목록 더 넣기 실패:", error);
    payload = { content: "", embeds: [noticeEmbed(errorMessage(error))], components: [] };
  }

  await interaction.editReply(payload).catch(closed);
  if (message) More.expireLater(message.id, () => interaction.deleteReply());
}

async function handleMore(interaction: MoreInteraction) {
  const refuse = refuser(interaction);
  const state = More.decodeState(interaction.customId);
  if (!state) return refuse(moreText.refusal("unknown-menu"));
  if (interaction.isStringSelectMenu() && interaction.values[0] === "stop") return stop(interaction, state);

  const message = interaction.message;
  const lastTouched = message?.editedTimestamp ?? message?.createdTimestamp ?? 0;
  const clickErr = More.clickError(state, { userId: interaction.user.id, lastTouched });
  if (clickErr) return refuse(moreText.refusal(clickErr));

  const permErr = checkAdd(interaction.member);
  if (permErr) return refuse(errors.permission(permErr));

  const player = interaction.client.players.get(interaction.guild.id);
  if (!player) return refuse(errors.noPlayer());

  const count = await countOf(interaction, state, player);
  if (count) await addMore(interaction, state, count, player);
}

// 곡 수 입력 모달은 메뉴 메시지에서 연다(그 메시지를 고친다). 메시지에서 온 것이 아니면 받지 않는다
const routes: Route[] = [route("select", `${More.SELECT_PREFIX}:`, handleMore), route("modal", `${More.MODAL_PREFIX}:`, (it) => (it.isFromMessage() ? handleMore(it) : undefined))];

export { routes };
