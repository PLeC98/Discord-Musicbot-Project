import { MusicPlayer } from "../player/Player.ts";
import * as songLookup from "../sources/lookup.ts";
import * as GuildSettingsManager from "../store/guildSettings.ts";
import { silentResponder } from "./responders.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import config from "../../config.ts";
import * as trackState from "../player/trackState.ts";
import * as S from "../ui/strings.ts";
import { ErrorHandler } from "../ui/errorMessages.ts";
import { continuation, validState, roomFor, KINDS, LOOKBACK, type More, type MoreState } from "./playlistMore.ts";
import { capabilities as ffmpegCapabilities } from "../media/ffmpeg/path.ts";
import { liveBlockReason } from "../rules/liveBlockReason.ts";
import { canSend } from "../ui/channels.ts";
import type { Client, Guild, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import type { Requester, TrackInfo } from "../player/track.ts";
import type { AddResult, Responder, TrackData } from "../ui/nowPlayingPanel.ts";
const LIVE_BLOCK_TEXT = { "live-upcoming": S.ERR_LIVE_UPCOMING, "live-no-ffmpeg": S.ERR_LIVE_NO_FFMPEG };

/** 곡 찾기에서 부르는 것 */
type Lookup = Pick<typeof songLookup, "resolveQuery" | "getCollection">;
/** 요청자로 받는 것: 디스코드 멤버 · 사용자, 대시보드 세션 사용자, 세션 복구 스텁(이름 글자) */
type RequesterSource = string | { id?: string | null; displayName?: string | null; username?: string | null; tag?: string | null; user?: { displayName?: string | null; username?: string | null; tag?: string | null } } | null | undefined;

// 곡 찾기. 입구(명령 · 이벤트 · 대시보드)를 거쳐 부르는 시험은 useLookup 으로 가짜를 넘긴다(플레이어의 useBoundary 와 같다)
let defaultLookup: Lookup = songLookup;
function useLookup(fake: Lookup | null | undefined) {
  defaultLookup = fake ?? songLookup;
}

/** 이 곡을 대기열에 넣을 수 없는 이유(사용자에게 보일 문장). 넣을 수 있으면 null. */
function liveBlockText(track: TrackInfo, ffmpegReady: () => boolean) {
  const reason = liveBlockReason(track, { ffmpegReady });
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
function toRequester(source: RequesterSource): Requester | null {
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
function ensurePlayer(client: Client, { guild, textChannel = null, voiceChannel = null }: { guild: Guild; textChannel?: GuildTextBasedChannel | null; voiceChannel?: VoiceBasedChannel | null }) {
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
async function resolveFallbackTextChannel(guild: Guild) {
  try {
    const botChannelId = await GuildSettingsManager.getBotChannel(guild.id);
    if (!botChannelId) return null;
    const channel = guild.channels.cache.get(botChannelId) ?? null;
    return canSend(channel) ? channel : null;
  } catch {
    return null;
  }
}

/**
 * 곡 추가/재생 요청. 검색어(query)나 이미 찾은 곡(tracks, 검색 선택 경로) 가운데 하나는 있어야 한다.
 * textChannel 은 안내 · 패널을 보낼 채널, voiceChannel 은 붙을 음성 채널, single 은 재생목록이어도 첫 곡만,
 * responder 는 결과를 알리는 매체(기본: 무동작), source 는 로그 라벨
 */
type PlaybackRequest = {
  guild: Guild;
  requester: RequesterSource;
  collection?: string | null;
  textChannel?: GuildTextBasedChannel | null;
  voiceChannel?: VoiceBasedChannel | null;
  insertFirst?: boolean;
  insertAfterId?: string | null;
  single?: boolean;
  responder?: Responder;
  source?: string;
  lookup?: Lookup;
  ffmpegReady?: () => boolean;
} & ({ query: string; tracks?: null } | { tracks: TrackInfo[]; query?: string | null });

/** 곡 담기 결과. 실패면 message 가 안내, 목록이 더 남았으면 이어 받을 상태(more) */
type PlaybackResult = { success: false; message: string; dropped?: undefined; more?: undefined; player?: undefined } | (AddResult & { isPlaylist: boolean; tracks: TrackInfo[]; player: MusicPlayer; more: (More & { batch: number }) | null });

/** 이어 넣은 결과. 넣은 수 · 목록의 남은 곡과 다음 위치(next) */
type Continued = { added: number; total: number | null; remaining: number; next: (More & { batch: number }) | null };
type CollectionResult = { success: false; message: string } | (PlaybackResult & Continued);

/** 곡을 넣을 목록. 찾은 결과거나 이미 찾은 곡 */
type Found = { isPlaylist: boolean; collection?: string | null; tracks: TrackInfo[]; total?: number | null; nextOffset?: number | null; queueLimited?: boolean };

async function requestPlayback(client: Client, request: PlaybackRequest): Promise<PlaybackResult> {
  const { guild, insertFirst = false, responder = silentResponder } = request;
  const player = await playerFor(client, request);
  // 재생목록을 넣을 때 한 번에 들어가는 곡 수. 서버 설정, 더 넣기 선택지 단위이기도 하다
  const batch = GuildSettingsManager.resolvePlaylistAddMax(guild.id);

  const checked = await tracksFor(player, request, batch);
  if (typeof checked === "string") return { success: false, message: checked };

  // 끝이 없는 것은 반복할 수 없다. 라이브가 들어오면 걸려 있던 반복을 푼다.
  if (checked.tracks.some((t) => t.isLive)) player.releaseLoopForLive();

  const trackData = trimmed(checked, request.single);
  const toAdd: TrackData = { ...trackData, ...placement(request) };

  const who = toRequester(request.requester);
  const result = await client.musicEmbedManager.handleMusicData(guild.id, toAdd, who, responder);
  logAddition(trackData, result, who, player, insertFirst);

  // 목록이 더 남았으면 이어 받을 상태. 상한으로 곡을 뺐으면(대기열이 찬 경합) 권하지 않는다
  const more = result.success && !result.dropped ? continuation(request.query ?? null, trackData, { insertFirst }) : null;
  return { ...result, isPlaylist: trackData.isPlaylist, tracks: trackData.tracks, player, more: more && { ...more, batch } };
}

// 서버의 플레이어. 요청에도 플레이어에도 텍스트 채널이 없으면 전용 채널을 쓴다
async function playerFor(client: Client, { guild, textChannel = null, voiceChannel = null }: PlaybackRequest) {
  let resolvedTextChannel = textChannel;
  if (!resolvedTextChannel && !client.players.get(guild.id)?.textChannel) {
    resolvedTextChannel = await resolveFallbackTextChannel(guild);
  }
  return ensurePlayer(client, { guild, textChannel: resolvedTextChannel, voiceChannel });
}

// 넣을 곡. 이미 찾은 곡이면 그대로, 검색어면 찾는다. 넣을 수 없으면 안내 문구
async function tracksFor(player: MusicPlayer, request: PlaybackRequest, batch: number): Promise<Found | string> {
  const found = request.tracks ? { isPlaylist: request.tracks.length > 1, collection: request.collection ?? null, tracks: request.tracks } : await search(player, request.query, request, batch);
  return typeof found === "string" ? found : withoutBlocked(found, request.ffmpegReady);
}

async function search(player: MusicPlayer, query: string, { guild, single = false, source = "play", lookup = defaultLookup }: PlaybackRequest, batch: number): Promise<Found | string> {
  log.debug({ sub: "play" }, `${source} | 서버=${guild.id} | 검색어="${query}"`);
  // 받을 곡 수. 묶음은 대기열에 들어가는 곡 수라 대기열의 남은 자리와 견준다. 쉬던 중이면 첫 곡은 대기열이 아니라
  // 곧바로 틀리니 한 곡을 더 받는다(묶음이 대기열 상한으로 잘려 있어도 대기열을 다 채운다).
  // 어림값이다: 최종 판정은 서버별로 줄 선 추가 구간이 한다. 가득 차도 한 곡은 받아 그쪽이 실패를 알리게 한다.
  const room = trackState.roomLeft(player, config.bot.maxQueueSize);
  const limit = single ? 1 : Math.max(1, Math.min(batch, room) + (player.currentTrack ? 0 : 1));
  const found = await lookup.resolveQuery(query, `${source}.resolveQuery`, { limit });
  if (!found.success) return ErrorHandler.lookupFailure(found);

  // 자리가 모자라 덜 받았는데 뒤에 곡이 더 있으면 알린다 (총 곡 수를 모르면 요청한 만큼 왔는지로 본다)
  const more = found.total == null ? found.tracks.length >= limit : found.total > found.tracks.length;
  return !single && found.isPlaylist && room < batch && more ? { ...found, queueLimited: true } : found;
}

// 방송 중인 라이브는 주소를 ffmpeg에 넘기는 갈래로 재생한다. 막는 것은 두 가지뿐이다.
// 아직 시작하지 않은 방송(틀 것이 없다)과, 그 갈래를 열 수 없는 ffmpeg 빌드.
// 조용히 버리면 아무 반응이 없는 것처럼 보이므로, 넣기 전에 걸러내고 이유를 알린다.
function withoutBlocked(found: Found, ffmpegReady = () => ffmpegCapabilities().ok): Found | string {
  const blocked = found.tracks.map((t) => liveBlockText(t, ffmpegReady));
  const firstBlock = blocked.find((why): why is string => Boolean(why));
  if (!firstBlock) return found;
  const playable = found.tracks.filter((_, i) => !blocked[i]);
  // 전부 막혔으면 처음 막힌 까닭을 알린다
  return playable.length === 0 ? firstBlock : { ...found, tracks: playable };
}

// 재생목록에서 첫 곡만 (대시보드의 "한 곡만" 옵션)
function trimmed(found: Found, single = false): Found {
  return single && found.tracks.length > 1 ? { ...found, isPlaylist: false, collection: null, tracks: found.tracks.slice(0, 1) } : found;
}

// 넣을 자리. 적힌 것만 싣는다
function placement({ insertFirst = false, insertAfterId = null }: PlaybackRequest) {
  return { ...(insertFirst ? { insertFirst: true } : {}), ...(insertAfterId ? { insertAfterId } : {}) };
}

// 조작 하나에 한 줄. 요청(검색 debug)과 결과를 따로 남기면 조작당 두 줄이 되는데,
// 운영상 필요한 것은 "누가 무엇을 넣었나"라 결과 줄에 요청자를 함께 싣는다.
// 재생 시작은 player의 "재생" 로그가 따로 남기므로 여기서는 투입분만.
function logAddition(found: Found, result: AddResult, who: Requester | null, player: MusicPlayer, insertFirst: boolean) {
  const notes = [insertFirst ? " | 맨 앞" : "", result.dropped ? ` | 상한으로 ${result.dropped}곡 제외` : "", found.queueLimited ? " | 자리가 모자라 일부만 받음" : ""].join("");
  log.info({ sub: "play" }, `${result.success === false ? "대기열 추가 실패" : "대기열 투입"}: ${whatOf(found)} | 요청 ${nameOf(who)} | 대기열 ${player.queue.length}곡${notes}`);
}

// 넣은 것. 목록이면 출처와 곡 수, 한 곡이면 제목
function whatOf({ isPlaylist, collection, tracks }: Found) {
  const title = tracks[0]?.title ?? "?";
  return isPlaylist ? `${S.collectionLabel(collection)} ${tracks.length}곡 (첫 곡 "${title}")` : `"${title}"`;
}

const nameOf = (who: Requester | null) => who?.tag ?? who?.username ?? who?.id ?? "?";

const MORE_BATCH = 100;

/**
 * 재생목록 이어 넣기. 디스코드 메뉴와 대시보드가 같이 쓴다.
 *
 * 받는 곡 수는 누른 시점의 남은 자리로 다시 자른다. 앵커(직전 마지막 곡)를 찾으려고 LOOKBACK만큼 앞에서부터
 * 받고, 찾으면 그 뒤부터, 못 찾으면 요청 위치부터 넣는다. 맨 앞에 넣었던 목록이면 앵커 곡 바로 뒤에 넣는다.
 * 곡은 묶음으로 나눠 받으며 onProgress(받은 수, 받을 수)를 부른다. 대기열에는 다 받은 뒤 한 번에 넣는다.
 */
/** 이어 넣기 요청. state 는 이어 받을 위치, count 는 넣을 곡 수, onProgress(받은 수, 받을 수) */
type CollectionRequest = {
  guild: Guild;
  requester: RequesterSource;
  state: MoreState;
  count: number;
  textChannel?: GuildTextBasedChannel | null;
  voiceChannel?: VoiceBasedChannel | null;
  source?: string;
  onProgress?: (done: number, want: number) => void;
  lookup?: Lookup;
};

const ignoreProgress = () => {
  /* 진행을 알릴 곳이 없다 */
};

async function continueCollection(client: Client, request: CollectionRequest): Promise<CollectionResult> {
  const { guild, state } = request;
  const player = client.players.get(guild.id);
  if (!player) return { success: false, message: S.ERR_NO_MUSIC };
  const want = Math.min(request.count, roomFor(player));
  if (want <= 0) return { success: false, message: client.musicEmbedManager.queueFullMessage() };

  const { found, cursor, total } = await gather(request, want);

  // 앵커가 앞당겨져 더 받았으면 넘친 만큼 되돌린다. 다음 이어 받기는 앵커가 바로잡는다
  const tracks = found.slice(0, want);
  if (tracks.length === 0) return { success: false, message: "더 넣을 곡을 찾지 못했어요." };
  const nextOffset = cursor - (found.length - tracks.length);

  const result = await requestPlayback(client, {
    guild,
    requester: request.requester,
    tracks,
    collection: KINDS[state.kind].collection,
    textChannel: request.textChannel,
    voiceChannel: request.voiceChannel,
    insertAfterId: state.insertFirst ? state.anchorId : null,
    source: request.source ?? "더 넣기",
  });
  const remaining = total != null ? Math.max(0, total - nextOffset) : 0;
  const next = result.success && remaining > 0 ? validState({ ...state, offset: nextOffset, anchorId: tracks.at(-1)?.id }) : null;
  return { ...result, added: tracks.length - (result.dropped || 0), total, remaining, next: next && total != null ? { ...next, total, remaining, batch: GuildSettingsManager.resolvePlaylistAddMax(guild.id) } : null };
}

// 목록에서 want 곡을 묶음으로 나눠 받는다. 앵커를 찾으면 그 뒤부터, 못 찾으면 요청 위치부터
async function gather({ state, onProgress = ignoreProgress, lookup = defaultLookup }: CollectionRequest, want: number) {
  const url = KINDS[state.kind].url(state.listId);
  const found: TrackInfo[] = [];
  let cursor = state.offset;
  let anchor: string | undefined = state.anchorId;
  let total: number | null = null;
  while (found.length < want) {
    const back = Math.min(LOOKBACK, cursor);
    const limit = Math.min(MORE_BATCH, want - found.length) + back;
    const part = await lookup.getCollection(url, { offset: cursor - back, limit });
    if (part.total != null) total = part.total;
    const hit = part.tracks.findIndex((t) => t.id === anchor);
    const fresh = hit >= 0 ? part.tracks.slice(hit + 1) : part.tracks.slice(back);
    found.push(...fresh);
    if (fresh.length > 0) anchor = fresh.at(-1)?.id;
    const next = part.nextOffset;
    const advanced = next != null && next > cursor;
    if (advanced) cursor = next;
    onProgress(Math.min(found.length, want), want);
    if (fresh.length === 0 || !advanced || (total != null && cursor >= total)) break;
  }
  return { found, cursor, total };
}

export { requestPlayback, continueCollection, toRequester, ensurePlayer, useLookup };
export const _internals = { resolveFallbackTextChannel };
export type { PlaybackRequest, RequesterSource, Lookup, CollectionResult };
