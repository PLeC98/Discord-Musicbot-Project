import { Player } from "../player/Player.ts";
import * as songLookup from "../sources/lookup.ts";
import * as GuildSettingsManager from "../store/guildSettings.ts";
import * as trackLookup from "../store/trackLookup.ts";
import { silentResponder } from "./responders.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import config from "../../config.ts";
import * as trackState from "../player/trackState.ts";
import * as S from "../ui/strings.ts";
import { errorMessage, lookupFailureMessage, playFailureMessage } from "../ui/errorMessages.ts";
import { continuation, validState, roomFor, batchFor, KINDS, type More, type MoreState } from "./playlistMore.ts";
import { capabilities as ffmpegCapabilities } from "../media/ffmpeg/path.ts";
import { liveBlockReason } from "../rules/liveBlockReason.ts";
import { errorKind, messageOf } from "../rules/errorKind.ts";
import { canSend } from "../ui/channels.ts";
import type { Client, Guild, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import type { QueuedTrack, Requester, TrackInfo } from "../player/track.ts";
import type { NowPlayingPanel, Responder } from "../ui/nowPlayingPanel.ts";
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

/**
 * 넣지 못한 까닭. code 는 운영자가 보는 로그에, message 는 사용자에게. 곡 찾기 · 재생이 던진 것이면 그 오류의 종류(kind)
 */
type Refused = { code: string; message: string; kind?: string };
const isRefused = (x: object): x is Refused => "code" in x;
const kindOf = (error: unknown) => (error ? { kind: errorKind(error) } : {});
/** 로그에 적을 까닭. 오류 종류가 있으면 붙인다 */
const causeOf = ({ code, kind }: { code: string; kind?: string }) => (kind ? `${code}(${kind})` : code);

/** 이 곡을 대기열에 넣을 수 없는 까닭. 넣을 수 있으면 null */
function liveBlock(track: TrackInfo, ffmpegReady: () => boolean): Refused | null {
  const reason = liveBlockReason(track, { ffmpegReady });
  return reason ? { code: reason, message: LIVE_BLOCK_TEXT[reason] } : null;
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
    player = new Player(guild, textChannel, voiceChannel ?? botVoiceChannel);
    client.players.set(guild.id, player);
    return player;
  }

  // 봇이 이미 음성에 있으면 음성 채널은 그대로(바꾸면 재연결이 엉뚱한 채널로 간다)
  player.bindChannels({ voice: botVoiceChannel ? null : voiceChannel, text: textChannel });
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
 * 곡 추가/재생 요청. 검색어(query)나 이미 찾은 곡(tracks) 가운데 하나는 있어야 한다.
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
type PlaybackResult = { success: false; message: string; code?: string; dropped?: undefined; more?: undefined; player?: undefined } | (AddResult & { isPlaylist: boolean; tracks: TrackInfo[]; player: Player; more: (More & { batch: number }) | null });

/** 이어 넣은 결과. 넣은 수 · 목록의 남은 곡과 다음 위치(next) */
type Continued = { added: number; skipped: number; total: number | null; remaining: number; next: (More & { batch: number }) | null };
type CollectionResult = { success: false; message: string } | (PlaybackResult & Continued);

/** 곡 담기 요청. 여러 곡이면 출처(collection)와 전체 곡 수(total)가 붙는다 */
type TrackData = { tracks: QueuedTrack[]; isPlaylist?: boolean; collection?: string | null; insertFirst?: boolean; insertAfterId?: string | null; total?: number | null; skipped?: number; queueLimited?: boolean };
/** 담은 결과. 실패면 code 가 까닭(로그), message 가 안내. 던진 것이면 그 오류의 종류(kind) */
type AddResult = { success: true; dropped?: number; queueLimited?: boolean } | { success: false; code: string; message: string; kind?: string; dropped?: number };

// 곡 담기(queueTracks). 입구를 거쳐 부르는 시험은 useAdder 로 가짜를 넘긴다(useLookup 과 같다)
let defaultAdder: typeof queueTracks = (...args) => queueTracks(...args);
function useAdder(fake: typeof queueTracks | null | undefined) {
  defaultAdder = fake ?? ((...args) => queueTracks(...args));
}

/** 곡을 넣을 목록. 찾은 결과거나 이미 찾은 곡 */
// skipped: 출처가 받을 수 없어 뺀 곡 수(사운드클라우드 세트의 미리듣기 · 지역 제한)
type Found = { isPlaylist: boolean; collection?: string | null; collectionId?: string | null; tracks: TrackInfo[]; total?: number | null; nextOffset?: number | null; skipped?: number; queueLimited?: boolean };

async function requestPlayback(client: Client, request: PlaybackRequest): Promise<PlaybackResult> {
  const { guild, insertFirst = false, responder = silentResponder } = request;
  // 재생목록을 넣을 때 한 번에 들어가는 곡 수. 서버 설정(출처가 더 작게 자르면 그쪽), 더 넣기 선택지 단위이기도 하다
  const batch = batchFor(request.query, GuildSettingsManager.resolvePlaylistAddMax(guild.id));

  // 곡을 찾은 뒤에 플레이어를 만든다. 먼저 만들면 못 찾았을 때 연결도 곡도 없는 플레이어가 등록부에 남는다
  const checked = await tracksFor(client.players.get(guild.id) ?? null, request, batch);
  const who = toRequester(request.requester);
  logRequest(request, who, isRefused(checked) ? checked : trimmed(checked, request.single));
  if (isRefused(checked)) return { success: false, message: checked.message, code: checked.code };
  const player = await playerFor(client, request);

  // 끝이 없는 것은 반복할 수 없다. 라이브가 들어오면 걸려 있던 반복을 푼다.
  if (checked.tracks.some((t) => t.isLive)) player.releaseLoopForLive();

  const trackData = trimmed(checked, request.single);
  withKnownLengths(trackData.tracks);
  const toAdd: TrackData = { ...trackData, ...placement(request) };

  const result = await defaultAdder(client, guild.id, toAdd, who, responder);
  logOutcome(result, player);

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
// 플레이어가 아직 없으면(곡을 찾은 뒤에 만든다) 빈 대기열로 센다
async function tracksFor(player: Player | null, request: PlaybackRequest, batch: number): Promise<Found | Refused> {
  const found = request.tracks ? { isPlaylist: request.tracks.length > 1, collection: request.collection ?? null, tracks: request.tracks } : await search(player, request.query, request, batch);
  return isRefused(found) ? found : withoutBlocked(found, request.ffmpegReady);
}

async function search(player: Player | null, query: string, { single = false, source = "play", lookup = defaultLookup }: PlaybackRequest, batch: number): Promise<Found | Refused> {
  // 받을 곡 수. 한 번에 넣는 묶음과 남은 자리 중 작은 쪽. 비어 있으면 첫 곡은 현재곡이 되니 한 자리 더.
  // 어림값이다: 최종 판정은 서버별로 줄 선 추가 구간이 한다. 가득 차도 한 곡은 받아 그쪽이 실패를 알리게 한다.
  const room = trackState.roomLeft(player ?? { queue: [] }, config.bot.maxQueueSize) + (player?.currentTrack ? 0 : 1);
  const limit = single ? 1 : Math.max(1, Math.min(batch, room));
  // 로그의 하위 이름. 입구 이름의 "/"(슬래시 명령)는 뺀다. 카테고리와 "/" 로 이어 붙여 track//play 가 됐다
  const found = await lookup.resolveQuery(query, `${source.replace(/^\//, "")}.resolveQuery`, { limit });
  // 곡 찾기가 던진 것(lookup-failed)은 곡 찾기가 원문과 함께 이미 남겼다. 여기서는 까닭과 종류만
  if (!found.success) return { code: found.code, message: lookupFailureMessage(found), ...kindOf(found.error) };

  // 자리가 모자라 덜 받았는데 뒤에 곡이 더 있으면 알린다 (총 곡 수를 모르면 요청한 만큼 왔는지로 본다)
  const more = found.total == null ? found.tracks.length >= limit : found.total > found.tracks.length;
  return !single && found.isPlaylist && room < batch && more ? { ...found, queueLimited: true } : found;
}

// 방송 중인 라이브는 주소를 ffmpeg에 넘기는 갈래로 재생한다. 막는 것은 두 가지뿐이다.
// 아직 시작하지 않은 방송(틀 것이 없다)과, 그 갈래를 열 수 없는 ffmpeg 빌드.
// 조용히 버리면 아무 반응이 없는 것처럼 보이므로, 넣기 전에 걸러내고 이유를 알린다.
function withoutBlocked(found: Found, ffmpegReady = () => ffmpegCapabilities().ok): Found | Refused {
  const blocked = found.tracks.map((t) => liveBlock(t, ffmpegReady));
  const firstBlock = blocked.find((why): why is Refused => Boolean(why));
  if (!firstBlock) return found;
  const playable = found.tracks.filter((_, i) => !blocked[i]);
  // 전부 막혔으면 처음 막힌 까닭을 알린다
  return playable.length === 0 ? firstBlock : { ...found, tracks: playable };
}

// 곡 길이는 처음 보일 때 정해진다(rules/durationShown). 받아 둔 음원이 있으면 출처가 준 길이 대신 그 음원을 잰 길이를 보인다.
// 스포티파이 곡은 스포티파이 길이를 들고 오는데, 틀 음원(찾아 둔 유튜브 영상)과 수 초씩 다를 수 있다
function withKnownLengths(tracks: TrackInfo[]) {
  for (const track of tracks) {
    if (track.isLive) continue;
    const sec = trackLookup.knownAudioLength(track);
    if (sec) Object.assign(track, { duration: sec, durationSource: "measured" });
  }
}

// 재생목록에서 첫 곡만 (대시보드의 "한 곡만" 옵션)
function trimmed(found: Found, single = false): Found {
  return single && found.tracks.length > 1 ? { ...found, isPlaylist: false, collection: null, tracks: found.tracks.slice(0, 1) } : found;
}

// 넣을 자리. 적힌 것만 싣는다
function placement({ insertFirst = false, insertAfterId = null }: PlaybackRequest) {
  return { ...(insertFirst ? { insertFirst: true } : {}), ...(insertAfterId ? { insertAfterId } : {}) };
}

// 조작 하나에 info 한 줄: 누가 무엇을 찾아 무엇이 골라졌나. 틀거나 넣기 전에 남겨, 곧바로 튼 곡의 "재생" 줄보다 앞선다
function logRequest({ source = "play", query, insertFirst = false }: PlaybackRequest, who: Requester | null, found: Found | Refused) {
  const asked = query ?? null;
  const head = `곡 요청: ${source} | ${nameOf(who)}${asked ? ` | "${asked}"` : ""}`;
  if (isRefused(found)) {
    log.info({ sub: "play" }, `${head} → 못 넣음: ${causeOf(found)}`);
    return;
  }
  const notes = [insertFirst ? " | 맨 앞" : "", found.skipped ? ` | 받을 수 없어 ${found.skipped}곡 뺌` : "", found.queueLimited ? " | 자리가 모자라 일부만 받음" : ""].join("");
  log.info({ sub: "play" }, `${head} → ${whatOf(found, asked)}${notes}`);
}

// 찾은 것. 목록이면 출처와 곡 수, 한 곡이면 제목. 주소로 요청하지 않았으면 고른 곡의 주소를 붙인다
function whatOf({ isPlaylist, collection, tracks }: Found, asked: string | null) {
  const first = tracks[0];
  const title = first?.title ?? "?";
  if (isPlaylist) return `${S.collectionLabel(collection)} ${tracks.length}곡 (첫 곡 "${title}")`;
  return first && !(asked && isUrl(asked)) ? `"${title}" (${first.pageUrl})` : `"${title}"`;
}

const isUrl = (text: string) => /^https?:\/\//i.test(text.trim());

// 담은 뒤. 못 담았으면 그 까닭을 info 로. 담았으면 대기열 상태는 추적용이라 debug 로(곧바로 튼 곡은 "재생" 줄이 말한다).
// 상한으로 일부를 뺀 것도 담긴 것이라 debug 줄에 싣는다. 사용자에게는 담은 안내가 말한다
function logOutcome(result: AddResult, player: Player) {
  if (result.success === false) log.info({ sub: "play" }, `곡 담기 실패: ${causeOf(result)}`);
  else log.debug({ sub: "play" }, `곡 담기 끝${result.dropped ? ` | 상한으로 ${result.dropped}곡 뺌` : ""} | 대기열 ${player.queue.length}곡`);
}

const nameOf = (who: Requester | null) => who?.tag ?? who?.username ?? who?.id ?? "?";
/** 로그에 적을 요청자 이름. 곡 요청 줄과 같게 */
const requesterName = (source: RequesterSource) => nameOf(toRequester(source));

const MORE_BATCH = 100;

/**
 * 재생목록 이어 넣기. 디스코드 메뉴와 대시보드가 같이 쓴다.
 *
 * 받는 곡 수는 누른 시점의 남은 자리와 출처의 한 번 상한으로 다시 자른다. 앵커(직전 마지막 곡)를 찾으려고 출처의 lookback 만큼 앞에서부터
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
  const want = Math.min(request.count, roomFor(player), KINDS[state.kind].perClick);
  if (want <= 0) return { success: false, message: client.panels.queueFullMessage() };

  const { found, cursor, total, skipped } = await gather(request, want);

  // 앵커가 앞당겨져 더 받았으면 넘친 만큼 되돌린다. 다음 이어 받기는 앵커가 바로잡는다
  const tracks = found.slice(0, want);
  if (tracks.length === 0) return { success: false, message: skipped > 0 ? `받을 수 없는 곡(미리듣기 · 지역 제한 등)뿐이라 넣지 못했어요(${skipped}곡).` : "더 넣을 곡을 찾지 못했어요." };
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
  const batch = Math.min(GuildSettingsManager.resolvePlaylistAddMax(guild.id), KINDS[state.kind].perClick);
  return { ...result, added: tracks.length - (result.dropped || 0), skipped, total, remaining, next: next && total != null ? { ...next, total, remaining, batch } : null };
}

// 한 구간을 받는다. 앞서 모은 곡이 있으면 실패는 거기서 멈춤(null)으로, 하나도 없으면 까닭을 던진다
async function nextPart(lookup: Lookup, url: string, range: { offset: number; limit: number }, gathered: number) {
  try {
    return await lookup.getCollection(url, range);
  } catch (error) {
    if (gathered === 0) throw error;
    log.warn(`이어 받기를 ${gathered}곡에서 멈춥니다: ${messageOf(error)}`);
    return null;
  }
}

// 받은 구간에서 새 곡. 앵커(직전 마지막 곡)를 찾으면 그 뒤, 못 찾으면 다시 받은 앞 back 곡을 건너뛴 뒤
function freshOf(tracks: TrackInfo[], anchor: string | undefined, back: number) {
  const hit = tracks.findIndex((t) => t.id === anchor);
  return hit >= 0 ? tracks.slice(hit + 1) : tracks.slice(back);
}

// 목록 끝까지 왔나(전체 곡 수를 모르면 아니다)
const atEnd = (cursor: number, total: number | null) => total != null && cursor >= total;

// 목록에서 want 곡을 묶음으로 나눠 받는다. 앵커를 찾으면 그 뒤부터, 못 찾으면 요청 위치부터
async function gather({ state, onProgress = ignoreProgress, lookup = defaultLookup }: CollectionRequest, want: number) {
  const { url: urlOf, lookback, reads } = KINDS[state.kind];
  const url = urlOf(state.listId);
  const found: TrackInfo[] = [];
  let cursor = state.offset;
  let anchor: string | undefined = state.anchorId;
  let total: number | null = null;
  let skipped = 0;
  for (let read = 0; found.length < want && read < reads; read++) {
    const back = Math.min(lookback, cursor);
    const limit = Math.min(MORE_BATCH, want - found.length) + back;
    const part = await nextPart(lookup, url, { offset: cursor - back, limit }, found.length);
    if (!part) break;
    if (part.total != null) total = part.total;
    skipped += part.skipped ?? 0;
    const fresh = freshOf(part.tracks, anchor, back);
    found.push(...fresh);
    anchor = fresh.at(-1)?.id ?? anchor;
    const next = part.nextOffset;
    const advanced = next != null && next > cursor;
    if (advanced) cursor = next;
    onProgress(Math.min(found.length, want), want);
    if (fresh.length === 0 || !advanced || atEnd(cursor, total)) break;
  }
  return { found, cursor, total, skipped };
}

// ── 곡 담기 ───────────────────────────────────────────────────────────

/** 곡 담기에서 부르는 패널(그리기만) */
type Panel = Pick<NowPlayingPanel, "postPlaying" | "updatePlaying" | "showPlaylistAdditionMessage" | "createQueueAdditionMessage" | "queueFullMessage">;
/** 패널을 세운 결과. 세우지 못해도 재생은 성공이다 */
type Opened = { success: true };
/** 쉬던 플레이어에 첫 곡을 튼 결과. opened 패널까지 세웠다, failure 시작 실패(까닭과 안내), started 곧바로 튼 곡 */
type FirstStart = { opened: Opened | null; failure: Refused | null; started?: QueuedTrack };
/** 대기열에 담은 것과 안내에 붙일 것 */
type Addition = { queued: QueuedTrack[]; sourceLabel: string | null; insertFirst: boolean; notice: { dropped: number; skipped: number; total: number | null; queueLimited: boolean } };

// 서버마다 한 번에 하나. 앞 작업의 꼬리에 잇는다. get 과 set 사이에 await 가 없어 끼어들 틈이 없고, 정리도 자기 항목일 때만 한다
const adding = new Map<string, Promise<AddResult>>();

/** 곡을 서버의 플레이어에 담는다. 쉬고 있으면 첫 곡을 틀고 패널을 세우고, 나머지는 대기열에. responder: 결과를 알릴 매체 */
function queueTracks(client: Client, guildId: string, trackData: TrackData, requester: Requester | null, responder: Responder = silentResponder) {
  const tail = adding.get(guildId) || Promise.resolve();
  const task = tail
    .catch(() => {
      /* 앞 작업의 실패는 그 호출자가 받는다. 뒤 작업까지 실패시키지 않는다 */
    })
    .then(() => processTracks(client, guildId, trackData, requester, responder));
  adding.set(guildId, task);

  return task.finally(() => {
    if (adding.get(guildId) === task) adding.delete(guildId);
  });
}

async function processTracks(client: Client, guildId: string, trackData: TrackData, requester: Requester | null, responder: Responder): Promise<AddResult> {
  const player = client.players.get(guildId);
  if (!player) return { success: false, code: "no-player", message: "음악 플레이어를 찾을 수 없습니다." };
  try {
    return await place(client.panels, player, trackData, requester, responder);
  } catch (error) {
    log.error({ kind: errorKind(error) }, "곡 담기 처리 실패:", error);
    return { success: false, code: "threw", message: "음악을 처리하는 중 오류가 발생했습니다.", ...kindOf(error) };
  }
}

// 이번에 넣은 곡 전부. 곧바로 튼 첫 곡도 센다(재생목록에서 50곡을 받았으면 안내도 50곡).
// 첫 곡이 실패해 다음 곡으로 살렸으면 그 곡은 이미 대기열 몫에 들어 있다
const placedOf = (start: FirstStart, queued: QueuedTrack[]) => (start.started ? [start.started, ...queued] : queued);

async function place(panel: Panel, player: Player, trackData: TrackData, requester: Requester | null, responder: Responder): Promise<AddResult> {
  const wasPlayingBefore = player.currentTrack !== null;
  const { tracks } = trackData;
  const stamp = (track: QueuedTrack): QueuedTrack => ({ ...track, requestedBy: requester, addedAt: Date.now() });

  // 첫 번째 트랙이고 플레이어가 유휴 상태이면 재생 시작
  const wasIdle = !player.currentTrack && player.queue.length === 0 && tracks.length > 0;
  const start = wasIdle ? await startFirst(panel, player, stamp(tracks[0]), responder) : { opened: null, failure: null };
  const addition = enqueue(player, trackData, (wasIdle ? tracks.slice(1) : tracks).map(stamp));
  // 첫 곡이 실패했지만 대기열에 다음 곡이 있으면(재생목록) 다음 곡부터 재생 시도.
  const opened = start.failure ? await startNext(panel, player, responder) : start.opened;

  // 첫 곡 실패 + 되살릴 것 없음 → 실패 반환(명령 editReply / 대시보드 응답 / 메시지 답장이 사용자에게 표기).
  if (start.failure && !opened) return { success: false, ...start.failure };

  // 첫 번째 트랙이 재생을 시작했고 재생목록에 남은 트랙이 있음
  if (opened && tracks.length > 1) {
    // 남은 재생목록 트랙이 대기열에 추가되었음을 메시지로 표시
    await panel.showPlaylistAdditionMessage(player, placedOf(start, addition.queued), addition.sourceLabel, addition.insertFirst, addition.notice);
    // 대기열 갱신. 임베드 새로고침
    await panel.updatePlaying(player);
    return { ...opened, dropped: addition.notice.dropped, queueLimited: addition.notice.queueLimited };
  }

  // 대기열에만 추가됨 (이미 음악 재생 중)
  if (wasPlayingBefore || (!opened && tracks.length > 0)) {
    return await queueOnly(panel, player, responder, addition);
  }

  // 단일 트랙 재생 시작
  return opened ?? { success: true };
}

// 쉬던 플레이어에 첫 곡을 튼다
async function startFirst(panel: Panel, player: Player, track: QueuedTrack, responder: Responder): Promise<FirstStart> {
  trackState.setCurrent(player, track);
  const failure = await startPlayback(player);
  if (failure) {
    // 시작 실패. 유령 임베드 만들지 않음. 실패한 곡은 큐에 넣지 않는다(재시도해도 실패).
    trackState.setCurrent(player, null);
    return { opened: null, failure };
  }
  return { opened: await openPanel(panel, player, track, responder), failure: null, started: track };
}

// 음성 채널에 연결하고 재생 시작. 실패면 그 까닭(play 의 code, 던졌으면 threw)
async function startPlayback(player: Player): Promise<Refused | null> {
  try {
    if (!player.connection) {
      await player.voice.connect();
    }
    const playResult = await player.play();
    // play()는 실패를 throw가 아니라 {success:false}로 알린다. 이걸 무시하면
    // 재생이 안 됐는데도 아래에서 now-playing 임베드를 만들어 '유령 재생'이 된다.
    if (playResult && playResult.ok === false) return { code: playResult.code ?? "play-failed", message: playFailureMessage(playResult), ...kindOf(playResult.error) };
    return null;
  } catch (playError) {
    log.error("재생 처리 중 오류:", playError);
    return { code: "threw", message: errorMessage(playError), ...kindOf(playError) };
  }
}

// 첫 곡이 실패한 뒤 대기열의 다음 곡을 튼다. 틀었으면 패널을 세운 결과
async function startNext(panel: Panel, player: Player, responder: Responder): Promise<Opened | null> {
  if (player.currentTrack || player.queue.length === 0) return null;
  try {
    const nextResult = await player.play(0);
    if (nextResult && nextResult.ok !== false && player.currentTrack) {
      return await openPanel(panel, player, player.currentTrack, responder);
    }
  } catch (e) {
    log.error("첫 곡 실패 후 다음 곡 시작 실패:", messageOf(e));
  }
  return null;
}

// UI 실패가 재생 상태를 망가뜨리면 안 됨. 임베드를 생성할 수 없어도(예: CV2 수정 제한) 재생은 계속 진행
async function openPanel(panel: Panel, player: Player, track: QueuedTrack, responder: Responder): Promise<Opened> {
  try {
    return await panel.postPlaying(player, track, responder);
  } catch (embedError) {
    log.error("재생 중 임베드 생성 실패:", embedError);
    return { success: true };
  }
}

// 대기열에 넣는다. 상한은 여기서 판정한다. 해석이 끝난 뒤 서버별로 줄 선 구간이라, 동시에 온 목록이 같은 빈자리를 두 번 쓰지 않는다
function enqueue(player: Player, trackData: TrackData, tracks: QueuedTrack[]): Addition {
  const queued = tracks.slice(0, trackState.roomLeft(player, config.bot.maxQueueSize));
  const insertFirst = trackData.insertFirst || false;
  if (trackData.insertAfterId) trackState.insertAfter(player, trackData.insertAfterId, queued);
  else if (insertFirst) trackState.enqueue(player, queued, { front: true });
  // 자동재생이 미리 뽑아 둔 곡보다는 앞에. 사용자가 고른 곡이 먼저다
  else trackState.enqueueAheadOfAutoplay(player, queued);
  const received = trackData.tracks.length;
  return {
    queued,
    // 여러 곡을 담았으면 그 출처의 표시 이름(재생목록·앨범 등), 한 곡이면 null
    sourceLabel: trackData.isPlaylist ? S.collectionLabel(trackData.collection) : null,
    insertFirst,
    // 안내에 붙일 것. 전체 곡 수는 받은 것보다 많을 때만
    notice: { dropped: tracks.length - queued.length, skipped: trackData.skipped ?? 0, total: trackData.total && trackData.total > received ? trackData.total : null, queueLimited: Boolean(trackData.queueLimited) },
  };
}

// 틀고 있는 중에 대기열에만 담았다
async function queueOnly(panel: Panel, player: Player, responder: Responder, { queued, sourceLabel, insertFirst, notice }: Addition): Promise<AddResult> {
  // 자리가 없어 한 곡도 못 담았다
  if (queued.length === 0 && notice.dropped > 0) return { success: false, code: "queue-full", message: panel.queueFullMessage(), dropped: notice.dropped };

  // 기존 임베드 갱신
  if (player.nowPlayingMessage && player.currentTrack) {
    await panel.updatePlaying(player);
  }

  await responder.notifyQueued(panel.createQueueAdditionMessage(queued, sourceLabel, insertFirst, notice));

  return { success: true, dropped: notice.dropped, queueLimited: notice.queueLimited };
}

export { requestPlayback, continueCollection, queueTracks, toRequester, requesterName, ensurePlayer, useLookup, useAdder };
export const _internals = { resolveFallbackTextChannel };
export type { PlaybackRequest, RequesterSource, Lookup, CollectionResult, TrackData, AddResult };
