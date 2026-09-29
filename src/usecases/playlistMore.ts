// 재생목록 "더 넣기". 이어 받을 위치(상태), 선택지, 디스코드 메뉴, 메시지 수명.
// 상태는 메뉴의 custom_id에만 둔다(메모리 없음). 재시작해도 메뉴가 산다. 만료는 누를 때 메시지 나이로 다시 본다.

import { ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from "discord.js";
import * as links from "../rules/links.ts";
import { SET_BATCH as SOUNDCLOUD_BATCH } from "../sources/soundcloud/index.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import config from "../../config.ts";
import * as trackState from "../player/trackState.ts";
import * as labels from "../ui/text/labels.ts";
import { markTransient } from "../ui/transientMessages.ts";
import { canSend } from "../ui/channels.ts";
import { messageOf } from "../rules/errorKind.ts";
import type { RepliableInteraction, TextBasedChannel } from "discord.js";
import type { Player } from "../player/Player.ts";

const LIFETIME_MS = 30_000;
// 이어 받을 때 앞으로 더 받아 직전 마지막 곡(앵커)을 찾는 폭. 그 사이 목록이 이만큼 편집돼도 이어진다
const LOOKBACK = 5;
const MAX_COUNT = 10_000;
const SELECT_PREFIX = "plm";
const MODAL_PREFIX = "plmm";

const TRACK_ID = /^[A-Za-z0-9_-]{11,22}$/;
const NUMERIC_ID = /^\d{1,20}$/;

// 이어 받을 수 있는 출처. 믹스(RD…)는 부를 때마다 결과가 달라 빠진다. 인기곡은 10곡뿐이라 이어 받을 게 없다.
// anchor: 곡 id 모양 · perClick: 한 번에 넣는 곡 수 상한 · lookback: 앵커를 찾으려고 앞에서부터 다시 받는 곡 수 · reads: 한 번에 부르는 구간 수 상한
type Kind = "ytp" | "spp" | "spa" | "scs" | "scd";
type KindSpec = { id: RegExp; url: (id: string) => string; collection: string; anchor: RegExp; perClick: number; lookback: number; reads: number };
const KINDS: Record<Kind, KindSpec> = {
  ytp: { id: /^[A-Za-z0-9_-]{10,64}$/, url: (id) => `https://www.youtube.com/playlist?list=${id}`, collection: "playlist", anchor: TRACK_ID, perClick: Infinity, lookback: LOOKBACK, reads: Infinity },
  spp: { id: /^[A-Za-z0-9]{22}$/, url: (id) => `https://open.spotify.com/playlist/${id}`, collection: "playlist", anchor: TRACK_ID, perClick: Infinity, lookback: LOOKBACK, reads: Infinity },
  spa: { id: /^[A-Za-z0-9]{22}$/, url: (id) => `https://open.spotify.com/album/${id}`, collection: "album", anchor: TRACK_ID, perClick: Infinity, lookback: LOOKBACK, reads: Infinity },
  // 사운드클라우드 세트. 주소 대신 숫자 id 로 부른다. 곡마다 요청이 들어(요청이 몰리면 IP 가 막힌다) 한 번에 한 구간만:
  // 앞을 다시 받지 않고, 틀 수 있는 곡이 모자라도 더 읽지 않는다(받을 수 없는 곡이 많은 세트에서 요청이 불어나지 않게)
  scs: { id: NUMERIC_ID, url: (id) => `https://api.soundcloud.com/playlists/${id}`, collection: "playlist", anchor: NUMERIC_ID, perClick: SOUNDCLOUD_BATCH, lookback: 0, reads: 1 },
  // 사운드클라우드가 만든 믹스(discover/sets/trending-by-genre:indie 등). 숫자 id 가 없어 주소의 이름으로 부른다.
  // 이름의 ":"는 custom_id 의 칸 가름과 겹쳐 "~"로 싣는다
  scd: { id: /^[\w~-]{1,60}$/, url: (id) => `https://soundcloud.com/discover/sets/${id.replaceAll("~", ":")}`, collection: "playlist", anchor: NUMERIC_ID, perClick: SOUNDCLOUD_BATCH, lookback: 0, reads: 1 },
};
const isKind = (kind: unknown): kind is Kind => typeof kind === "string" && Object.hasOwn(KINDS, kind);

/** 이어 받을 위치. 메뉴의 custom_id 에 싣는다 */
type MoreState = { kind: Kind; listId: string; offset: number; anchorId: string; insertFirst: boolean; requesterId: string | null };
/** 띄울 메뉴. 위치에 전체 · 남은 곡 수와 한 번에 넣는 묶음(batch)을 더한다 */
type More = MoreState & { total: number; remaining: number; batch?: number };
/** 검사 전의 위치(custom_id · 요청 본문에서 온 것) */
type RawState = { kind?: unknown; listId?: unknown; offset?: unknown; anchorId?: unknown; insertFirst?: unknown; requesterId?: unknown };
/** 이어 넣은 결과. 메뉴를 다시 띄울 때 읽는 칸 */
type MoreResult = { added: number; dropped?: number; skipped?: number; total: number | null; remaining: number; next: More | null };
const USER_ID = /^\d{17,20}$/;

const fmt = (n: number | null) => Number(n).toLocaleString("ko-KR");

// collectionId: 곡 찾기가 알려 준 목록 id(주소만으로는 모르는 출처)
function sourceOf(query: string, collectionId?: string | null): { kind: Kind; listId: string } | null {
  const soundcloud = links.parseSoundCloudURL(query);
  if (soundcloud === "set" || soundcloud === "short") {
    if (collectionId && NUMERIC_ID.test(collectionId)) return { kind: "scs", listId: collectionId };
    const mix = /^\/discover\/sets\/([\w:-]+)\/?$/.exec(new URL(query).pathname);
    return mix ? { kind: "scd", listId: mix[1].replaceAll(":", "~") } : null;
  }
  if (links.isYouTubePlaylist(query)) {
    const listId = links.extractPlaylistId(query);
    return listId && !listId.startsWith("RD") ? { kind: "ytp", listId } : null;
  }
  if (links.isSpotifyURL(query)) {
    const { type, id } = links.parseSpotifyURL(query);
    if (!id) return null;
    if (type === "playlist") return { kind: "spp", listId: id };
    if (type === "album") return { kind: "spa", listId: id };
  }
  return null;
}

function validState(s: RawState | null | undefined): MoreState | null {
  if (!s || !isKind(s.kind) || !KINDS[s.kind].id.test(String(s.listId))) return null;
  const offset = Number(s.offset);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) return null;
  if (!KINDS[s.kind].anchor.test(String(s.anchorId))) return null;
  if (s.requesterId != null && !USER_ID.test(String(s.requesterId))) return null;
  return { kind: s.kind, listId: String(s.listId), offset, anchorId: String(s.anchorId), insertFirst: s.insertFirst === true, requesterId: s.requesterId == null ? null : String(s.requesterId) };
}

// 방금 넣은 목록을 이어 받을 수 있으면 그 상태. 총 곡 수를 모르거나(믹스) 끝까지 넣었으면 null.
// 곡 찾기 결과에서 읽는 칸
type Found = { isPlaylist?: boolean; collectionId?: string | null; total?: number | null; nextOffset?: number | null; tracks?: Array<{ id?: string }> };

function continuation(query: string | null | undefined, trackData: Found | null | undefined, { insertFirst = false } = {}): More | null {
  if (!query || !trackData?.isPlaylist || trackData.total == null || trackData.nextOffset == null) return null;
  const source = sourceOf(query, trackData.collectionId);
  if (!source) return null;
  const remaining = trackData.total - trackData.nextOffset;
  const state = validState({ ...source, offset: trackData.nextOffset, anchorId: trackData.tracks?.at(-1)?.id, insertFirst });
  return state && remaining > 0 ? { ...state, total: trackData.total, remaining } : null;
}

function encodeState(prefix: string, s: MoreState) {
  return [prefix, s.kind, s.listId, s.offset, s.anchorId, s.insertFirst ? "f" : "b", ...(s.requesterId ? [s.requesterId] : [])].join(":");
}

function decodeState(customId: unknown) {
  const [prefix, kind, listId, offset, anchorId, place, requesterId] = String(customId).split(":");
  if (![SELECT_PREFIX, MODAL_PREFIX].includes(prefix) || !["f", "b"].includes(place)) return null;
  return validState({ kind, listId, offset, anchorId, insertFirst: place === "f", requesterId: requesterId ?? null });
}

// 대기열에 더 넣을 수 있는 곡 수. 비어 있으면 첫 곡은 현재곡이 되니 한 자리 더
function roomFor(player: Pick<Player, "queue" | "currentTrack">) {
  return trackState.roomLeft(player, config.bot.maxQueueSize) + (player.currentTrack ? 0 : 1);
}

/** 이 링크의 한 번에 넣는 곡 수. 서버 설정(batch)을 출처의 상한으로 자른다(사운드클라우드 세트는 10곡) */
function batchFor(query: string | null | undefined, batch: number) {
  const soundcloud = query ? links.parseSoundCloudURL(query) : null;
  return soundcloud === "set" || soundcloud === "short" ? Math.min(batch, SOUNDCLOUD_BATCH) : batch;
}

// 선택지. 한 번에 넣는 묶음 단위로, 남은 곡 · 남은 자리 · 출처의 한 번 상한(perClick) 중 가장 작은 쪽(cap)을 넘지 않게
function moreChoices({ remaining, room, batch, perClick = Infinity }: { remaining: number; room: number; batch: number; perClick?: number }) {
  const cap = Math.max(0, Math.min(remaining, room, perClick));
  return { cap, steps: cap > 0 ? [batch, batch * 2].filter((n) => n < cap) : [] };
}

// 누른 사람·메시지 나이 확인. 문제가 있으면 안내 문구
function clickError(state: MoreState, { userId, lastTouched, now = Date.now() }: { userId: string; lastTouched: number; now?: number }) {
  if (state.requesterId && state.requesterId !== userId) return "목록을 넣은 사람만 더 넣을 수 있어요.";
  if (now - lastTouched > LIFETIME_MS) return "시간이 지나 닫힌 메뉴예요. 링크를 다시 넣어 주세요.";
  return null;
}

function parseCount(raw: unknown) {
  const text = String(raw ?? "").trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= MAX_COUNT ? n : null;
}

function menuMessage(head: string, state: MoreState, { remaining, room, batch = config.bot.playlistAddDefault }: { remaining: number; room: number; batch?: number }) {
  const { perClick } = KINDS[state.kind];
  const { cap, steps } = moreChoices({ remaining, room, batch, perClick });
  if (cap === 0) return { content: `${head}\n대기열이 가득 차 지금은 더 넣을 수 없어요.`, components: [] };
  // 모달 ID가 한 글자 더 길다. 둘 다 100자 안이어야 한다
  if (encodeState(MODAL_PREFIX, state).length > 100) return { content: head, components: [] };

  const menu = new StringSelectMenuBuilder()
    .setCustomId(encodeState(SELECT_PREFIX, state))
    .setPlaceholder(`더 넣기 (남은 ${fmt(remaining)}곡)`)
    .addOptions(...steps.map((n) => ({ label: `${fmt(n)}곡 더`, value: String(n) })), { label: capLabel(cap, remaining, perClick), value: String(cap) }, { label: "직접 입력…", value: "custom" }, { label: "그만 넣기", value: "stop" });
  return { content: head, components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
}

// 가장 큰 선택지의 이름. 출처의 한 번 상한에 걸렸으면 "N곡 더"(더 넣을 수는 있다)
function capLabel(cap: number, remaining: number, perClick: number) {
  if (cap >= remaining) return `남은 곡 전부 (${fmt(cap)}곡)`;
  return cap === perClick ? `${fmt(cap)}곡 더` : `넣을 수 있는 만큼 (${fmt(cap)}곡)`;
}

function offerMessage(more: More, room: number) {
  const label = labels.collection(KINDS[more.kind].collection);
  return menuMessage(`📃 ${label}은 전체 ${fmt(more.total)}곡이에요. 앞 ${fmt(more.offset)}곡까지 넣었어요.`, more, { remaining: more.remaining, room, batch: more.batch });
}

function resultMessage(state: MoreState, result: MoreResult, room: number) {
  const label = labels.collection(KINDS[state.kind].collection);
  let head = `✅ ${label}에서 ${fmt(result.added)}곡을 더 넣었어요.`;
  if (result.skipped && result.skipped > 0) head += ` 받을 수 없는 ${fmt(result.skipped)}곡(미리듣기 · 지역 제한 등)은 뺐어요.`;
  if (result.dropped && result.dropped > 0) head += ` 대기열이 가득 차 ${fmt(result.dropped)}곡은 빠졌어요.`;
  if (!result.next) return { content: result.remaining > 0 ? head : `${head} 목록을 끝까지 넣었어요.`, components: [] };
  return menuMessage(`${head} (전체 ${fmt(result.total)}곡 중 ${fmt(result.next.offset)}곡까지)`, result.next, { remaining: result.remaining, room, batch: result.next.batch });
}

function countModal(state: MoreState, cap: number, batch = config.bot.playlistAddDefault) {
  const max = Math.min(cap, MAX_COUNT, KINDS[state.kind].perClick);
  const input = new TextInputBuilder()
    .setCustomId("count")
    .setLabel(`넣을 곡 수 (1~${fmt(max)})`)
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(5)
    .setPlaceholder(String(Math.min(max, batch)))
    .setRequired(true);
  return new ModalBuilder().setCustomId(encodeState(MODAL_PREFIX, state)).setTitle("더 넣기").addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

// ── 메시지 수명. 이어 넣으면 다시 센다 ──

const expiries = new Map<string, NodeJS.Timeout>(); // messageId → timer

function clearExpiry(messageId: string) {
  clearTimeout(expiries.get(messageId));
  expiries.delete(messageId);
}

function expireLater(messageId: string, remove: () => unknown, ms = LIFETIME_MS) {
  clearExpiry(messageId);
  markTransient(messageId, ms); // 조작하는 동안 현재 재생 메시지가 이 밑으로 내려오지 않게
  const timer = setTimeout(() => {
    expiries.delete(messageId);
    Promise.resolve()
      .then(remove)
      .catch(() => {
        /* 이미 지워졌거나 지울 권한이 없다 */
      });
  }, ms);
  timer.unref?.();
  expiries.set(messageId, timer);
}

// 슬래시 명령. 일반 채널 메시지로 띄운다. 상호작용 후속 메시지는 디스코드가 원래 응답에 답장 모양으로 붙이는데,
// 그 응답이 지워지면 "메시지를 불러올 수 없어요"에 매달린다. 채널에 쓸 권한이 없을 때만 본인 전용 후속 메시지로.
async function offerOnInteraction(interaction: RepliableInteraction, more: More, player: Player) {
  if (await offerOnChannel(interaction.channel, more, player, interaction.user.id, { quiet: true })) return;
  const payload = offerMessage(more, roomFor(player));
  if (payload.components.length === 0) return;
  try {
    const message = await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    expireLater(message.id, () => interaction.deleteReply(message.id));
  } catch (error) {
    log.warn(`더 넣기 메뉴 전송 실패: ${messageOf(error)}`);
  }
}

// 공개 메시지. 누를 수 있는 사람은 custom_id의 요청자로 가른다. 띄웠거나 띄울 것이 없으면 true.
async function offerOnChannel(channel: TextBasedChannel | null | undefined, more: More, player: Player, requesterId: string, { quiet = false } = {}) {
  const payload = offerMessage({ ...more, requesterId }, roomFor(player));
  if (payload.components.length === 0) return true;
  if (!canSend(channel)) return false;
  try {
    const message = await channel.send(payload);
    expireLater(message.id, () => message.delete());
    return true;
  } catch (error) {
    if (!quiet) log.warn(`더 넣기 메뉴 전송 실패: ${messageOf(error)}`);
    return false;
  }
}

export { LIFETIME_MS, LOOKBACK, MAX_COUNT, batchFor, SELECT_PREFIX, MODAL_PREFIX, KINDS, continuation, validState, encodeState, decodeState, roomFor, moreChoices, clickError, parseCount, offerMessage, resultMessage, countModal, expireLater, clearExpiry, offerOnInteraction, offerOnChannel };
export type { Kind, MoreState, More, MoreResult };
