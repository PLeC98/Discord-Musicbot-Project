"use strict";

// 재생목록 "더 넣기". 이어 받을 위치(상태), 선택지, 디스코드 메뉴, 메시지 수명.
// 상태는 메뉴의 custom_id에만 둔다(메모리 없음). 재시작해도 메뉴가 산다. 만료는 누를 때 메시지 나이로 다시 본다.

const { ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require("discord.js");
const log = require("./infra/log/logger").child({ category: "player" });
const config = require("../config");
const YouTube = require("./sources/youtube/index");
const Spotify = require("./sources/spotify");
const trackState = require("./player/trackState");
const { collectionLabel } = require("./ui/strings");
const { markTransient } = require("./ui/transientMessages");

const LIFETIME_MS = 30_000;
// 이어 받을 때 앞으로 더 받아 직전 마지막 곡(앵커)을 찾는 폭. 그 사이 목록이 이만큼 편집돼도 이어진다
const LOOKBACK = 5;
const MAX_COUNT = 10_000;
const SELECT_PREFIX = "plm";
const MODAL_PREFIX = "plmm";

// 이어 받을 수 있는 출처. 믹스(RD…)는 부를 때마다 결과가 달라 빠진다. 인기곡은 10곡뿐이라 이어 받을 게 없다.
const KINDS = {
  ytp: { id: /^[A-Za-z0-9_-]{10,64}$/, url: (id) => `https://www.youtube.com/playlist?list=${id}`, collection: "playlist" },
  spp: { id: /^[A-Za-z0-9]{22}$/, url: (id) => `https://open.spotify.com/playlist/${id}`, collection: "playlist" },
  spa: { id: /^[A-Za-z0-9]{22}$/, url: (id) => `https://open.spotify.com/album/${id}`, collection: "album" },
};
const TRACK_ID = /^[A-Za-z0-9_-]{11,22}$/;
const USER_ID = /^\d{17,20}$/;

const fmt = (n) => Number(n).toLocaleString("ko-KR");

function sourceOf(query) {
  if (YouTube.isPlaylist(query)) {
    const listId = YouTube.extractPlaylistId(query);
    return listId && !listId.startsWith("RD") ? { kind: "ytp", listId } : null;
  }
  if (Spotify.isSpotifyURL(query)) {
    const { type, id } = Spotify.parseSpotifyURL(query);
    if (type === "playlist") return { kind: "spp", listId: id };
    if (type === "album") return { kind: "spa", listId: id };
  }
  return null;
}

function validState(s) {
  if (!s || !KINDS[s.kind] || !KINDS[s.kind].id.test(String(s.listId))) return null;
  const offset = Number(s.offset);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) return null;
  if (!TRACK_ID.test(String(s.anchorId))) return null;
  if (s.requesterId != null && !USER_ID.test(String(s.requesterId))) return null;
  return { kind: s.kind, listId: String(s.listId), offset, anchorId: String(s.anchorId), insertFirst: s.insertFirst === true, requesterId: s.requesterId ?? null };
}

// 방금 넣은 목록을 이어 받을 수 있으면 그 상태. 총 곡 수를 모르거나(믹스) 끝까지 넣었으면 null.
function continuation(query, trackData, { insertFirst = false } = {}) {
  if (!query || !trackData?.isPlaylist || trackData.total == null || trackData.nextOffset == null) return null;
  const source = sourceOf(query);
  if (!source) return null;
  const remaining = trackData.total - trackData.nextOffset;
  const state = validState({ ...source, offset: trackData.nextOffset, anchorId: trackData.tracks.at(-1)?.id, insertFirst });
  return state && remaining > 0 ? { ...state, total: trackData.total, remaining } : null;
}

function encodeState(prefix, s) {
  return [prefix, s.kind, s.listId, s.offset, s.anchorId, s.insertFirst ? "f" : "b", ...(s.requesterId ? [s.requesterId] : [])].join(":");
}

function decodeState(customId) {
  const [prefix, kind, listId, offset, anchorId, place, requesterId] = String(customId).split(":");
  if (![SELECT_PREFIX, MODAL_PREFIX].includes(prefix) || !["f", "b"].includes(place)) return null;
  return validState({ kind, listId, offset, anchorId, insertFirst: place === "f", requesterId: requesterId ?? null });
}

// 대기열에 더 넣을 수 있는 곡 수. 비어 있으면 첫 곡은 현재곡이 되니 한 자리 더
function roomFor(player) {
  return trackState.roomLeft(player, config.bot.maxQueueSize) + (player.currentTrack ? 0 : 1);
}

// 선택지. 한 번에 넣는 묶음 단위로, 남은 곡과 남은 자리 중 작은 쪽(cap)을 넘지 않게
function moreChoices({ remaining, room, batch }) {
  const cap = Math.max(0, Math.min(remaining, room));
  return { cap, steps: cap > 0 ? [batch, batch * 2].filter((n) => n < cap) : [] };
}

// 누른 사람·메시지 나이 확인. 문제가 있으면 안내 문구
function clickError(state, { userId, lastTouched, now = Date.now() }) {
  if (state.requesterId && state.requesterId !== userId) return "목록을 넣은 사람만 더 넣을 수 있어요.";
  if (now - lastTouched > LIFETIME_MS) return "시간이 지나 닫힌 메뉴예요. 링크를 다시 넣어 주세요.";
  return null;
}

function parseCount(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= MAX_COUNT ? n : null;
}

function menuMessage(head, state, { remaining, room, batch = config.bot.playlistAddDefault }) {
  const { cap, steps } = moreChoices({ remaining, room, batch });
  if (cap === 0) return { content: `${head}\n대기열이 가득 차 지금은 더 넣을 수 없어요.`, components: [] };
  // 모달 ID가 한 글자 더 길다. 둘 다 100자 안이어야 한다
  if (encodeState(MODAL_PREFIX, state).length > 100) return { content: head, components: [] };

  const menu = new StringSelectMenuBuilder()
    .setCustomId(encodeState(SELECT_PREFIX, state))
    .setPlaceholder(`더 넣기 (남은 ${fmt(remaining)}곡)`)
    .addOptions(...steps.map((n) => ({ label: `${fmt(n)}곡 더`, value: String(n) })), { label: cap < remaining ? `넣을 수 있는 만큼 (${fmt(cap)}곡)` : `남은 곡 전부 (${fmt(cap)}곡)`, value: String(cap) }, { label: "직접 입력…", value: "custom" }, { label: "그만 넣기", value: "stop" });
  return { content: head, components: [new ActionRowBuilder().addComponents(menu)] };
}

function offerMessage(more, room) {
  const label = collectionLabel(KINDS[more.kind].collection);
  return menuMessage(`📃 ${label}은 전체 ${fmt(more.total)}곡이에요. 앞 ${fmt(more.offset)}곡까지 넣었어요.`, more, { remaining: more.remaining, room, batch: more.batch });
}

function resultMessage(state, result, room) {
  const label = collectionLabel(KINDS[state.kind].collection);
  let head = `✅ ${label}에서 ${fmt(result.added)}곡을 더 넣었어요.`;
  if (result.dropped > 0) head += ` 대기열이 가득 차 ${fmt(result.dropped)}곡은 빠졌어요.`;
  if (!result.next) return { content: result.remaining > 0 ? head : `${head} 목록을 끝까지 넣었어요.`, components: [] };
  return menuMessage(`${head} (전체 ${fmt(result.total)}곡 중 ${fmt(result.next.offset)}곡까지)`, result.next, { remaining: result.remaining, room, batch: result.next.batch });
}

function countModal(state, cap, batch = config.bot.playlistAddDefault) {
  const max = Math.min(cap, MAX_COUNT);
  const input = new TextInputBuilder()
    .setCustomId("count")
    .setLabel(`넣을 곡 수 (1~${fmt(max)})`)
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(5)
    .setPlaceholder(String(Math.min(max, batch)))
    .setRequired(true);
  return new ModalBuilder().setCustomId(encodeState(MODAL_PREFIX, state)).setTitle("더 넣기").addComponents(new ActionRowBuilder().addComponents(input));
}

// ── 메시지 수명. 이어 넣으면 다시 센다 ──

const expiries = new Map(); // messageId → timer

function clearExpiry(messageId) {
  clearTimeout(expiries.get(messageId));
  expiries.delete(messageId);
}

function expireLater(messageId, remove, ms = LIFETIME_MS) {
  clearExpiry(messageId);
  markTransient(messageId, ms); // 조작하는 동안 현재 재생 메시지가 이 밑으로 내려오지 않게
  const timer = setTimeout(() => {
    expiries.delete(messageId);
    Promise.resolve()
      .then(remove)
      .catch(() => {});
  }, ms);
  timer.unref?.();
  expiries.set(messageId, timer);
}

// 슬래시 명령. 일반 채널 메시지로 띄운다. 상호작용 후속 메시지는 디스코드가 원래 응답에 답장 모양으로 붙이는데,
// 그 응답이 지워지면 "메시지를 불러올 수 없어요"에 매달린다. 채널에 쓸 권한이 없을 때만 본인 전용 후속 메시지로.
async function offerOnInteraction(interaction, more, player) {
  if (await offerOnChannel(interaction.channel, more, player, interaction.user.id, { quiet: true })) return;
  const payload = offerMessage(more, roomFor(player));
  if (payload.components.length === 0) return;
  try {
    const message = await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    expireLater(message.id, () => interaction.deleteReply(message.id));
  } catch (error) {
    log.warn(`더 넣기 메뉴 전송 실패: ${error.message}`);
  }
}

// 공개 메시지. 누를 수 있는 사람은 custom_id의 요청자로 가른다. 띄웠거나 띄울 것이 없으면 true.
async function offerOnChannel(channel, more, player, requesterId, { quiet = false } = {}) {
  const payload = offerMessage({ ...more, requesterId }, roomFor(player));
  if (payload.components.length === 0) return true;
  if (typeof channel?.send !== "function") return false;
  try {
    const message = await channel.send(payload);
    expireLater(message.id, () => message.delete());
    return true;
  } catch (error) {
    if (!quiet) log.warn(`더 넣기 메뉴 전송 실패: ${error.message}`);
    return false;
  }
}

module.exports = {
  LIFETIME_MS,
  LOOKBACK,
  MAX_COUNT,
  SELECT_PREFIX,
  MODAL_PREFIX,
  KINDS,
  continuation,
  validState,
  encodeState,
  decodeState,
  roomFor,
  moreChoices,
  clickError,
  parseCount,
  offerMessage,
  resultMessage,
  countModal,
  expireLater,
  clearExpiry,
  offerOnInteraction,
  offerOnChannel,
};
