// 유튜브 글자 검색. yt-dlp 를 띄우지 않고 유튜브 내부 API 를 youtubei.js 로 부른다(0.5초 안팎이라 자동완성의 3초 마감에 든다).
// 세션 하나를 다시 쓰고, 같은 검색어는 잠시 기억하고, 같은 검색어로 동시에 오면 한 번만 묻는다. 한꺼번에 나가는 검색 수는 상한이 있다.
// 언어는 en, 지역은 비워 유튜브가 IP 로 정한 값을 쓴다(yt-dlp 검색과 같은 순위, 제목). 창작자가 영어 제목을 달아 둔 영상은 영어 제목이라,
// 곡을 넣을 때 yt-dlp 가 읽는 제목(원래 언어)과 다를 수 있다

import { Innertube, Log, YTNodes } from "youtubei.js";
import logger from "../../infra/log/logger.ts";
import { httpFor } from "../../infra/http.ts";
import { queryMemo } from "../../infra/query-memo.ts";
import { repeatingFailure } from "../../infra/repeating-failure.ts";
import { SlotQueue } from "../../infra/slot-queue.ts";
import { codedError, messageOf } from "../../rules/error-kind.ts";
import { canonicalUrl } from "../../rules/canonical-url.ts";
import { youtubeWatchUrl } from "../../rules/links.ts";
import { youtubeArt } from "../../rules/track-art.ts";
import type { TrackInfo } from "../../player/track.ts";
const log = logger.child({ category: "youtube", sub: "search" });

// youtubei.js 는 모르는 노드를 만나면 콘솔에 바로 쓴다. 끄고, 읽지 못한 결과는 검색마다 여기서 warn 으로 남긴다
Log.setLevel(Log.Level.NONE);

/** 검색 요청 하나의 마감(ms). 세션 만들기도 같다 */
const REQUEST_MS = 8000;
/** 한꺼번에 나가는 검색 수 */
const CONCURRENT = 4;
/** 같은 검색어를 다시 쓰는 시간(ms)과 기억하는 검색어 수 */
const MEMO_MS = 10 * 60_000;
const MEMO_MAX = 500;
/** 세션을 만들지 못했으면 이만큼 지나야 다시 만든다(ms). 장애 때 요청마다 만들지 않게 */
const SESSION_RETRY_MS = 30_000;

/** 검색 결과. gated: 유튜브가 이 검색어에 연령 인증 안내만 주었다(결과 없음과 다르다) */
type TextSearchResult = { tracks: TrackInfo[]; gated: boolean };

const http = httpFor("youtube");
const slots = new SlotQueue(() => CONCURRENT);
const failures = repeatingFailure({ error: (line) => log.warn(line), info: (line) => log.info(line) }, "유튜브 검색");
let now = () => Date.now();
let memo = queryMemo<TextSearchResult>({ ttlMs: MEMO_MS, max: MEMO_MAX, now: () => now() });

let session: Promise<Innertube> | null = null;
let sessionFailedAt = -Infinity;
let sessionError: unknown = null;

// 응답 상태로 오류 이름을 붙인다. youtubei.js 는 2xx 가 아니면 상태를 글에만 담아 던진다
async function send(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const res = await http.fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_MS) });
  if (res.ok) return res;
  throw codedError(res.status === 429 ? "rate-limited" : "network-error", `유튜브 검색 요청 실패: HTTP ${res.status}`, { cause: { status: res.status } });
}

function sessionOf(): Promise<Innertube> {
  if (session) return session;
  if (now() - sessionFailedAt < SESSION_RETRY_MS) return Promise.reject(sessionError);
  // fail_fast: 세션을 받지 못하면 youtubei.js 가 지역을 US 로 박은 세션을 만들어 쓰는 대신 던진다
  session = Innertube.create({ lang: "en", retrieve_player: false, retrieve_innertube_config: false, fail_fast: true, fetch: send }).catch((error: unknown) => {
    session = null;
    sessionFailedAt = now();
    sessionError = error;
    throw error;
  });
  return session;
}

const statusOf = (error: unknown) => ((error as { cause?: { status?: unknown } } | null)?.cause?.status as number | undefined) ?? null;

// 방송 중: 라이브 배지나 썸네일 길이 자리의 LIVE. youtubei.js 의 is_live 는 길이 자리가 없기만 해도 참이라 쓰지 않는다
const isLiveNow = (video: YTNodes.Video) => video.badges.some((badge) => badge.style === "BADGE_STYLE_TYPE_LIVE_NOW") || video.thumbnail_overlays.firstOfType(YTNodes.ThumbnailOverlayTimeStatus)?.style === "LIVE";

// youtubei.js 의 영상 하나 → 곡. 링크 셋은 같은 주소다(sources/youtube/api 의 trackOf 와 같은 모양)
function trackOf(video: YTNodes.Video): TrackInfo {
  const link = canonicalUrl(youtubeWatchUrl(video.video_id));
  const upcoming = Boolean(video.upcoming);
  const live = isLiveNow(video);
  return {
    title: video.title.toString().trim() || null,
    artist: video.author?.name?.trim() || undefined,
    pageUrl: link,
    requestKey: link,
    audioUrl: link,
    duration: live || upcoming ? 0 : video.duration.seconds || 0,
    thumbnail: youtubeArt(video.video_id),
    platform: "youtube",
    id: video.video_id,
    isLive: live || upcoming,
    liveStatus: upcoming ? "is_upcoming" : live ? "is_live" : null,
  };
}

const searchOnce = async (query: string) => (await sessionOf()).search(query, { type: "video" });

async function ask(query: string): Promise<TextSearchResult> {
  const leave = await slots.take();
  try {
    const found = await searchOnce(query).catch((error: unknown) => {
      // 세션이 받아들여지지 않은 것(4xx, 오래 쓴 세션에서 403 을 봤다)이면 버리고 새 세션으로 한 번 더. 429, 네트워크는 세션 탓이 아니다
      const status = statusOf(error);
      if (status === null || status < 400 || status >= 500 || status === 429) throw error;
      session = null;
      return searchOnce(query);
    });
    const nodes = found.results ?? [];
    const gated = nodes.some((node) => node.type === "BackgroundPromo");
    const seen = new Set<string>();
    const tracks = nodes.flatMap((node) => {
      if (!node.is(YTNodes.Video) || !node.video_id || seen.has(node.video_id)) return [];
      seen.add(node.video_id);
      return [trackOf(node)];
    });
    // 항목은 왔는데 읽은 영상이 없으면 유튜브 쪽 응답 모양이 바뀐 것이다
    if (!gated && nodes.length > 0 && tracks.length === 0) failures.fail(`결과 ${nodes.length}개를 읽지 못함(${[...new Set(nodes.map((node) => node.type))].join(", ")})`);
    else failures.ok();
    return { tracks, gated: gated && tracks.length === 0 };
  } catch (error) {
    failures.fail(messageOf(error).split("\n")[0]);
    throw error;
  } finally {
    leave();
  }
}

const keyOf = (query: string) => query.trim().toLowerCase();

/** 검색. 찾은 것이 없으면 빈 목록, 요청이 실패하면 던진다(rate-limited, network-error 등 이름이 붙는다) */
function searchText(query: string): Promise<TextSearchResult> {
  return memo.run(keyOf(query), () => ask(query.trim()));
}

/** 영상만 limit 개(곡 매칭, 자동재생). 연령 인증 안내만 왔으면 빈 목록(곡 매칭은 둘째 검색어로 넘어간다) */
async function searchVideos(query: string, limit: number): Promise<TrackInfo[]> {
  return (await searchText(query)).tracks.slice(0, limit);
}

/** 기억해 둔 결과. 없으면 null */
function rememberedSearch(query: string): TextSearchResult | null {
  return memo.get(keyOf(query));
}

/** query 가 그것으로 시작하는 검색어 중 가장 긴 것의 기억(자동완성이 마감을 넘겼을 때). 없으면 null */
function rememberedPrefix(query: string): TextSearchResult | null {
  return memo.longestPrefix(keyOf(query));
}

/** 기억해 둔 검색 결과에 있는 영상(자동완성에서 고른 값은 영상 id 뿐이라 제목을 여기서 찾는다). 없으면 null */
function rememberedVideo(id: string): TrackInfo | null {
  for (const result of memo.recent()) {
    const track = result.tracks.find((one) => one.id === id);
    if (track) return track;
  }
  return null;
}

/** 테스트용: 가짜 전송, 시계를 넣고 세션, 기억을 비운다 */
function resetTextSearch({ fetch = null, clock = () => Date.now() }: { fetch?: typeof globalThis.fetch | null; clock?: () => number } = {}) {
  http.useFetch(fetch);
  now = clock;
  memo = queryMemo<TextSearchResult>({ ttlMs: MEMO_MS, max: MEMO_MAX, now: () => now() });
  session = null;
  sessionFailedAt = -Infinity;
  sessionError = null;
}

export { searchText, searchVideos, rememberedSearch, rememberedPrefix, rememberedVideo, resetTextSearch, REQUEST_MS };
export type { TextSearchResult };
