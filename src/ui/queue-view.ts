// 대기열 화면(Components V2). /queue와 재생 패널의 대기열 버튼이 같은 화면을 쓴다. 다음 곡들만 보인다(지금 곡은 재생 패널이 보인다).
// 보기: 제목, 그 페이지 곡들의 썸네일 모자이크(첨부, 그리지 못했으면 없다), 곡마다 두 줄, 구분선, 요약 줄, 넘기기 줄([◀] [페이지/페이지 수] [▶] [편집]).
// 편집: 같은 목록(이미지 없음), 곡 고르기 메뉴, 고른 곡의 버튼 줄(지금 재생, 다음에 재생, 위로, 아래로, 삭제), 넘기기 줄([◀] [페이지] [▶] [완료]).
// 버튼, 메뉴는 누른 때의 대기열로 다시 그린다. 곡은 대기열 ID로 가리키고, 고르기와 곡 버튼에는 세션을 실어 지난 재생의 화면을 가린다.
// 본인에게만 보이는 화면이라 보는 사람의 역할로 버튼을 고른다: DJ 는 모든 곡의 모든 버튼, 아니면 자기가 넣은 곡의 삭제만(편집할 곡이 없으면 편집 버튼도 없다).
// 음성 채널은 들어오면 바로 풀리는 조건이라 버튼을 숨기지 않고 누를 때 거절한다(usecases/controls)

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, type MessageActionRowComponentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, ModalBuilder, SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle, resolveColor } from "discord.js";
import { blockedAt, type EditAction } from "../rules/queue-edit.ts";
import { queueTiming, type QueueTiming } from "../rules/queue-timing.ts";
import type { Loop } from "../rules/loop-cycle.ts";
import type { QueuedTrack } from "../player/track.ts";
import { colorOf } from "./colors.ts";
import { IDLE_SESSION, QUEUE, customId, partsOf } from "./custom-ids.ts";
import type { Attachment } from "./frame.ts";
import { buttonEmoji, type IconKey } from "./icons.ts";
import { editDescription, entryLines, entryOptions, type Listed } from "./queue-display.ts";
import * as T from "./text/ko/queue.ts";

/** 한 페이지에 보이는 곡 수 */
const PAGE_SIZE = 10;
/** 화면 글(텍스트 디스플레이) 전체의 상한은 4000자(메뉴 항목의 글은 세지 않는다). 목록 말고 제목, 요약 줄이 쓸 몫을 남긴다 */
const LIST_MAX = 3600;
/**
 * 부품 전체(JSON)의 크기 상한. 디스코드는 10,240바이트를 넘으면 메시지째 거절한다(413). 디스코드가 세는 값은 JSON 바이트보다 작아 JSON 으로 이 값 안이면 받는다.
 * 한글은 3바이트라 긴 한글 제목, 아티스트 열 곡에 메뉴까지 달면 글자 수로는 상한 안이어도 넘친다. 넘으면 메뉴 항목의 글부터, 그다음 목록 상한을(긴 주소의 링크부터 뗀다) 줄여 다시 만든다
 */
const BYTES_MAX = 10_000;
/** 줄여 가는 차례: 목록 글 상한, 메뉴 항목 이름과 설명의 상한 */
const SHRINK = [
  [LIST_MAX, 100],
  [LIST_MAX, 60],
  [LIST_MAX, 40],
  [2800, 40],
  [2000, 30],
  [1400, 30],
] as const;
const MOSAIC_FILE = "queue.webp";

// custom_id. 뒤에 붙는 것: 보기, 편집은 페이지. 고르기는 페이지와 세션, 곡 버튼은 동작, 대기열 ID, 페이지, 세션. 페이지 이동(버튼, 모달)은 화면(browse, edit)과 보던 페이지
const PAGE_PREFIX = customId(QUEUE, "page", "");
const EDIT_PREFIX = customId(QUEUE, "edit", "");
const PICK_PREFIX = customId(QUEUE, "pick", "");
const DO_PREFIX = customId(QUEUE, "do", "");
const GOTO_PREFIX = customId(QUEUE, "goto", "");
/** 페이지 이동 모달의 입력란 */
const PAGE_INPUT = "page";

type Mode = "browse" | "edit";
type Entry = Listed & Pick<QueuedTrack, "thumbnail" | "audioUrl" | "entry">;
/** 보는 사람: 사용자 ID, DJ 인지(usecases/permissions 의 isDj) */
type Viewer = { id: string | null; dj: boolean };
/** 보는 사람을 모를 때. 편집할 수 있는 곡이 없다 */
const NOBODY: Viewer = { id: null, dj: false };
/** 대기열 화면이 보는 것: 다음 곡들, 지금 재생(시작까지의 시간을 셈한다), 세션, 보는 사람 */
type QueueInfo = {
  queue: Entry[];
  now: { track: { duration: number; isLive?: boolean } | null; positionSec: number; paused: boolean; loop: Loop; autoplay: boolean };
  sessionId: string | null;
  viewer: Viewer;
};
/** 그릴 화면. browse 의 mosaic 은 그 페이지의 썸네일(WebP), edit 의 picked 는 고른 곡의 대기열 ID */
type Screen = { mode: "browse"; page: number; mosaic?: Buffer | null } | { mode: "edit"; page: number; picked?: number | null };

type PlayerLike = {
  queue: Entry[];
  currentTrack: { duration: number } | null;
  isLive: boolean;
  paused: boolean;
  loop: Loop;
  autoplay: string | false;
  sessionId?: string | null;
  getCurrentTime(): number;
};

/**
 * 플레이어에서 대기열 화면이 보는 것만. 대기열은 그때의 사본(썸네일을 기다리는 사이 바뀌어도 목록과 이미지가 같은 곡들이다).
 * without: 뺄 곡의 대기열 ID(지금 재생으로 넘어가는 곡. 곡 끝 처리가 꺼내기 전까지 대기열 맨 앞에 있다), viewer: 보는 사람
 */
function queueInfoOf(player: PlayerLike, { without = null, viewer = NOBODY }: { without?: number | null; viewer?: Viewer } = {}): QueueInfo {
  const track = player.currentTrack ? { duration: player.currentTrack.duration, isLive: player.isLive } : null;
  return {
    queue: player.queue.filter((one) => without === null || one.entry !== without),
    now: { track, positionSec: player.getCurrentTime() / 1000, paused: player.paused, loop: player.loop, autoplay: Boolean(player.autoplay) },
    sessionId: player.sessionId ?? null,
    viewer,
  };
}

/** 보는 사람이 이 곡을 편집할 수 있나: DJ 거나 자기가 넣은 곡 */
const canEdit = (viewer: Viewer, track: Pick<Entry, "requestedBy">) => viewer.dj || (viewer.id !== null && track.requestedBy?.id === viewer.id);

/** 이 대기열의 페이지 수(적어도 1) */
const pagesOf = (info: Pick<QueueInfo, "queue">) => Math.max(1, Math.ceil(info.queue.length / PAGE_SIZE));
/** 보일 페이지: 1 부터, 범위를 넘으면 끝 페이지로 붙인다 */
const pageIn = (info: Pick<QueueInfo, "queue">, page: number) => Math.min(Math.max(1, Math.floor(page) || 1), pagesOf(info));
/** 그 페이지의 곡들과 첫 곡의 자리(0 부터) */
function pageTracks(info: Pick<QueueInfo, "queue">, page: number) {
  const offset = (pageIn(info, page) - 1) * PAGE_SIZE;
  return { offset, tracks: info.queue.slice(offset, offset + PAGE_SIZE) };
}
/** 대기열 ID의 곡이 있는 페이지. 없으면 null */
function pageOfEntry(info: Pick<QueueInfo, "queue">, entry: number) {
  const index = info.queue.findIndex((track) => track.entry === entry);
  return index < 0 ? null : Math.floor(index / PAGE_SIZE) + 1;
}

const button = (id: string, { label, emoji, style = ButtonStyle.Secondary, disabled = false }: { label?: string; emoji?: IconKey; style?: ButtonStyle; disabled?: boolean }) => {
  const one = new ButtonBuilder().setCustomId(id).setStyle(style).setDisabled(disabled);
  if (label) one.setLabel(label);
  if (emoji) one.setEmoji(buttonEmoji(emoji));
  return one;
};

/** 넘기기 줄. 페이지가 하나면 last 만(last 도 없으면 줄이 없다) */
function navRow(mode: Mode, page: number, pages: number, last: ButtonBuilder | null) {
  const to = (n: number) => customId(QUEUE, mode === "browse" ? "page" : "edit", n);
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (pages > 1) {
    row.addComponents(button(to(page - 1), { emoji: "page_prev", disabled: page === 1 }), button(customId(QUEUE, "goto", mode, page), { label: T.pageOf(page, pages) }), button(to(page + 1), { emoji: "page_next", disabled: page === pages }));
  }
  if (last) row.addComponents(last);
  return row.components.length ? row : null;
}

const ACTION_LOOK: Record<EditAction, { emoji: IconKey; style: ButtonStyle }> = {
  play: { emoji: "play_now", style: ButtonStyle.Primary },
  next: { emoji: "next", style: ButtonStyle.Secondary },
  up: { emoji: "move_up", style: ButtonStyle.Secondary },
  down: { emoji: "move_down", style: ButtonStyle.Secondary },
  remove: { emoji: "remove", style: ButtonStyle.Danger },
};

/** 화면의 컨테이너와 첨부 파일, 실제로 그린 페이지. 부품 크기가 상한을 넘으면 목록을 줄여 다시 만든다 */
function queueView(info: QueueInfo, screen: Screen, nowMs = Date.now()): { view: ContainerBuilder; files: Attachment[]; page: number } {
  let built = compose(info, screen, nowMs, SHRINK[0]);
  for (const step of SHRINK.slice(1)) {
    if (Buffer.byteLength(JSON.stringify(built.view.toJSON())) <= BYTES_MAX) break;
    built = compose(info, screen, nowMs, step);
  }
  return built;
}

function compose(info: QueueInfo, screen: Screen, nowMs: number, [listMax, optionMax]: (typeof SHRINK)[number]) {
  const pages = pagesOf(info);
  const page = pageIn(info, screen.page);
  const { offset, tracks } = pageTracks(info, page);
  const timing: QueueTiming = queueTiming(info.now, info.queue, nowMs);
  const box = new ContainerBuilder().setAccentColor(resolveColor(colorOf("brand")));
  const files: Attachment[] = [];

  box.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${screen.mode === "browse" ? T.title() : T.editTitle()}`));
  if (screen.mode === "browse" && screen.mosaic) {
    files.push({ attachment: screen.mosaic, name: MOSAIC_FILE });
    box.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${MOSAIC_FILE}`).setDescription(T.mosaicAlt)));
  }
  box.addTextDisplayComponents(new TextDisplayBuilder().setContent(entryLines({ tracks, first: offset + 1, startsIn: timing.startsIn.slice(offset, offset + PAGE_SIZE), max: listMax })));
  box.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const endsAt = timing.endsAtMs === null ? null : Math.round(timing.endsAtMs / 1000);
  box.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${T.summary({ count: info.queue.length, totalSec: timing.totalSec, endsAt })}`));

  const rows = screen.mode === "browse" ? browseRows(info, page, pages) : editRows(info, { page, pages, offset, tracks, picked: screen.picked ?? null, optionMax });
  for (const row of rows) box.addActionRowComponents(row);
  return { view: box, files, page };
}

/** 보기 화면의 줄: 넘기기 줄(편집할 곡이 있으면 끝에 편집) */
function browseRows(info: QueueInfo, page: number, pages: number) {
  const editable = info.queue.some((track) => canEdit(info.viewer, track));
  const nav = navRow("browse", page, pages, editable ? button(customId(QUEUE, "edit", page), { label: T.edit, emoji: "edit" }) : null);
  return nav ? [nav] : [];
}

type EditPage = { page: number; pages: number; offset: number; tracks: Entry[]; picked: number | null; optionMax: number };

/** 편집 화면의 줄: 곡 고르기 메뉴(편집할 수 있는 곡만), 고른 곡의 버튼 줄, 넘기기 줄(끝에 완료) */
function editRows(info: QueueInfo, { page, pages, offset, tracks, picked, optionMax }: EditPage) {
  const rows: Array<ActionRowBuilder<MessageActionRowComponentBuilder>> = [];
  const session = info.sessionId ?? IDLE_SESSION;
  const index = picked === null ? -1 : tracks.findIndex((track) => track.entry === picked);
  const pickable = index >= 0 && canEdit(info.viewer, tracks[index]);
  const options = entryOptions(tracks, { first: offset + 1, description: (track) => editDescription(track, optionMax), picked: pickable ? picked : null, max: optionMax, only: (track) => canEdit(info.viewer, track) });
  if (options.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId(QUEUE, "pick", page, session))
      .setPlaceholder(T.pickPlaceholder)
      .addOptions(options);
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  }
  if (pickable && picked !== null) {
    const blocked = blockedAt(offset + index, info.queue.length);
    const row = new ActionRowBuilder<ButtonBuilder>();
    // DJ 가 아니면 자기 곡의 삭제만(옮기기, 지금 재생은 DJ 의 조작이다)
    for (const action of (info.viewer.dj ? Object.keys(ACTION_LOOK) : ["remove"]) as EditAction[]) {
      row.addComponents(button(customId(QUEUE, "do", action, picked, page, session), { label: T.actions[action], ...ACTION_LOOK[action], disabled: blocked.has(action) }));
    }
    rows.push(row);
  }
  const nav = navRow("edit", page, pages, button(customId(QUEUE, "page", page), { label: T.done, emoji: "ok" }));
  if (nav) rows.push(nav);
  return rows;
}

/** 페이지 이동 모달. custom_id는 연 버튼과 같다(queue:goto:화면:보던 페이지) */
function pageModal(mode: Mode, page: number, pages: number) {
  const t = T.pageModal(pages);
  const input = new TextInputBuilder().setCustomId(PAGE_INPUT).setLabel(t.label).setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(String(pages).length).setPlaceholder(t.placeholder).setRequired(true);
  return new ModalBuilder()
    .setCustomId(customId(QUEUE, "goto", mode, page))
    .setTitle(t.title)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

const positive = (text: string | undefined) => {
  const n = Number(text);
  return /^\d+$/.test(text ?? "") && Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/** 보기, 편집 버튼이 보일 페이지(0 이면 앞쪽 끝이라 1로 붙인다). 알아볼 수 없으면 null */
function pageOf(id: string) {
  const { rest } = partsOf(id);
  return positive(rest[0]);
}

/** 고르기 메뉴의 페이지와 세션 */
function pickOf(id: string) {
  const { rest } = partsOf(id);
  const page = positive(rest[0]);
  return page === null || !rest[1] ? null : { page, session: rest[1] };
}

/** 곡 버튼의 동작, 대기열 ID, 페이지, 세션 */
function actionOf(id: string) {
  const { rest } = partsOf(id);
  const [action, entry, page] = [rest[0], positive(rest[1]), positive(rest[2])];
  return entry === null || page === null || !rest[3] ? null : { action, entry, page, session: rest[3] };
}

/** 페이지 이동의 화면과 보던 페이지 */
function gotoOf(id: string): { mode: Mode; page: number } | null {
  const { rest } = partsOf(id);
  const [mode, page] = [rest[0], positive(rest[1])];
  return (mode === "browse" || mode === "edit") && page !== null ? { mode, page } : null;
}

/** 모달에 적은 페이지. 숫자가 아니면 null */
const typedPage = (text: string) => positive(text.trim());

export { PAGE_SIZE, PAGE_PREFIX, EDIT_PREFIX, PICK_PREFIX, DO_PREFIX, GOTO_PREFIX, PAGE_INPUT, LIST_MAX, BYTES_MAX, MOSAIC_FILE, queueView, queueInfoOf, pagesOf, pageIn, pageTracks, pageOfEntry, pageModal, pageOf, pickOf, actionOf, gotoOf, typedPage };
export type { QueueInfo, Screen, Mode, Entry, Viewer };
