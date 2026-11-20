// /queue 화면의 버튼, 메뉴, 모달: 넘기기, 편집 화면, 곡 고르기, 곡 버튼(지금 재생, 다음에 재생, 위로, 아래로, 삭제), 페이지 이동(ui/queue-view).
// 모두 누른 때의 대기열로 다시 그린다. 보기 화면은 썸네일을 기다리느라 미룬 뒤 고치고, 편집 화면은 이미지 없이 바로 고친다(붙어 있던 이미지는 뗀다).
// 같은 메시지를 잇달아 누르면 나중에 누른 것만 화면에 남긴다(보기 화면이 썸네일을 기다리는 사이 다른 것이 고쳤으면 버린다).
// 곡 버튼의 결과는 /move, /remove처럼 모두에게 알리고, 거절은 본인에게. 화면이 가리키는 곡은 대기열 ID로 다시 찾는다(rules/queue-edit)

import { MessageFlags, type ButtonInteraction, type ModalMessageModalSubmitInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import type { BotContext } from "../../app/bot-context.ts";
import logger from "../../infra/log/logger.ts";
import type { Player } from "../../player/player.ts";
import { isEditAction, movePlan, type EditAction } from "../../rules/queue-edit.ts";
import { controlMessage } from "../../ui/control-messages.ts";
import * as replies from "../../ui/control-replies.ts";
import { entryOfJump } from "../../ui/custom-ids.ts";
import { LIFETIME, keepSelf, noticeInstead, noticeSelf, postNew, stopExpiry, unlessGone, updateSelf } from "../../ui/delivery.ts";
import { post } from "../../ui/frame.ts";
import { DO_PREFIX, EDIT_PREFIX, GOTO_PREFIX, PAGE_INPUT, PAGE_PREFIX, PICK_PREFIX, actionOf, gotoOf, pageModal, pageOf, pageOfEntry, pagesOf, pickOf, queueInfoOf, typedPage, type Mode } from "../../ui/queue-view.ts";
import * as controls from "../../usecases/controls.ts";
import { queueScreen } from "../commands/queue.ts";
import { route, type Route } from "./route.ts";
import { privateText, publicText } from "../../ui/language.ts";

const log = logger.child({ category: "events" });

/** 화면이 달린 메시지에서 온 상호작용 */
type Surface = ButtonInteraction<"cached"> | StringSelectMenuInteraction<"cached"> | ModalMessageModalSubmitInteraction<"cached">;

// 메시지마다 마지막으로 받은 차례. 늦게 끝난 앞 차례는 화면을 고치지 않는다
const latest = new Map<string, number>();
let lastTurn = 0;
function turnOf(messageId: string) {
  const mine = ++lastTurn;
  latest.set(messageId, mine);
  return {
    current: () => latest.get(messageId) === mine,
    end: () => {
      if (latest.get(messageId) === mine) latest.delete(messageId);
    },
  };
}

/** 이 화면을 고칠 플레이어. 없거나 대기열이 비었으면 화면을 삭제하고 알린다. 업데이트 전에 보낸 임베드 화면은 Components V2로 고칠 수 없어 모른다고 한다 */
async function playerFor(interaction: Surface, { players }: BotContext): Promise<Player | null> {
  const player = players.get(interaction.guild.id);
  if (!player || player.queue.length === 0) {
    await noticeInstead(interaction, player ? privateText(interaction).errors.notice("queue-empty") : privateText(interaction).errors.notice("no-song"));
    return null;
  }
  if (!interaction.message.flags.has(MessageFlags.IsComponentsV2)) {
    await noticeSelf(interaction, privateText(interaction).errors.notice("unknown-interaction"));
    return null;
  }
  return player;
}

/** 지난 재생의 화면이면 알리고 true(같은 대기열 ID가 다른 곡일 수 있다) */
async function staleSession(interaction: Surface, player: Player, session: string) {
  if (!player.sessionId || session === player.sessionId) return false;
  await noticeSelf(interaction, privateText(interaction).errors.notice("stale-session"));
  return true;
}

/** 편집 화면으로 바로 고친다(붙어 있던 모자이크를 뗀다). picked는 고른 채로 둘 곡, without은 뺄 곡 */
async function showEdit(interaction: Surface, player: Player, page: number, { picked = null, without = null }: { picked?: number | null; without?: number | null } = {}) {
  turnOf(interaction.message.id).end();
  const { view } = await queueScreen(privateText(interaction), player, interaction.member, { mode: "edit", page, picked }, { without });
  await updateSelf(interaction, { ...post(view), attachments: [] }, LIFETIME.screen);
}

/** 보기 화면으로 고친다. 썸네일을 기다리느라 미룬 뒤 고치고, 그사이 같은 메시지를 다른 것이 고쳤으면 그만둔다 */
async function showBrowse(interaction: Surface, player: Player, page: number) {
  const turn = turnOf(interaction.message.id);
  await interaction.deferUpdate();
  const { view, files } = await queueScreen(privateText(interaction), player, interaction.member, { mode: "browse", page });
  if (!turn.current()) return;
  turn.end();
  await interaction.editReply({ ...post(view, files), attachments: [] });
  keepSelf(interaction, LIFETIME.screen);
}

const show = (interaction: Surface, player: Player, mode: Mode, page: number) => (mode === "browse" ? showBrowse(interaction, player, page) : showEdit(interaction, player, page));

// 넘기기(보기 화면), 완료(편집에서 보기로)
async function handlePage(interaction: ButtonInteraction<"cached">, bot: BotContext) {
  const player = await playerFor(interaction, bot);
  if (player) await showBrowse(interaction, player, pageOf(interaction.customId) ?? 1);
}

// 편집 버튼(보기에서 편집으로), 넘기기(편집 화면)
async function handleEdit(interaction: ButtonInteraction<"cached">, bot: BotContext) {
  const player = await playerFor(interaction, bot);
  if (player) await showEdit(interaction, player, pageOf(interaction.customId) ?? 1);
}

// 곡 고르기. 고른 곡이 다른 페이지로 옮겨졌으면 그 페이지를 그린다
async function handlePick(interaction: StringSelectMenuInteraction<"cached">, bot: BotContext) {
  const player = await playerFor(interaction, bot);
  const pick = pickOf(interaction.customId);
  if (!player || !pick || (await staleSession(interaction, player, pick.session))) return;
  const entry = entryOfJump(interaction.values[0]);
  const page = entry === null ? null : pageOfEntry(queueInfoOf(player), entry);
  await showEdit(interaction, player, page ?? pick.page, { picked: page === null ? null : entry });
}

/**
 * 곡 버튼 하나를 한다. 결과(모두에게 알릴 화면, 그 뒤 고른 채로 둘 곡, 화면에서 뺄 곡) 또는 거절. 옮길 자리가 아니면 stay.
 * 지금 재생은 그 곡을 대기열 맨 앞에 두고 지금 곡을 멈춘다. 곡 끝 처리가 꺼내기 전까지 맨 앞에 남아 있어 화면에서 뺀다
 */
async function act(player: Player, interaction: ButtonInteraction<"cached">, action: EditAction, entry: number) {
  const actor = { member: interaction.member };
  if (action === "play") {
    const r = await controls.jump(player, actor, entry);
    return r.ok ? { notice: replies.jumped(publicText(interaction.guildId), r.track), keep: null, without: entry } : r;
  }
  if (action === "remove") {
    const r = await controls.removeEntries(player, actor, [entry]);
    return r.ok ? { notice: replies.removed(publicText(interaction.guildId), r.removed.length, r.left, interaction.member), keep: null, without: null } : r;
  }
  const plan = movePlan(
    player.queue.flatMap((track) => (track.entry === undefined ? [] : [track.entry])),
    entry,
    action,
  );
  if (plan === "stay") return "stay" as const;
  if (plan === "gone") return { ok: false as const, code: "entry-gone" as const };
  const r = await controls.moveEntry(player, actor, entry, plan.before);
  // 사람은 1부터 센다
  return r.ok ? { notice: replies.moved(publicText(interaction.guildId), r.track, r.from + 1, r.to + 1, interaction.member), keep: entry, without: null } : r;
}

// 곡 버튼. 끝나면 고친 곡이 있는 페이지를 그 곡을 고른 채로(지금 재생, 삭제는 고르지 않은 채로) 그리고, 결과를 모두에게 알린다.
// 남은 곡이 없으면 화면을 삭제하고 결과만 알린다. 그 곡이 이미 빠졌으면 화면을 다시 그리고 본인에게 알린다
async function handleAction(interaction: ButtonInteraction<"cached">, bot: BotContext) {
  const player = await playerFor(interaction, bot);
  const parsed = actionOf(interaction.customId);
  if (!player || !parsed || (await staleSession(interaction, player, parsed.session))) return;
  if (!isEditAction(parsed.action)) return noticeSelf(interaction, privateText(interaction).errors.notice("unknown-interaction"));
  const pageOfNow = (entry: number) => pageOfEntry(queueInfoOf(player), entry) ?? parsed.page;
  const result = await act(player, interaction, parsed.action, parsed.entry);
  if (result === "stay") return showEdit(interaction, player, pageOfNow(parsed.entry), { picked: parsed.entry });
  if ("ok" in result) {
    if (result.code !== "entry-gone") return noticeSelf(interaction, controlMessage(privateText(interaction), result));
    await showEdit(interaction, player, parsed.page);
    return noticeSelf(interaction, privateText(interaction).errors.notice("entry-gone"));
  }
  if (queueInfoOf(player, { without: result.without }).queue.length === 0) {
    stopExpiry(interaction.message.id);
    await interaction.deferUpdate();
    await interaction.deleteReply().catch(unlessGone(log, "빈 대기열 화면 삭제"));
  } else {
    await showEdit(interaction, player, result.keep === null ? parsed.page : pageOfNow(result.keep), { picked: result.keep, without: result.without });
  }
  await postNew(interaction, result.notice, LIFETIME.result);
}

// 페이지 버튼: 페이지 이동 모달을 연다
async function handleGotoButton(interaction: ButtonInteraction<"cached">, bot: BotContext) {
  const player = await playerFor(interaction, bot);
  const goto = gotoOf(interaction.customId);
  if (!player) return;
  if (!goto) return noticeSelf(interaction, privateText(interaction).errors.notice("unknown-interaction"));
  await interaction.showModal(pageModal(privateText(interaction), goto.mode, goto.page, pagesOf(queueInfoOf(player))));
}

// 페이지 이동 모달. 적은 페이지는 범위 안으로 붙이고, 숫자가 아니면 보던 페이지를 다시 그린다
async function handleGotoModal(interaction: ModalSubmitInteraction<"cached">, bot: BotContext) {
  if (!interaction.isFromMessage()) return;
  const player = await playerFor(interaction, bot);
  const goto = gotoOf(interaction.customId);
  if (!player) return;
  if (!goto) return noticeSelf(interaction, privateText(interaction).errors.notice("unknown-interaction"));
  const typed = typedPage(interaction.fields.getTextInputValue(PAGE_INPUT));
  await show(interaction, player, goto.mode, typed ?? goto.page);
}

const routes: Route[] = [route("button", PAGE_PREFIX, handlePage), route("button", EDIT_PREFIX, handleEdit), route("select", PICK_PREFIX, handlePick), route("button", DO_PREFIX, handleAction), route("button", GOTO_PREFIX, handleGotoButton), route("modal", GOTO_PREFIX, handleGotoModal)];

export { routes };
