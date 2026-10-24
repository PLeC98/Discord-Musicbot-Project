// 곡 찾기. 링크나 검색어 → 트랙 정보(메타데이터). 여러 곡 출처는 구간만 불러온다.

import * as YouTube from "./youtube/index.ts";
import type { TrackInfo } from "../player/track.ts";
import * as links from "../rules/links.ts";
import * as Spotify from "./spotify.ts";
import * as SoundCloud from "./soundcloud/index.ts";
import * as DirectLink from "./direct.ts";
import { applyTags } from "./direct-tags.ts";
import * as trackLookup from "../store/track-lookup.ts";
import * as pinnedSources from "../store/pinned-sources.ts";
import type { Pin } from "../store/pinned-sources.ts";
import { errorKind, messageOf, codeOf } from "../rules/error-kind.ts";
import { failureReason } from "../rules/failure-reason.ts";
import type { CacheHit } from "../store/track-lookup.ts";
import { inputKind } from "../rules/input-kind.ts";
import logger from "../infra/log/logger.ts";
import { logTitle } from "../infra/log/title.ts";
const log = logger.child({ category: "track" });

/** 소스가 찾은 곡. 소스마다 필드가 더 있다. 트랙 모델(player/track)의 TrackInfo 에 맞추는 것은 player 를 TS 로 옮길 때 */
type FoundTrack = TrackInfo;
/** 여러 곡 출처에서 불러올 구간 */
type Range = { offset?: number; limit?: number };
/** 여러 곡 출처의 한 구간. 소스가 준 그대로라 필드가 빠질 수 있다. total 은 모르면 null, skipped 는 받을 수 없어 뺀 곡 수 */
type Collection = { tracks: FoundTrack[]; total?: number | null; nextOffset?: number | null; skipped?: number };
/** 찾은 결과. 못 찾았으면 그 까닭(code), 던졌으면 그 오류(error) */
// 두 경우가 서로의 필드를 undefined 로 가져 success 로 좁히기 전에도 읽을 수 있다
// collectionId: 이어 불러올 때 목록을 부를 id(주소만으로는 모르는 출처. 사운드클라우드 세트의 숫자 id)
/** 곡을 찾지 못한 까닭. 로그에 적고, 사용자 문장은 ui/error-messages 가 선택한다 */
type LookupRefusal = "no-song-result" | "lookup-failed" | "yt-unplayable" | "unsupported-link" | "shoutcast-v1" | "sc-unsupported" | "nothing-playable";
type LookupResult = { success: true; isPlaylist: boolean; collection?: string | null; collectionId?: string | null; tracks: FoundTrack[]; total?: number | null; nextOffset?: number | null; skipped?: number; code?: undefined; error?: undefined } | { success: false; code: LookupRefusal; error?: unknown; skipped?: number; isPlaylist?: undefined; collection?: undefined; collectionId?: undefined; tracks?: undefined; total?: undefined; nextOffset?: undefined };
/** 곡을 찾는 소스들. 여기서 부르는 것만. 테스트가 가짜를 넘긴다. 넘기지 않은 소스는 진짜 */
type Sources = {
  youtube: { getPlaylist(url: string, range?: Range): Promise<Collection | null>; search(query: string, limit: number): Promise<FoundTrack[]> };
  spotify: { getCollection(url: string, range?: Range): Promise<Collection> };
  soundcloud: { find(url: string, range?: Range & { what?: "track" | "set" }): Promise<SoundCloud.Found> };
  direct: { getInfo(url: string, opts?: Pick<DirectLink.InfoOptions, "tags">): Promise<FoundTrack[]> };
};
const REAL: Sources = { youtube: YouTube, spotify: Spotify, soundcloud: SoundCloud, direct: DirectLink };

// 쿼리 문자열이 어느 쪽으로 가나. 링크가 아닌 글은 유튜브에서 찾는다. 모르는 링크는 unknown(거절)
function detectPlatform(query: string) {
  const kind = inputKind(query);
  return kind === "search" ? "youtube" : kind;
}

/**
 * 우리가 다루지 않는 링크인가(유튜브 클립 · 채널 · 검색 결과 페이지, 스포티파이 에피소드 같은 알려진 사이트의 다른 주소).
 *
 * 이런 주소를 검색으로 흘리면 URL 문자열 자체가 검색어가 되어 엉뚱한 영상이 재생되기에 재생을 거절한다.
 * (클립은 유튜브가 없앤 기능이라 지원 대상이 아니다.)
 */
function isUnsupportedLink(query: string): boolean {
  return inputKind(query) === "unknown";
}

// 쿼리 → { success, isPlaylist, collection, tracks, total, nextOffset } 또는 { success: false, code, error? }
//   code: no-song-result(찾은 것이 없다) · lookup-failed(error: 조회가 던진 오류). 문장은 부르는 쪽이 ui/error-messages 로 만든다
// collection: 여러 곡을 담은 출처의 종류. "playlist" | "album" | "artist", 한 곡이면 null
// range: 여러 곡 출처에서 불러올 구간 { offset, limit }. 한 곡이면 무시. total은 모르면 null.
/** 찾은 곡들과 그 출처. 한 곡이면 collection · total · nextOffset 이 null */
type Found = { tracks: FoundTrack[]; isPlaylist: boolean; collection: string | null; collectionId?: string | null; total: number | null; nextOffset: number | null; skipped?: number };
const single = (tracks: FoundTrack[] | null | undefined): Found => ({ tracks: tracks || [], isPlaylist: false, collection: null, total: null, nextOffset: null });

// 유튜브. 재생목록 주소가 영상도 가리키면(watch?v=…&list=…) 목록을 못 불러올 때 그 영상 하나로 간다.
// 목록만 가리키는 주소는 목록이 비면 없음, 목록을 못 불러오면 그 까닭을 그대로 던진다
async function fromYouTube(query: string, range: Range, youtube: Sources["youtube"]): Promise<Found> {
  if (links.isYouTubePlaylist(query)) {
    const video = links.extractVideoId(query);
    let list: Collection | null;
    try {
      list = await youtube.getPlaylist(query, range);
    } catch (error) {
      if (!video) throw error;
      log.warn(`재생목록을 불러오지 못해 영상 하나로 갑니다: ${messageOf(error).split("\n")[0]}`);
      return single(await youtube.search(query, 1));
    }
    if (list?.tracks?.length) return { tracks: list.tracks, isPlaylist: true, collection: "playlist", total: list.total ?? null, nextOffset: list.nextOffset ?? null };
    if (!video) return single([]);
    // yt-dlp 가 비공개 · 개인 목록(LL 등)을 알아보지 못하면 영상 하나만 준다
    log.info(`재생목록이 비었거나 열리지 않아 영상 하나로 갑니다 (${video})`);
  }
  return single(await youtube.search(query, 1));
}

// 스포티파이 링크(곡 · 앨범 · 재생목록 · 아티스트). 링크가 아닌 글은 유튜브로 간다(detectPlatform)
async function fromSpotify(query: string, range: Range, spotify: Sources["spotify"]): Promise<Found> {
  const part = await spotify.getCollection(query, range);
  const { type } = links.parseSpotifyURL(query);
  const isPlaylist = type === "playlist" || type === "album" || type === "artist";
  if (!isPlaylist) return single(part.tracks);
  return { tracks: part.tracks || [], isPlaylist, collection: type, total: part.total ?? null, nextOffset: part.nextOffset ?? null };
}

// 사운드클라우드 링크(곡 · 세트 · 짧은 링크). 세트는 한 구간만(출처가 10곡으로 자른다), 받을 수 없는 곡은 빼고 센다.
// 비밀 공유 세트는 숫자 id 만으로 다시 부를 수 없어 이어 불러오기를 권하지 않는다
async function fromSoundCloud(query: string, range: Range, soundcloud: Sources["soundcloud"]): Promise<Found> {
  const found = await soundcloud.find(query, { ...range, what: links.parseSoundCloudURL(query) === "set" ? "set" : "track" });
  if (found.kind === "track") return single([found.track]);
  const { skipped } = found;
  if (skipped > 0) log.info(`사운드클라우드 세트에서 받을 수 없는 ${skipped}곡을 뺍니다(미리듣기 · 지역 제한 등): ${found.title ?? query}`);
  const secret = /\/s-[\w-]+\/?$/.test(new URL(query).pathname);
  return { tracks: found.tracks, isPlaylist: true, collection: "playlist", collectionId: secret ? null : found.setId, total: found.total, nextOffset: found.nextOffset, skipped };
}

// 링크 종류마다 부르는 곳. 직접 링크는 tags 면 파일 태그(제목 · 가수 · 앨범)로 곡 정보를 고친다
function findOn(platform: string, query: string, range: Range, { youtube, spotify, soundcloud, direct }: Sources, tags: boolean): Promise<Found> {
  if (platform === "youtube") return fromYouTube(query, range, youtube);
  if (platform === "spotify") return fromSpotify(query, range, spotify);
  if (platform === "soundcloud") return fromSoundCloud(query, range, soundcloud);
  return direct.getInfo(query, tags ? { tags: applyTags } : {}).then(single); // 배열 계약: [track] 또는 []
}

/** tags: 직접 링크의 파일 태그를 곡 정보로 쓰나(직접 지정한 음원을 읽을 때는 쓰지 않는다. 곡 정보는 요청의 것) */
async function getTrackData(query: string, context: string | null = "lookup.getTrackData", { offset = 0, limit }: Range = {}, sources: Partial<Sources> = {}, options: { tags?: boolean } = {}): Promise<LookupResult> {
  const platform = detectPlatform(query);
  if (platform === "unknown") return links.isYouTubeHost(query) ? { success: false, code: "yt-unplayable" } : { success: false, code: "unsupported-link" };
  // 프로필 · 좋아요 같은 모음은 곡으로 잘못 읽지 않는다
  if (platform === "soundcloud" && links.parseSoundCloudURL(query) === "other") return { success: false, code: "sc-unsupported" };
  try {
    const found = await findOn(platform, query, { offset, limit }, { ...REAL, ...sources }, options.tags !== false);
    // 불러온 구간에 틀 수 있는 곡이 하나도 없는 세트는 뺀 까닭(nothing-playable)과 뺀 곡 수를 알린다
    if (!found.tracks.length) return found.skipped ? { success: false, code: "nothing-playable", skipped: found.skipped } : { success: false, code: "no-song-result" };
    return { success: true, ...found };
  } catch (error) {
    return lookupFailed(error, context);
  }
}

// 찾다가 던졌다. 열어 보니 음원이 아닌 직접 링크(웹 페이지 등)는 실패가 아니라 지원하지 않는 링크다
function lookupFailed(error: unknown, context: string | null): LookupResult {
  // 열어 보니 받을 수 없는 링크(음원이 아님 · 옛 SHOUTcast). 실패가 아니라 그 까닭으로 거절한다
  const code = codeOf(error);
  if (code === "unsupported-link" || code === "shoutcast-v1") {
    log.debug({ sub: context || undefined }, `받을 수 없는 링크: ${messageOf(error)}`);
    return { success: false, code };
  }
  // 한 줄에는 무엇이 막았는지만. 원문(yt-dlp 의 WARNING 줄 포함)은 조사할 때 본다
  log.error({ sub: context || undefined, kind: errorKind(error) }, `곡 찾기 실패: ${failureReason(error, YouTube.cookiesConfigured())}`);
  log.debug({ sub: context || undefined }, `곡 찾기 실패 원문: ${YouTube.briefError(error)}`);
  return { success: false, code: "lookup-failed", error };
}

// 여러 곡 출처의 구간만. 이어 넣기용. getTrackData와 달리 못 불러오면 검색으로 넘어가지 않고 던진다
// (유튜브는 목록 끝을 넘는 구간이면 항목이 비어 getPlaylist가 null이다. 그건 없음이다).
async function getCollection(url: string, range?: Range, sources: Partial<Sources> = {}): Promise<Collection> {
  const { youtube, spotify, soundcloud } = { ...REAL, ...sources };
  const none: Collection = { tracks: [], total: null, nextOffset: null };
  if (links.isYouTubePlaylist(url)) {
    const r = await youtube.getPlaylist(url, range);
    return r ? { tracks: r.tracks, total: r.total ?? null, nextOffset: r.nextOffset ?? null } : none;
  }
  if (links.isSpotifyURL(url)) return spotify.getCollection(url, range);
  if (links.parseSoundCloudURL(url) === "set") {
    const found = await soundcloud.find(url, { ...range, what: "set" });
    return found.kind === "set" ? { tracks: found.tracks, total: found.total, nextOffset: found.nextOffset, skipped: found.skipped } : none;
  }
  return none;
}

/**
 * 캐시 숏컷 포함 해석. 캐시된 단일 곡은 yt-dlp 호출 없이 즉시 반환.
 * 재생목록 URL은 캐시를 우회: URL 정규화가 list=를 제거하므로 캐시된 단일 영상이 재생목록 전체를 가릴 수 있음.
 * 사운드클라우드도 곡 링크만 캐시를 본다(세트 · 곡인지 모르는 짧은 링크 · 모음은 우회).
 * 지원하지 않는 링크(유튜브 클립 등)도 우회한다. 검색으로 흘러 잘못 맺힌 매핑이 캐시에 있으면
 * 그 엉뚱한 영상을 그대로 돌려주기 때문이다. 같은 까닭으로 직접 링크는 음원이 요청 그대로인 행만 쓴다.
 */
async function resolveQuery(query: string, context?: string | null, range: Range = {}, sources: Partial<Sources> = {}): Promise<LookupResult> {
  const soundcloud = links.parseSoundCloudURL(query);
  const skipCache = links.isYouTubePlaylist(query) || isUnsupportedLink(query) || (soundcloud !== null && soundcloud !== "track");
  // 운영자가 직접 지정한 음원이 링크 데이터 · 원래 링크보다 앞선다. 원래 영상이 죽었어도 곡을 만든다.
  // 같은 skipCache 를 따른다(canonicalUrl 이 watch?v=X&list=Y 를 영상 하나로 줄여 재생목록이 지정 하나로 바뀌지 않게)
  const pin = skipCache ? null : pinnedSources.getPin(query);
  if (pin) return { success: true, isPlaylist: false, tracks: [await pinnedTrack(query, pin, context, sources)] };
  const cacheHit: CacheHit = skipCache ? { hit: false } : trackLookup.resolveFromCache(query);
  if (cacheHit.hit && (inputKind(query) !== "direct" || cacheHit.track.audioFoundBy === "given")) {
    log.debug(`캐시 히트(조회 · 검색 생략): "${logTitle(cacheHit.track.title)}" → ${cacheHit.track.audioUrl}`);
    return { success: true, isPlaylist: false, tracks: [cacheHit.track] };
  }
  return getTrackData(query, context, range, sources);
}

/**
 * 직접 지정한 음원으로 곡을 만든다. 곡 정보(요청 키 · 제목 · 아티스트)는 요청의 것이다: 링크 데이터가 기억하는 표시 정보, 없으면 원래 링크를 읽고,
 * 그것도 못 읽으면(원래 영상이 죽었다) 지정한 음원에서 읽은 제목. 음원 주소 · 길이 · 라이브 표시는 applyPin 이 정한다
 */
async function pinnedTrack(query: string, pin: Pin, context: string | null | undefined, sources: Partial<Sources>): Promise<FoundTrack> {
  const known = trackLookup.displayOf(query);
  let track: FoundTrack | null = known ? { ...known, duration: 0 } : null;
  if (!track) {
    const original = await getTrackData(query, context, {}, sources);
    track = original.success ? original.tracks[0] : null;
  }
  if (!track) {
    const audio = await getTrackData(pin.audioUrl, context, {}, sources, { tags: false });
    const from = audio.success ? audio.tracks[0] : null;
    track = { title: from?.title ?? null, artist: from?.artist, thumbnail: from?.thumbnail ?? null, pageUrl: query, requestKey: pin.requestKey, platform: detectPlatform(query), duration: 0 };
  }
  pinnedSources.applyPin(track, pin);
  log.debug(`직접 지정한 음원(조회 생략): "${logTitle(track.title)}" → ${track.audioUrl ?? "없음"}`);
  return track;
}

export { detectPlatform, isUnsupportedLink, getTrackData, getCollection, resolveQuery };

export type { FoundTrack, Range, Collection, Sources, LookupResult };
