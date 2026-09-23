"use strict";

const MusicPlayer = require("../player/Player");
const TrackResolver = require("../sources/trackResolver");
const GuildSettingsManager = require("../store/guildSettings");
const { silentResponder } = require("./responders");
const log = require("../infra/log/logger").child({ category: "player" });
const config = require("../../config");
const trackState = require("../player/trackState");
const S = require("../ui/strings");
const { continuation, validState, roomFor, KINDS, LOOKBACK } = require("./playlistMore");
const { capabilities: ffmpegCapabilities } = require("../media/ffmpeg/path");
const { liveBlockReason } = require("../rules/liveBlockReason");

const LIVE_BLOCK_TEXT = { "live-upcoming": S.ERR_LIVE_UPCOMING, "live-no-ffmpeg": S.ERR_LIVE_NO_FFMPEG };

/** 이 곡을 대기열에 넣을 수 없는 이유(사용자에게 보일 문장). 넣을 수 있으면 null. */
function liveBlockText(track) {
  const reason = liveBlockReason(track, { ffmpegReady: () => ffmpegCapabilities().ok });
  return reason ? LIVE_BLOCK_TEXT[reason] : null;
}

/**
 * 곡 추가 경로의 단일 코어. 진입점(슬래시 명령/전용 채널/검색 선택/대시보드)은
 * 권한 검사와 응답 매체(responder)만 책임지고 나머지는 전부 여기를 지난다.
 *
 * 여기서 디스코드 상호작용도 HTTP 응답도 만들지 않는다. 결과 객체만 돌려준다.
 */

/**
 * 요청자 표준형. GuildMember / 대시보드 세션 사용자 / 세션 복구 스텁이 각기 다른 모양으로
 * 들어오던 것을 한 모양으로 접는다. 소비자는 id·username·tag만 읽는다.
 */
function toRequester(source) {
  if (!source) return null;
  if (typeof source === "string") return { id: null, username: source, tag: source };

  return {
    id: source.id ?? null,
    // displayName을 먼저 본다. GuildMember에는 username이 없어 전역 계정명이 먼저 잡히면
    // 서버 닉네임이 영영 쓰이지 않는다. displayName은 닉네임이 있으면 닉네임, 없으면 표시 이름이다.
    username: source.displayName ?? source.username ?? source.user?.displayName ?? source.user?.username ?? null,
    tag: source.tag ?? source.user?.tag ?? null,
  };
}

/**
 * 서버의 플레이어를 확보한다. 이미 있으면 재사용하고 채널만 갱신.
 *
 * voiceChannel은 봇이 유휴일 때만 갱신한다. 재생 중 다른 채널 참조로 오염되면
 * 이후 재연결이 엉뚱한 채널로 간다. textChannel은 null로 덮어쓰지 않는다(대시보드).
 */
function ensurePlayer(client, { guild, textChannel = null, voiceChannel = null }) {
  const botVoiceChannel = guild.members.me?.voice?.channel ?? null;

  let player = client.players.get(guild.id);
  if (!player) {
    player = new MusicPlayer(guild, textChannel, voiceChannel ?? botVoiceChannel);
    client.players.set(guild.id, player);
    return player;
  }

  if (!botVoiceChannel && voiceChannel) player.voiceChannel = voiceChannel;
  if (textChannel) player.textChannel = textChannel;
  return player;
}

/**
 * 대시보드처럼 텍스트 채널 개념이 없는 진입점의 출력 채널을 정한다.
 * 서버가 지정한 봇 전용 채널만 쓴다. 아무 채널이나 추측하면 엉뚱한 곳에 도배한다.
 */
async function resolveFallbackTextChannel(guild) {
  try {
    const botChannelId = await GuildSettingsManager.getBotChannel(guild.id);
    if (!botChannelId) return null;
    const channel = guild.channels.cache.get(botChannelId) ?? null;
    return channel && typeof channel.send === "function" ? channel : null;
  } catch {
    return null;
  }
}

/**
 * 곡 추가/재생 요청을 처리한다.
 *
 * @param {object} client 디스코드 클라이언트
 * @param {object} options
 * @param {object} options.guild            서버(길드) 객체
 * @param {object} options.requester        요청자 (GuildMember 또는 { id, username })
 * @param {string} [options.query]          검색어/URL. tracks를 주지 않으면 필수
 * @param {Array}  [options.tracks]         이미 해석된 트랙 (검색 선택 경로)
 * @param {object} [options.textChannel]    안내·임베드를 보낼 채널
 * @param {object} [options.voiceChannel]   접속할 음성 채널
 * @param {boolean}[options.insertFirst]    대기열 맨 앞에 삽입
 * @param {boolean}[options.single]         재생목록이어도 첫 곡만
 * @param {object} [options.responder]      응답 매체 어댑터 (기본: 무동작)
 * @param {string} options.source           로그 라벨
 * @returns {Promise<{success: boolean, message?: string, isPlaylist?: boolean, tracks?: Array}>}
 */
async function requestPlayback(client, { guild, requester, query = null, tracks = null, collection = null, textChannel = null, voiceChannel = null, insertFirst = false, insertAfterId = null, single = false, responder = silentResponder, source = "play" }) {
  const guildId = guild.id;
  const who = toRequester(requester);

  let resolvedTextChannel = textChannel;
  if (!resolvedTextChannel && !client.players.get(guildId)?.textChannel) {
    resolvedTextChannel = await resolveFallbackTextChannel(guild);
  }

  const player = ensurePlayer(client, { guild, textChannel: resolvedTextChannel, voiceChannel });
  // 재생목록을 넣을 때 한 번에 들어가는 곡 수. 서버 설정, 더 넣기 선택지 단위이기도 하다
  const batch = GuildSettingsManager.resolvePlaylistAddMax(guildId);

  let trackData;
  if (tracks) {
    trackData = { success: true, isPlaylist: tracks.length > 1, collection, tracks };
  } else {
    log.debug({ sub: "play" }, `${source} | 서버=${guildId} | 검색어="${query}"`);
    // 받을 곡 수. 한 번에 넣는 묶음과 남은 자리 중 작은 쪽. 비어 있으면 첫 곡은 현재곡이 되니 한 자리 더.
    // 어림값이다: 최종 판정은 서버별로 줄 선 추가 구간이 한다. 가득 차도 한 곡은 받아 그쪽이 실패를 알리게 한다.
    const room = trackState.roomLeft(player, config.bot.maxQueueSize) + (player.currentTrack ? 0 : 1);
    const limit = single ? 1 : Math.max(1, Math.min(batch, room));
    trackData = await TrackResolver.resolveQuery(query, `${source}.resolveQuery`, { limit });
    if (!trackData.success) return trackData;

    // 자리가 모자라 덜 받았는데 뒤에 곡이 더 있으면 알린다 (총 곡 수를 모르면 요청한 만큼 왔는지로 본다)
    const more = trackData.total == null ? trackData.tracks.length >= limit : trackData.total > trackData.tracks.length;
    if (!single && trackData.isPlaylist && room < batch && more) trackData = { ...trackData, queueLimited: true };
  }

  // 방송 중인 라이브는 주소를 ffmpeg에 넘기는 갈래로 재생한다. 막는 것은 두 가지뿐이다.
  // 아직 시작하지 않은 방송(틀 것이 없다)과, 그 갈래를 열 수 없는 ffmpeg 빌드.
  // 조용히 버리면 아무 반응이 없는 것처럼 보이므로, 넣기 전에 걸러내고 이유를 알린다.
  if (trackData.tracks?.length) {
    const judged = trackData.tracks.map((t) => [t, liveBlockText(t)]);
    const playable = judged.filter(([, why]) => !why).map(([t]) => t);
    if (playable.length < trackData.tracks.length) {
      if (playable.length === 0) return { success: false, message: judged.find(([, why]) => why)[1] };
      trackData = { ...trackData, tracks: playable };
    }
  }

  // 끝이 없는 것은 반복할 수 없다. 라이브가 들어오면 걸려 있던 반복을 푼다.
  if (player && trackData.tracks?.some((t) => t.isLive)) player.releaseLoopForLive();

  // 재생목록에서 첫 곡만 (대시보드의 "한 곡만" 옵션)
  if (single && trackData.tracks.length > 1) {
    trackData = { ...trackData, isPlaylist: false, collection: null, tracks: trackData.tracks.slice(0, 1) };
  }
  if (insertFirst) trackData.insertFirst = true;
  if (insertAfterId) trackData.insertAfterId = insertAfterId;

  const result = await client.musicEmbedManager.handleMusicData(guildId, trackData, who, responder);

  // 조작 하나에 한 줄. 요청(위 debug)과 결과를 따로 남기면 조작당 두 줄이 되는데,
  // 운영상 필요한 것은 "누가 무엇을 넣었나"라 결과 줄에 요청자를 함께 싣는다.
  // 재생 시작은 player의 "재생" 로그가 따로 남기므로 여기서는 투입분만.
  const first = trackData.tracks?.[0];
  const count = trackData.tracks?.length ?? 0;
  const what = trackData.isPlaylist ? `${require("../ui/strings").collectionLabel(trackData.collection)} ${count}곡 (첫 곡 "${first?.title ?? "?"}")` : `"${first?.title ?? "?"}"`;
  const who_ = who?.tag ?? who?.username ?? who?.id ?? "?";
  log.info({ sub: "play" }, `${result?.success === false ? "대기열 추가 실패" : "대기열 투입"}: ${what} | 요청 ${who_} | 대기열 ${player?.queue?.length ?? 0}곡${insertFirst ? " | 맨 앞" : ""}${result?.dropped ? ` | 상한으로 ${result.dropped}곡 제외` : ""}${trackData.queueLimited ? " | 자리가 모자라 일부만 받음" : ""}`);

  // 목록이 더 남았으면 이어 받을 상태. 상한으로 곡을 뺐으면(대기열이 찬 경합) 권하지 않는다
  const more = result?.success && !result.dropped ? continuation(query, trackData, { insertFirst }) : null;
  return { ...result, isPlaylist: trackData.isPlaylist, tracks: trackData.tracks, player, more: more && { ...more, batch } };
}

const MORE_BATCH = 100;

/**
 * 재생목록 이어 넣기. 디스코드 메뉴와 대시보드가 같이 쓴다.
 *
 * 받는 곡 수는 누른 시점의 남은 자리로 다시 자른다. 앵커(직전 마지막 곡)를 찾으려고 LOOKBACK만큼 앞에서부터
 * 받고, 찾으면 그 뒤부터, 못 찾으면 요청 위치부터 넣는다. 맨 앞에 넣었던 목록이면 앵커 곡 바로 뒤에 넣는다.
 * 곡은 묶음으로 나눠 받으며 onProgress(받은 수, 받을 수)를 부른다. 대기열에는 다 받은 뒤 한 번에 넣는다.
 */
async function continueCollection(client, { guild, requester, state, count, textChannel = null, voiceChannel = null, source = "더 넣기", onProgress = () => {} }) {
  const player = client.players.get(guild.id);
  if (!player) return { success: false, message: S.ERR_NO_MUSIC };
  const want = Math.min(count, roomFor(player));
  if (want <= 0) return { success: false, message: client.musicEmbedManager.queueFullMessage() };

  const url = KINDS[state.kind].url(state.listId);
  const found = [];
  let cursor = state.offset;
  let anchor = state.anchorId;
  let total = null;
  while (found.length < want) {
    const back = Math.min(LOOKBACK, cursor);
    const limit = Math.min(MORE_BATCH, want - found.length) + back;
    const part = await TrackResolver.getCollection(url, { offset: cursor - back, limit });
    if (part.total != null) total = part.total;
    const hit = part.tracks.findIndex((t) => t.id === anchor);
    const fresh = hit >= 0 ? part.tracks.slice(hit + 1) : part.tracks.slice(back);
    found.push(...fresh);
    if (fresh.length > 0) anchor = fresh.at(-1).id;
    const advanced = part.nextOffset != null && part.nextOffset > cursor;
    if (advanced) cursor = part.nextOffset;
    onProgress(Math.min(found.length, want), want);
    if (fresh.length === 0 || !advanced || (total != null && cursor >= total)) break;
  }

  // 앵커가 앞당겨져 더 받았으면 넘친 만큼 되돌린다. 다음 이어 받기는 앵커가 바로잡는다
  const tracks = found.slice(0, want);
  if (tracks.length === 0) return { success: false, message: "더 넣을 곡을 찾지 못했어요." };
  const nextOffset = cursor - (found.length - tracks.length);

  const result = await requestPlayback(client, {
    guild,
    requester,
    tracks,
    collection: KINDS[state.kind].collection,
    textChannel,
    voiceChannel,
    insertAfterId: state.insertFirst ? state.anchorId : null,
    source,
  });
  const remaining = total != null ? Math.max(0, total - nextOffset) : 0;
  const next = result.success && remaining > 0 ? validState({ ...state, offset: nextOffset, anchorId: tracks.at(-1).id }) : null;
  return { ...result, added: tracks.length - (result.dropped || 0), total, remaining, next: next && { ...next, total, remaining, batch: GuildSettingsManager.resolvePlaylistAddMax(guild.id) } };
}

module.exports = { requestPlayback, continueCollection, toRequester, ensurePlayer, _internals: { resolveFallbackTextChannel } };
