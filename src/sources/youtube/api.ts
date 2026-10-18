// 유튜브 검색 · 정보 · 스트림 · 재생목록.

import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "youtube" });
import * as links from "../../rules/links.ts";
import { codedError } from "../../rules/error-kind.ts";
import { canonicalUrl } from "../../rules/canonical-url.ts";
import { readInfo } from "../ytdlp-info.ts";
// youtube-dl-exec 직접 호출 금지. spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
import youtubedl from "../ytdlp-spawn.ts";
import config from "../../config/index.ts";
import * as trackLookup from "../../store/track-lookup.ts";
import * as auth from "./auth.ts";
import * as errors from "./errors.ts";
import * as run from "./ytdlp-run.ts";
import type { YtInfo } from "../ytdlp-info.ts";
import type { RunYtDlp } from "../ytdlp-spawn.ts";

// yt-dlp 정보 한 벌(검색 항목이거나 상세 정보). 없을 수 있다
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
 * @returns {"is_live"|"is_upcoming"|null}
 */
function liveStatusOf(item: Item): "is_live" | "is_upcoming" | null {
  if (!item) return null;
  if (item.live_status === "is_live" || item.live_status === "is_upcoming") return item.live_status;
  // 구버전 응답이나 flat 검색 항목에는 live_status 없이 is_live만 올 수 있다.
  if (item.live_status === undefined && item.is_live) return "is_live";
  return null;
}

// 곡의 id 필드는 글자다. yt-dlp 는 수로 줄 때도 있다
const idOf = (id: unknown) => (id == null ? undefined : String(id));

/**
 * 표시용 제목. 라이브는 yt-dlp가 `title` 뒤에 조회 시각을 붙여 준다(예: `제목 2026-01-02 03:04`).
 * 조회할 때마다 달라지는 값이라 캐시·매칭에도 나쁘다. `fulltitle`이 그게 빠진 원제이고,
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

/**
 * ytsearch 결과 항목이 "재생 가능한 단일 비디오"인지 판별.
 * yt-dlp flat 검색은 채널/재생목록/핸들을 섞어 반환하므로 이들을 제외한다.
 * 비디오 id는 11자, 채널은 UC…(24자)·/channel//@handle//playlist 형태.
 */
function _isVideoEntry(item: Item): item is YtInfo {
  if (!item) return false;
  if (item.ie_key && item.ie_key !== "Youtube") return false; // YoutubeTab(채널/재생목록) 등
  const u = item.webpage_url || item.url || "";
  if (/youtube\.com\/(channel\/|@|playlist|user\/|results)/i.test(u)) return false;
  if (item.id && /^[A-Za-z0-9_-]{11}$/.test(String(item.id))) return true; // 비디오 id
  if (/[?&]v=[A-Za-z0-9_-]{11}/.test(u)) return true; // watch?v= URL
  return false;
}

// 제목 · 가수(올린 사람)가 없으면 비워 둔다(제목은 null). 그리는 곳이 "알 수 없는 곡"으로 적고, 표시 문구가 매칭 검색어 · 중복 판정에 들어가지 않는다

// yt-dlp 가 준 영상 하나 → 트랙의 공통 필드. 링크 셋은 같은 주소다(유튜브는 보여 줄 곳이 곧 음원)
function trackOf(item: YtInfo, url: string, artist: string | null | undefined) {
  const link = canonicalUrl(url);
  return {
    title: titleOf(item) || null,
    artist: artist || undefined,
    pageUrl: link,
    requestKey: link,
    audioUrl: link,
    duration: item.duration || 0,
    thumbnail: item.thumbnail || item.thumbnails?.[0]?.url,
    platform: "youtube",
    id: idOf(item.id),
    isLive: _detectLive(item),
    liveStatus: liveStatusOf(item),
  };
}

// 검색 결과 한 줄. 검색 결과에 길이가 없으면 상세 정보로 채운다
// (라이브는 여기서 duration이 늘 0이라 이 분기를 타고, 상세 정보로 isLive가 확정된다.)
async function searchTrack(item: YtInfo) {
  const url = item.webpage_url || item.url || (item.id ? links.youtubeWatchUrl(String(item.id)) : null);
  if (!url) return null; // 비디오 항목이면 늘 있다(_isVideoEntry)
  const track = { ...trackOf(item, url, item.uploader || item.channel), views: item.view_count, uploadDate: item.upload_date, description: item.description };
  if (track.duration) return track;
  const detailed = await getInfo(url);
  if (detailed?.duration) track.duration = detailed.duration;
  if (detailed?.isLive) {
    track.isLive = true;
    track.liveStatus = detailed.liveStatus;
  }
  return track;
}

// 마지막 인자 { exec }: yt-dlp 를 실행하는 함수. 생략하면 진짜. getInfo · getStream · getPlaylist 도 같다
// 찾은 것이 없으면 빈 배열, 찾지 못한 것(yt-dlp · 네트워크 실패)은 던진다. 오류의 이름은 yt-dlp 를 실행하는 곳이 붙였다
async function search(query: string, limit = 1, { exec = youtubedl }: { exec?: RunYtDlp } = {}) {
  // 이미 YouTube URL인 경우 직접 정보를 가져옴
  if (links.isYouTubeURL(query)) {
    return [await getInfo(query)];
  }

  // 유튜브 검색에 yt-dlp 사용
  const searchQuery = `ytsearch${limit}:${query}`;

  // 목록 모양만 본다. 항목은 하나씩 readInfo 로 읽는다
  const results = (await exec(
    searchQuery,
    auth.getYtDlpOptions({
      dumpSingleJson: true,
      flatPlaylist: true,
    }),
  )) as { entries?: unknown[] } | null;

  if (!results || !results.entries) {
    return [];
  }

  const tracks = [];
  // 비디오가 아닌 검색 결과(채널·재생목록·핸들)를 제외. ytsearch가 이들을 섞어 반환하는데,
  // 재생 불가능한 채널 URL이 후보로 들어가면 매칭이 오염된다(예: 제목이 기호뿐인 곡에서 채널이 순위로 우승).
  const videoEntries = results.entries
    .map(readInfo)
    .filter((e) => _isVideoEntry(e))
    .slice(0, limit);
  for (const item of videoEntries) {
    // 한 곡의 상세 조회가 던지면(연령 제한 등) 그 곡만 건너뛴다. 검색은 다른 후보로 이어진다
    const track = await searchTrack(item).catch((error) => {
      log.warn(`검색 결과 한 곡을 건너뜁니다: ${errors.briefError(error, 1)}`);
      return null;
    });
    if (track) tracks.push(track);
  }

  return tracks;
}

// 실패는 모두 던진다(이름은 yt-dlp 를 실행하는 곳이 붙였다). 찾는 쪽이 그 까닭을 알린다
async function getInfo(url: string, { exec }: { exec?: RunYtDlp } = {}) {
  const info = readInfo(
    await run.runYtDlp(
      url,
      (forceCookies) =>
        auth.getYtDlpOptions(
          {
            dumpSingleJson: true,
            preferFreeFormats: true,
          },
          { forceCookies },
        ),
      exec,
    ),
  );

  if (!info) {
    throw new Error("yt-dlp 가 정보를 주지 않았습니다");
  }

  return { ...trackOf(info, info.webpage_url || url, info.uploader || info.channel), views: info.view_count, uploadDate: info.upload_date, description: info.description, formats: info.formats };
}

async function getStream(url: string, { exec }: { exec?: RunYtDlp } = {}) {
  // 실패는 부르는 쪽(재생)이 한 번 남긴다
  if (!url) {
    throw new Error("URL이 필요함");
  }

  // 단순 형식으로 스트림 URL 가져오기
  const info = readInfo(
    await run.runYtDlp(
      url,
      (forceCookies) =>
        auth.getYtDlpOptions(
          {
            dumpSingleJson: true,
            format: "bestaudio/best",
          },
          { forceCookies },
        ),
      exec,
    ),
  );

  if (!info || !info.url) {
    throw new Error("스트림 URL을 찾을 수 없음");
  }

  // 위치는 주소에 싣지 않는다. ffmpeg 의 -ss 가 정한다
  return {
    url: info.url,
    // 영상 자체의 제목. 재생목록 페이지가 주는 제목과 다를 수 있고, 이쪽이 정본이다
    // (watch 페이지의 videoDetails.title이라 요청 언어와 무관하게 원제가 온다).
    title: titleOf(info),
    duration: info.duration || 0,
    bitrate: info.abr || info.tbr || 0,
    format: info.format,
    httpHeaders: info.http_headers || {},
    isLive: _detectLive(info),
    liveStatus: liveStatusOf(info),
    // yt-dlp가 알려주는 전송 방식. m3u8 계열은 "다운로드해 둔 바이트"가 아니라 "다운로드할 주소"를
    // 줘야 하는 형식이라 파이프로 먹일 수 없다. 재생 쪽이 이 값으로 분기한다.
    protocol: info.protocol || null,
    // 앞 광고가 붙은 응답이면 광고가 끝나는 시각. 그 전에는 본편 요청이 403 일 수 있다(yt-dlp 가 광고 길이로 매긴다)
    availableAt: info.available_at ?? null,
    // 조각 목록으로만 주는 포맷이면 조각 주소의 모양. 재생 쪽이 조각을 순서대로 다운로드한다(media/fragment-stream)
    fragments: fragmentsOf(info),
  };
}

/**
 * 조각 목록(방송이 끝나고 다시보기를 다 만들기 전의 유튜브 소리)을 base · count 로. 조각 주소는 포맷 주소 뒤에 `&sq=번호`다.
 * 조각이 없으면 null. 모양이 다르면 던진다(첫 조각만 틀고 끝난 것처럼 보이지 않게)
 */
function fragmentsOf(info: YtInfo) {
  const list = info.fragments;
  if (!list?.length || !info.url) return null;
  const base = info.url;
  if (!list.every((f, i) => f.url === `${base}&sq=${i}`)) throw codedError("stream-failed", "조각 목록의 주소가 알던 모양(포맷 주소 뒤 &sq=번호)이 아닙니다");
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
  } catch {
    /* DB 미초기화 등. 재생목록 제목 그대로 간다 */
  }
  return track;
}

// offset부터 limit개만 불러온다. 유튜브는 시작점까지 순서대로 넘겨 가야 해서 비용이 끝 위치에 비례한다.
// 총 곡 수(playlist_count)는 구간만 불러와도 오지만, 믹스(RD…)는 끝이 없어 null이다.
// 그 구간에 곡이 없으면 null(목록 끝을 넘은 이어 불러오기 등). 목록을 불러오지 못한 것(없는 · 비공개 목록, 네트워크)은 던진다
async function getPlaylist(url: string, { offset = 0, limit = config.bot.playlistAddDefault, exec = youtubedl }: { offset?: number; limit?: number; exec?: RunYtDlp } = {}) {
  const info = readInfo(
    await exec(
      url,
      auth.getYtDlpOptions({
        dumpSingleJson: true,
        flatPlaylist: true,
        playlistItems: `${offset + 1}:${offset + limit}`,
      }),
    ),
  );

  if (!info) {
    throw new Error("yt-dlp 가 재생목록 정보를 주지 않았습니다");
  }

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

export { _detectLive, liveStatusOf, titleOf, _isVideoEntry, search, getInfo, getStream, getPlaylist };
