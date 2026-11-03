// 유튜브 영상 정보, 스트림, 재생목록(yt-dlp). 글자 검색은 text-search.

import logger from "../../infra/log/logger.ts";
import { artOf, youtubeArt } from "../../rules/track-art.ts";
const log = logger.child({ category: "youtube" });
import * as links from "../../rules/links.ts";
import { codedError, codeOf, messageOf } from "../../rules/error-kind.ts";
import { canonicalUrl } from "../../rules/canonical-url.ts";
import { answerShape, readInfo } from "../ytdlp-info.ts";
// youtube-dl-exec 직접 호출 금지. spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
import youtubedl from "../ytdlp-spawn.ts";
import config from "../../config/index.ts";
import * as trackLookup from "../../store/track-lookup.ts";
import * as auth from "./auth.ts";
import * as run from "./ytdlp-run.ts";
import * as recentInfo from "./recent-info.ts";
import type { YtInfo } from "../ytdlp-info.ts";
import type { RunYtDlp } from "../ytdlp-spawn.ts";

// yt-dlp 정보 하나(검색 항목이거나 상세 정보). 없을 수 있다
type Item = YtInfo | null | undefined;

/**
 * yt-dlp 응답이 "지금 진행 중이거나 예정된 라이브"인지 판별.
 * 라이브는 끝이 없어 캐시 다운로드가 무한히 커지고(yt-dlp가 ffmpeg를 외부 다운로더로 실행한다),
 * Spotify 동등물 후보로서는 언제나 오답이다. flat 검색 항목/상세 정보 양쪽에 같은 필드가 온다.
 */
function _detectLive(item: Item): boolean {
  if (!item) return false;
  return Boolean(item.is_live) || item.live_status === "is_live" || item.live_status === "is_upcoming";
}

/**
 * 라이브의 종류를 구분한다. `_detectLive`는 "라이브 계열인가"만 보지만,
 * 재생은 방송 중(is_live)과 시작 전(is_upcoming)을 다르게 다뤄야 한다. 틀 것이 없는 쪽은 거절한다.
 */
function liveStatusOf(item: Item): "is_live" | "is_upcoming" | null {
  if (!item) return null;
  if (item.live_status === "is_live" || item.live_status === "is_upcoming") return item.live_status;
  // 구버전 응답이나 flat 검색 항목에는 live_status 없이 is_live만 올 수 있다.
  if (item.live_status === undefined && item.is_live) return "is_live";
  return null;
}

// 곡의 id 필드는 문자열이다. yt-dlp 는 숫자로 줄 때도 있다
const idOf = (id: unknown) => (id == null ? undefined : String(id));

/**
 * 표시용 제목. 라이브는 yt-dlp가 `title` 뒤에 조회 시각을 붙여 준다(예: `제목 2026-01-02 03:04`).
 * 조회할 때마다 달라지는 값이라 캐시, 매칭에도 나쁘다. `fulltitle`이 그게 빠진 원제이고,
 * 라이브가 아니면 둘이 같다.
 */
function titleOf(item: Item): string | null {
  if (!item) return null;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const full = text(item.fulltitle);
  const title = text(item.title);
  if (liveStatusOf(item) && full) return full;
  return title || full;
}

// yt-dlp 가 준 영상 하나 → 곡의 공통 필드. 링크 셋은 같은 주소다(유튜브는 보여 줄 곳이 곧 음원).
// 제목, 가수(올린 사람)가 없으면 비워 둔다(제목은 null). 그리는 곳이 "알 수 없는 곡"으로 적어, 표시 문구가 매칭 검색어, 중복 판정에 들어가지 않는다
function trackOf(item: YtInfo, url: string, artist: string | null | undefined) {
  const link = canonicalUrl(url);
  return {
    title: titleOf(item) || null,
    artist: artist || undefined,
    pageUrl: link,
    requestKey: link,
    audioUrl: link,
    duration: item.duration || 0,
    // 검색 결과의 thumbnails 는 작은 것부터라 [0] 은 168×94. 영상 id 로 만든다(rules/track-art)
    thumbnail: typeof item.id === "string" && /^[\w-]{11}$/.test(item.id) ? youtubeArt(item.id) : artOf(item.thumbnail || item.thumbnails?.at(-1)?.url),
    platform: "youtube",
    id: idOf(item.id),
    isLive: _detectLive(item),
    liveStatus: liveStatusOf(item),
  };
}

// 영상 정보 한 번: 재생 주소와 같은 옵션(포맷 선택까지)이라 받은 것을 재생 주소, 다운로드가 그대로 다시 쓴다(recent-info).
// 재생목록이 붙은 영상 주소(watch?v=X&list=Y)도 영상 하나만 묻는다. 재생목록은 getPlaylist 가 따로 연다
const extractInfo = (url: string, exec?: RunYtDlp) =>
  run.runYtDlp(
    url,
    (forceCookies) =>
      auth.getYtDlpOptions(
        {
          dumpSingleJson: true,
          format: run.AUDIO_FORMAT,
          noPlaylist: true,
        },
        { forceCookies },
      ),
    exec,
  );

// 실패는 모두 던진다(이름은 yt-dlp 를 실행하는 곳이 붙였다). 찾는 쪽이 그 원인을 알린다. 받은 정보는 재생 주소, 다운로드가 다시 쓰게 둔다
async function fetchInfo(url: string, exec: RunYtDlp | undefined) {
  const raw = await extractInfo(url, exec);
  recentInfo.remember(raw);
  const info = readInfo(raw);
  if (!info) throw new Error(`유튜브 영상 정보: yt-dlp 출력이 JSON 객체가 아님 | ${answerShape(raw)}`);
  if (info._type === "playlist") throw new Error(`유튜브 영상 정보: 단일 영상 요청에 yt-dlp가 재생목록을 반환함 | entries=${info.entries?.length ?? 0}`);
  return info;
}

async function getInfo(url: string, { exec }: { exec?: RunYtDlp } = {}) {
  const info = await fetchInfo(url, exec);
  return trackOf(info, info.webpage_url || url, info.uploader || info.channel);
}

/** 영상의 포맷 목록. 원본 다시 확인이 버전(lmt)과 길이를 읽는다 */
async function getFormats(url: string, { exec }: { exec?: RunYtDlp } = {}): Promise<readonly unknown[]> {
  return (await fetchInfo(url, exec)).formats ?? [];
}

// 캐시된 영상 정보가 있으면 그것(known), 없으면 추출해 캐시한다. fresh 면 캐시된 것을 버리고(남기면 다음 열기가 같은 막힌 정보를 다시 꺼낸다) 새로 추출한 것도 캐시하지 않는다
async function streamSource(url: string, exec: RunYtDlp | undefined, fresh: boolean): Promise<{ raw: unknown; known: boolean }> {
  const id = links.extractVideoId(url);
  if (fresh && id) recentInfo.forget(id);
  const recalled = !fresh && id ? recentInfo.recall(id) : null;
  if (recalled) return { raw: recalled, known: true };
  const raw = await extractInfo(url, exec);
  if (!fresh) recentInfo.remember(raw);
  return { raw, known: false };
}

/**
 * 재생용 스트림 서술자. 캐시된 영상 정보(곡 정보, 앞선 재생 주소)가 있으면 yt-dlp 없이 그것으로 만들고 reused 를 단다(열리지 않으면 재생 쪽이 fresh 로 다시 부른다).
 * fresh: 캐시를 버리고 새로 추출하며 캐시하지 않는다(재생 테스트, 다시 쓴 주소가 열리지 않았을 때)
 */
async function getStream(url: string, { exec, fresh = false }: { exec?: RunYtDlp; fresh?: boolean } = {}) {
  // 실패는 부르는 쪽(재생)이 한 번 남긴다. 빈 주소는 부르는 코드의 잘못이다
  if (!url) throw new Error("유튜브 재생용 스트림: 빈 URL로 호출됨");

  const { raw, known } = await streamSource(url, exec, fresh);
  const info = readInfo(raw);
  if (!info) throw codedError("stream-failed", `유튜브 재생용 스트림: yt-dlp 출력이 JSON 객체가 아님 | ${answerShape(raw)}`);
  if (!info.url) throw codedError("stream-failed", `유튜브 재생용 스트림: yt-dlp 응답에 스트림 URL이 없음 | _type=${info._type ?? "없음"}`);

  // 위치는 주소에 싣지 않는다. ffmpeg 의 -ss 가 정한다
  return {
    url: info.url,
    // 영상 자체의 제목. 재생목록 페이지가 주는 제목과 다를 수 있고, 이쪽이 정본이다
    // (watch 페이지의 videoDetails.title이라 요청 언어와 무관하게 원제가 온다).
    title: titleOf(info),
    duration: info.duration || 0,
    httpHeaders: info.http_headers || {},
    isLive: _detectLive(info),
    liveStatus: liveStatusOf(info),
    // yt-dlp가 알려주는 전송 방식. m3u8 계열은 "다운로드해 둔 바이트"가 아니라 "다운로드할 주소"를
    // 줘야 하는 형식이라 파이프로 먹일 수 없다. 재생 쪽이 이 값으로 분기한다.
    protocol: info.protocol || null,
    // 앞 광고가 붙은 응답이면 광고가 끝나는 시각. 그 전에는 본편 요청이 403 일 수 있다(yt-dlp 가 광고 길이로 매긴다)
    availableAt: info.available_at ?? null,
    // 세그먼트 목록으로만 주는 포맷이면 세그먼트 주소의 모양. 재생 쪽이 세그먼트를 순서대로 다운로드한다(media/fragment-stream)
    fragments: fragmentsOf(info),
    reused: known,
  };
}

/**
 * 세그먼트 목록(방송이 끝나고 다시보기를 다 만들기 전의 유튜브 오디오)을 base, count 로. 세그먼트 주소는 포맷 주소 뒤에 `&sq=번호`다.
 * 세그먼트가 없으면 null. 모양이 다르면 던진다(첫 세그먼트만 틀고 끝난 것처럼 보이지 않게)
 */
function fragmentsOf(info: YtInfo) {
  const list = info.fragments;
  if (!list?.length || !info.url) return null;
  const base = info.url;
  if (!list.every((f, i) => f.url === `${base}&sq=${i}`)) throw codedError("stream-failed", "세그먼트 목록의 주소가 알던 모양(포맷 주소 뒤 &sq=번호)이 아닙니다");
  return { base, count: list.length };
}

// 재생목록 한 줄. url 이 없으면 id 가 있다(부르는 쪽이 필터링한다)
function playlistTrack(entry: YtInfo) {
  const track = trackOf(entry, entry.webpage_url || entry.url || links.youtubeWatchUrl(String(entry.id)), entry.uploader || entry.channel || entry.uploader_id);
  // 이 영상의 제목을 전에 영상 자체에서 확인해 뒀다면 그걸 쓴다(로컬 DB 조회, 왕복 없음).
  // 재생목록 페이지의 제목은 낡을 수 있어서, 이게 없으면 곡이 재생되기 전까지 대기열에
  // 낡은 제목이 그대로 보인다.
  try {
    const known = trackLookup.getVerifiedTitle(track.requestKey);
    if (known) track.title = known;
  } catch (error) {
    if (codeOf(error) === "DB_NOT_OPEN") throw error;
    // 재생목록 제목 그대로 간다
    log.debug(`상세 제목 조회 실패(목록 제목 사용): ${messageOf(error)}`);
  }
  return track;
}

// offset부터 limit개만 불러온다. 유튜브는 시작점까지 순서대로 넘겨 가야 해서 비용이 끝 위치에 비례한다.
// 총 곡 수(playlist_count)는 구간만 불러와도 오지만, 믹스(RD…)는 끝이 없어 null이다.
// 그 구간에 곡이 없으면 null(목록 끝을 넘은 이어 불러오기 등). 목록을 불러오지 못한 것(없는, 비공개 목록, 네트워크)은 던진다
async function getPlaylist(url: string, { offset = 0, limit = config.bot.playlistAddDefault, exec = youtubedl }: { offset?: number; limit?: number; exec?: RunYtDlp } = {}) {
  const raw = await exec(
    url,
    auth.getYtDlpOptions({
      dumpSingleJson: true,
      flatPlaylist: true,
      playlistItems: `${offset + 1}:${offset + limit}`,
    }),
  );
  const info = readInfo(raw);
  if (!info) throw new Error(`유튜브 재생목록: yt-dlp 출력이 JSON 객체가 아님 | ${answerShape(raw)}`);

  if (!info.entries || info.entries.length === 0) return null;

  const tracks = info.entries.map(readInfo).flatMap((entry) => (entry && (entry.id || entry.url) ? [playlistTrack(entry)] : []));

  if (tracks.length === 0) return null;

  return {
    title: info.title || null,
    tracks: tracks,
    total: info.playlist_count ?? null,
    nextOffset: offset + info.entries.length,
    url: url,
    platform: "youtube",
  };
}

export { _detectLive, liveStatusOf, titleOf, getInfo, getFormats, getStream, getPlaylist };
