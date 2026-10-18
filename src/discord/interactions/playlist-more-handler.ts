// 재생목록 "더 넣기" 메뉴(셀렉트)와 직접 입력(모달). 상태는 custom_id에 있다(src/usecases/playlist-more.ts).

import { MessageFlags, type ContainerBuilder, type ModalMessageModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "events" });
import * as errors from "../../ui/text/ko/errors.ts";
import config from "../../config/index.ts";
import { post } from "../../ui/frame.ts";
import type { Notice } from "../../ui/text/notice.ts";
import { fetchingView } from "../../ui/playlist-more-menu.ts";
import { addFailureMessage, errorMessage } from "../../ui/error-messages.ts";
import { checkAdd } from "../../usecases/permissions.ts";
import * as GuildSettingsManager from "../../store/guild-settings.ts";
import { continueCollection } from "../../usecases/add-tracks.ts";
import * as More from "../../usecases/playlist-more.ts";
import { route, type Route } from "./route.ts";
import type { BotContext } from "../../app/bot-context.ts";
import { MAX_COUNT, parseCount, type MoreState } from "../../rules/more-choices.ts";
import type { Player } from "../../player/player.ts";
import { LIFETIME, noticeInstead, noticeSelf, toAll } from "../../ui/delivery.ts";

const PROGRESS_EVERY_MS = 2000;

/** 더 넣기 메뉴(셀렉트) 또는 곡 수 입력(메뉴 메시지에서 연 모달) */
type MoreInteraction = StringSelectMenuInteraction<"cached"> | ModalMessageModalSubmitInteraction<"cached">;

const closed = () => {
  /* 상호작용이 이미 닫혔다 */
};

const refuser = (interaction: MoreInteraction) => (notice: Notice) => noticeSelf(interaction, notice).catch(closed);

// 그만 넣기. 넣은 사람이면 시간이 지났든 권한이 바뀌었든 바로 삭제한다
async function stop(interaction: StringSelectMenuInteraction<"cached">, state: MoreState) {
  if (state.requesterId && state.requesterId !== interaction.user.id) return refuser(interaction)(errors.notice("more-not-requester-close"));
  More.clearExpiry(interaction.message.id);
  await interaction.deferUpdate().catch(closed);
  return interaction.deleteReply().catch(closed);
}

// 넣을 곡 수. 직접 입력을 선택하면 모달을 열고, 받을 수 없는 값이면 거절한다(둘 다 null)
async function countOf(interaction: MoreInteraction, state: MoreState, player: Player): Promise<number | null> {
  const refuse = refuser(interaction);
  let count: number | null;
  if (interaction.isStringSelectMenu()) {
    const value = interaction.values[0];
    if (value === "custom") {
      const room = More.roomFor(player);
      if (room <= 0) await refuse(errors.notice("queue-full", { max: config.bot.maxQueueSize }));
      else await interaction.showModal(More.countModal(state, Number.isFinite(room) ? room : MAX_COUNT, GuildSettingsManager.resolvePlaylistAddMax(interaction.guild.id)));
      return null;
    }
    count = parseCount(value);
  } else count = parseCount(interaction.fields.getTextInputValue("count"));
  if (!count) await refuse(errors.notice("more-bad-count"));
  return count || null;
}

// 이어 받아 넣고 결과로 메시지를 바꾼다
async function addMore(interaction: MoreInteraction, state: MoreState, count: number, player: Player, bot: BotContext) {
  const message = interaction.message;
  // 메뉴를 떼어 두 번 누르지 못하게 하면서 3초 안에 응답한다
  if (message) More.clearExpiry(message.id);
  await interaction.update(post(fetchingView()));

  let lastEdit = 0;
  const onProgress = (done: number, want: number) => {
    const now = Date.now();
    if (done >= want || now - lastEdit < PROGRESS_EVERY_MS) return;
    lastEdit = now;
    interaction.editReply(post(fetchingView({ done, want }))).catch(() => {
      /* 진행 표시는 놓쳐도 된다 */
    });
  };

  let outcome: { view: ContainerBuilder } | { failed: Notice };
  try {
    const result = await continueCollection(bot, {
      guild: interaction.guild,
      requester: interaction.member,
      state,
      count,
      textChannel: interaction.channel,
      voiceChannel: interaction.member.voice?.channel ?? null,
      onProgress,
    });
    outcome = result.success ? { view: More.resultView(state, result, More.roomFor(player)).view } : { failed: addFailureMessage(result) };
  } catch (error) {
    log.error("재생목록 더 넣기 실패:", error);
    outcome = { failed: errorMessage(error) };
  }

  // 실패면 메뉴를 삭제하고 본인에게만 알린다
  if ("failed" in outcome) {
    await noticeInstead(interaction, outcome.failed).catch(closed);
    return;
  }
  // 결과는 모두에게. 본인 메뉴(/play)면 삭제하고 채널에 새로, 채널의 메뉴(전용 채널)면 그 메시지를 고친다
  if (message?.flags.has(MessageFlags.Ephemeral)) return toAll(interaction, outcome.view, LIFETIME.glance).catch(closed);
  await interaction.editReply(post(outcome.view)).catch(closed);
  if (message) More.expireLater(message.id, () => interaction.deleteReply(), LIFETIME.glance);
}

async function handleMore(interaction: MoreInteraction, bot: BotContext) {
  const refuse = refuser(interaction);
  const state = More.decodeState(interaction.customId);
  if (!state) return refuse(errors.notice("more-unknown-menu"));
  if (interaction.isStringSelectMenu() && interaction.values[0] === "stop") return stop(interaction, state);

  const message = interaction.message;
  const lastTouched = message?.editedTimestamp ?? message?.createdTimestamp ?? 0;
  const clickErr = More.clickError(state, { userId: interaction.user.id, lastTouched });
  if (clickErr) return refuse(errors.notice(clickErr));

  const permErr = checkAdd(interaction.member);
  if (permErr) return refuse(errors.notice(permErr));

  const player = bot.players.get(interaction.guild.id);
  if (!player) return refuse(errors.notice("no-song"));

  const count = await countOf(interaction, state, player);
  if (count) await addMore(interaction, state, count, player, bot);
}

// 곡 수 입력 모달은 메뉴 메시지에서 연다(그 메시지를 고친다). 메시지에서 온 것이 아니면 받지 않는다
const routes: Route[] = [route("select", `${More.SELECT_PREFIX}:`, handleMore), route("modal", `${More.MODAL_PREFIX}:`, (it, bot) => (it.isFromMessage() ? handleMore(it, bot) : undefined))];

export { routes };
