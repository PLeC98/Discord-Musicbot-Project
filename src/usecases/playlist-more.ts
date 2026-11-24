// 재생목록 "더 넣기". 이어 불러올 위치(상태), 선택지, 메시지 수명. 여기서는 메뉴와 결과의 모양(데이터)을 내고, 화면은 ui/playlist-more-menu가 그 독자의 언어로 그린다.
// 상태는 메뉴의 custom_id에만 둔다(메모리 없음). 재시작해도 메뉴가 그대로 동작한다. 만료는 누를 때 메시지 나이로 다시 본다.

import * as links from "../rules/links.ts";
import { SET_BATCH as SOUNDCLOUD_BATCH } from "../sources/soundcloud/index.ts";
import config from "../config/index.ts";
import { roomFor as roomWithin } from "../rules/queue-room.ts";
import { MAX_COUNT, moreChoices, type Kind, type MoreState, type More, type MoreOutcome } from "../rules/more-choices.ts";
import { markTransient } from "../ui/transient-messages.ts";
import { LIFETIME, expireMessage, stopExpiry } from "../ui/delivery.ts";
import type { CountSpec, MoreMenu, OfferSpec, ResultSpec } from "../ui/playlist-more-menu.ts";
import { PLAYLIST_ADD_DEFAULT } from "../rules/limits.ts";
import type { Player } from "../player/player.ts";
import type { Code } from "../rules/problems.ts";
import { isSnowflake } from "../rules/snowflake.ts";

// 메뉴가 열려 있는 시간(ui/delivery의 메뉴 수명). 마지막으로 누른 뒤 이만큼 지나면 닫힌 메뉴로 본다
const LIFETIME_MS = LIFETIME.menu;
// 이어 불러올 때 앞으로 더 불러와 직전 마지막 곡(앵커)을 찾는 폭. 그 사이 목록이 이만큼 편집돼도 이어진다
const LOOKBACK = 5;
const SELECT_PREFIX = "plm";
const MODAL_PREFIX = "plmm";

const TRACK_ID = /^[A-Za-z0-9_-]{11,22}$/;
const NUMERIC_ID = /^\d{1,20}$/;

// 이어 불러올 수 있는 출처(rules/more-choices의 Kind). 믹스(RD…)는 부를 때마다 결과가 달라 빠진다. 인기곡은 10곡뿐이라 이어 불러올 게 없다.
// anchor: 곡 id 모양, perClick: 한 번에 넣는 곡 수 상한, lookback: 앵커를 찾으려고 앞에서부터 다시 불러오는 곡 수, reads: 한 번에 부르는 구간 수 상한
type KindSpec = { id: RegExp; url: (id: string) => string; collection: string; anchor: RegExp; perClick: number; lookback: number; reads: number };
const KINDS: Record<Kind, KindSpec> = {
  ytp: { id: /^[A-Za-z0-9_-]{10,64}$/, url: (id) => `https://www.youtube.com/playlist?list=${id}`, collection: "playlist", anchor: TRACK_ID, perClick: Infinity, lookback: LOOKBACK, reads: Infinity },
  spp: { id: /^[A-Za-z0-9]{22}$/, url: (id) => `https://open.spotify.com/playlist/${id}`, collection: "playlist", anchor: TRACK_ID, perClick: Infinity, lookback: LOOKBACK, reads: Infinity },
  spa: { id: /^[A-Za-z0-9]{22}$/, url: (id) => `https://open.spotify.com/album/${id}`, collection: "album", anchor: TRACK_ID, perClick: Infinity, lookback: LOOKBACK, reads: Infinity },
  // 사운드클라우드 세트. 주소 대신 숫자 id로 부른다. 곡마다 요청이 들어(요청이 몰리면 IP가 막힌다) 한 번에 한 구간만:
  // 앞을 다시 불러오지 않고, 틀 수 있는 곡이 모자라도 더 읽지 않는다(받을 수 없는 곡이 많은 세트에서 요청이 불어나지 않게)
  scs: { id: NUMERIC_ID, url: (id) => `https://api.soundcloud.com/playlists/${id}`, collection: "playlist", anchor: NUMERIC_ID, perClick: SOUNDCLOUD_BATCH, lookback: 0, reads: 1 },
  // 사운드클라우드가 만든 믹스(discover/sets/trending-by-genre:indie 등). 숫자 id가 없어 주소의 이름으로 부른다.
  // 이름의 ":"는 custom_id의 필드 구분자와 겹쳐 "~"로 싣는다
  scd: { id: /^[\w~-]{1,60}$/, url: (id) => `https://soundcloud.com/discover/sets/${id.replaceAll("~", ":")}`, collection: "playlist", anchor: NUMERIC_ID, perClick: SOUNDCLOUD_BATCH, lookback: 0, reads: 1 },
};
const isKind = (kind: unknown): kind is Kind => typeof kind === "string" && Object.hasOwn(KINDS, kind);

/** 검사 전의 위치(custom_id, 요청 본문에서 온 것) */
type RawState = { kind?: unknown; listId?: unknown; offset?: unknown; anchorId?: unknown; insertFirst?: unknown; requesterId?: unknown };
/** 이어 넣은 결과. 메뉴를 다시 표시할 때 읽는 필드 */
type MoreResult = { added: number; dropped?: number; skipped?: number; total: number | null; remaining: number; next: More | null };

// collectionId: 곡 찾기가 알려 준 목록 id(주소만으로는 모르는 출처)
function sourceOf(query: string, collectionId?: string | null): { kind: Kind; listId: string } | null {
  const soundcloud = links.parseSoundCloud(query);
  if (soundcloud?.kind === "set" || soundcloud?.kind === "short") {
    if (collectionId && NUMERIC_ID.test(collectionId)) return { kind: "scs", listId: collectionId };
    return soundcloud.mix ? { kind: "scd", listId: soundcloud.mix.replaceAll(":", "~") } : null;
  }
  if (links.isYouTubePlaylist(query)) {
    const listId = links.extractPlaylistId(query);
    return listId && !listId.startsWith("RD") ? { kind: "ytp", listId } : null;
  }
  const spotify = links.parseSpotify(query);
  if (spotify) {
    const { type, id } = spotify;
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
  if (s.requesterId != null && !isSnowflake(String(s.requesterId))) return null;
  return { kind: s.kind, listId: String(s.listId), offset, anchorId: String(s.anchorId), insertFirst: s.insertFirst === true, requesterId: s.requesterId == null ? null : String(s.requesterId) };
}

// 곡 찾기 결과에서 읽는 필드
type Found = { isPlaylist?: boolean; collectionId?: string | null; total?: number | null; nextOffset?: number | null; tracks?: Array<{ id?: string }> };

// 방금 넣은 목록을 이어 불러올 수 있으면 그 상태. 총 곡 수를 모르거나(믹스) 끝까지 넣었으면 null.
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

// 대기열에 더 넣을 수 있는 곡 수. 비어 있으면 첫 곡은 지금 곡이 되니 한 자리 더
function roomFor(player: Pick<Player, "queue" | "currentTrack">) {
  return roomWithin(player, config.bot.maxQueueSize);
}

/** 이 링크의 한 번에 넣는 곡 수. 서버 설정(batch)을 출처의 상한으로 자른다(사운드클라우드 세트는 10곡) */
function batchFor(query: string | null | undefined, batch: number) {
  const soundcloud = query ? links.parseSoundCloud(query)?.kind : null;
  return soundcloud === "set" || soundcloud === "short" ? Math.min(batch, SOUNDCLOUD_BATCH) : batch;
}

// 누른 사람, 메시지 나이 확인. 문제가 있으면 그 코드
function clickError(state: MoreState, { userId, lastTouched, now = Date.now() }: { userId: string; lastTouched: number; now?: number }): Extract<Code, "more-not-requester" | "more-expired"> | null {
  if (state.requesterId && state.requesterId !== userId) return "more-not-requester";
  if (now - lastTouched > LIFETIME_MS) return "more-expired";
  return null;
}

/** 메뉴의 모양. menu가 null이면 헤더 줄만 그린다. 자리가 없을 때(noRoom, 그렇다고 덧붙인다)와 상태가 custom_id에 들어가지 않을 때다 */
type MenuSpec = { menu: MoreMenu | null; noRoom: boolean };

function menuSpec(state: MoreState, { remaining, room, batch = PLAYLIST_ADD_DEFAULT }: { remaining: number; room: number; batch?: number }): MenuSpec {
  const { perClick } = KINDS[state.kind];
  const { cap, steps } = moreChoices({ remaining, room, batch, perClick });
  if (cap === 0) return { menu: null, noRoom: true };
  // 모달 ID가 한 글자 더 길다. 둘 다 100자 안이어야 한다
  if (encodeState(MODAL_PREFIX, state).length > 100) return { menu: null, noRoom: false };
  return { menu: { customId: encodeState(SELECT_PREFIX, state), remaining, steps, cap, all: cap >= remaining, perClick: cap === perClick }, noRoom: false };
}

/** 처음 표시하는 메뉴: 출처의 종류, 전체 곡 수, 넣은 데까지와 메뉴(ui/playlist-more-menu의 offerView가 그린다) */
function offerSpec(more: More, room: number): OfferSpec {
  return { head: { collection: KINDS[more.kind].collection, total: more.total, offset: more.offset }, ...menuSpec(more, { remaining: more.remaining, room, batch: more.batch }) };
}

/** 이어 넣은 결과(디스코드 메뉴와 대시보드가 각자 그린다) */
function outcomeOf(kind: Kind, result: MoreResult): MoreOutcome {
  return { collection: KINDS[kind].collection, added: result.added, skipped: result.skipped, dropped: result.dropped, total: result.total, remaining: result.remaining, nextOffset: result.next ? result.next.offset : null };
}

/** 이어 넣은 결과와, 더 넣을 것이 있으면 다시 달 메뉴 */
function resultSpec(state: MoreState, result: MoreResult, room: number): ResultSpec {
  const outcome = outcomeOf(state.kind, result);
  if (!result.next) return { outcome, menu: null, noRoom: false };
  return { outcome, ...menuSpec(result.next, { remaining: result.remaining, room, batch: result.next.batch }) };
}

/** 곡 수를 입력하는 모달의 모양. cap은 남은 자리 */
function countSpec(state: MoreState, cap: number, batch = PLAYLIST_ADD_DEFAULT): CountSpec {
  const max = Math.min(cap, MAX_COUNT, KINDS[state.kind].perClick);
  return { customId: encodeState(MODAL_PREFIX, state), max, suggested: Math.min(max, batch) };
}

// ── 메시지 수명. 이어 넣으면 다시 센다 ──

const clearExpiry = stopExpiry;

function expireLater(messageId: string, remove: () => unknown, ms: number = LIFETIME_MS) {
  markTransient(messageId, ms); // 조작하는 동안 현재 재생 메시지가 이 밑으로 내려오지 않게
  expireMessage(messageId, remove, ms);
}

export { LIFETIME_MS, LOOKBACK, batchFor, SELECT_PREFIX, MODAL_PREFIX, KINDS, continuation, validState, encodeState, decodeState, roomFor, clickError, offerSpec, outcomeOf, resultSpec, countSpec, expireLater, clearExpiry };
export type { MoreResult };
