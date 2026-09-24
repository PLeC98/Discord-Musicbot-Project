// 재생목록 "더 넣기" 메뉴(셀렉트)와 직접 입력(모달). 상태는 custom_id에 있다(src/usecases/playlistMore.ts).

import { Events, MessageFlags, type ActionRowBuilder, type ModalMessageModalSubmitInteraction, type StringSelectMenuBuilder, type StringSelectMenuInteraction } from "discord.js";
import logger from "../src/infra/log/logger.ts";
const log = logger.child({ category: "events" });
import * as S from "../src/ui/strings.ts";
import { checkAdd } from "../src/usecases/permissions.ts";
import * as GuildSettingsManager from "../src/store/guildSettings.ts";
import { continueCollection } from "../src/usecases/addTracks.ts";
import * as More from "../src/usecases/playlistMore.ts";
import type { ClientEvent } from "../src/app/main.ts";
import type { MoreState } from "../src/usecases/playlistMore.ts";
import type { MusicPlayer } from "../src/player/Player.ts";

const PROGRESS_EVERY_MS = 2000;

/** 더 넣기 메뉴(셀렉트) 또는 곡 수 입력(메뉴 메시지에서 연 모달) */
type MoreInteraction = StringSelectMenuInteraction<"cached"> | ModalMessageModalSubmitInteraction<"cached">;

const closed = () => {
  /* 상호작용이 이미 닫혔다 */
};

const refuser = (interaction: MoreInteraction) => (text: string) => interaction.reply({ content: S.withErrorMark(text), flags: MessageFlags.Ephemeral }).catch(closed);

// 그만 넣기. 넣은 사람이면 시간이 지났든 권한이 바뀌었든 바로 지운다
async function stop(interaction: StringSelectMenuInteraction<"cached">, state: MoreState) {
  if (state.requesterId && state.requesterId !== interaction.user.id) return refuser(interaction)("목록을 넣은 사람만 닫을 수 있어요.");
  More.clearExpiry(interaction.message.id);
  await interaction.deferUpdate().catch(closed);
  return interaction.deleteReply().catch(closed);
}

// 넣을 곡 수. 직접 입력을 고르면 모달을 띄우고, 받을 수 없는 값이면 거절한다(둘 다 null)
async function countOf(interaction: MoreInteraction, state: MoreState, player: MusicPlayer): Promise<number | null> {
  const refuse = refuser(interaction);
  let count: number | null;
  if (interaction.isStringSelectMenu()) {
    const value = interaction.values[0];
    if (value === "custom") {
      const room = More.roomFor(player);
      if (room <= 0) await refuse("대기열이 가득 차 지금은 더 넣을 수 없어요.");
      else await interaction.showModal(More.countModal(state, Number.isFinite(room) ? room : More.MAX_COUNT, GuildSettingsManager.resolvePlaylistAddMax(interaction.guild.id)));
      return null;
    }
    count = More.parseCount(value);
  } else count = More.parseCount(interaction.fields.getTextInputValue("count"));
  if (!count) await refuse("넣을 곡 수를 1 이상의 숫자로 적어 주세요.");
  return count || null;
}

// 이어 받아 넣고 결과로 메시지를 바꾼다
async function addMore(interaction: MoreInteraction, state: MoreState, count: number, player: MusicPlayer) {
  const message = interaction.message;
  // 메뉴를 떼어 두 번 누르지 못하게 하면서 3초 안에 응답한다
  if (message) More.clearExpiry(message.id);
  await interaction.update({ content: "⏳ 곡을 가져오는 중…", components: [] });

  let lastEdit = 0;
  const onProgress = (done: number, want: number) => {
    const now = Date.now();
    if (done >= want || now - lastEdit < PROGRESS_EVERY_MS) return;
    lastEdit = now;
    interaction.editReply({ content: `⏳ ${done}/${want}곡 가져오는 중…` }).catch(() => {
      /* 진행 표시는 놓쳐도 된다 */
    });
  };

  let payload: { content: string; components: ActionRowBuilder<StringSelectMenuBuilder>[] };
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
    payload = result.success ? More.resultMessage(state, result, More.roomFor(player)) : { content: S.withErrorMark(result.message), components: [] };
  } catch (error) {
    log.error("재생목록 더 넣기 실패:", error);
    payload = { content: S.ERR_PROCESSING, components: [] };
  }

  await interaction.editReply(payload).catch(closed);
  if (message) More.expireLater(message.id, () => interaction.deleteReply());
}

async function handleMore(interaction: MoreInteraction) {
  const refuse = refuser(interaction);
  const state = More.decodeState(interaction.customId);
  if (!state) return refuse("알 수 없는 메뉴예요.");
  if (interaction.isStringSelectMenu() && interaction.values[0] === "stop") return stop(interaction, state);

  const message = interaction.message;
  const lastTouched = message?.editedTimestamp ?? message?.createdTimestamp ?? 0;
  const clickErr = More.clickError(state, { userId: interaction.user.id, lastTouched });
  if (clickErr) return refuse(clickErr);

  const permErr = checkAdd(interaction.member);
  if (permErr) return refuse(permErr);

  const player = interaction.client.players.get(interaction.guild.id);
  if (!player) return refuse(S.ERR_NO_MUSIC);

  const count = await countOf(interaction, state, player);
  if (count) await addMore(interaction, state, count, player);
}

const exported: ClientEvent<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${More.SELECT_PREFIX}:`)) return handleMore(interaction);
    // 곡 수 입력 모달은 메뉴 메시지에서 연다(그 메시지를 고친다)
    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${More.MODAL_PREFIX}:`) && interaction.isFromMessage()) return handleMore(interaction);
  },
};
export default exported;
