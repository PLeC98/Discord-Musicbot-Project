// 유튜브 검색 · 정보 · 스트림 · 재생목록.

import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "youtube" });
import * as links from "../../rules/links.ts";
import { canonicalUrl } from "../../rules/canonicalUrl.ts";
import { readInfo } from "../ytdlpInfo.ts";
// youtube-dl-exec 직접 호출 금지. spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
import youtubedl from "../ytdlpSpawn.ts";
import config from "../../../config.ts";
import * as trackLookup from "../../store/trackLookup.ts";
import * as auth from "./auth.ts";
import * as errors from "./errors.ts";
import * as run from "./ytdlpRun.ts";
import { messageOf } from "../../rules/errorKind.ts";
import type { YtInfo } from "../ytdlpInfo.ts";
import type { RunYtDlp } from "../ytdlpSpawn.ts";

// yt-dlp 정보 한 벌(검색 항목이거나 상세 정보). 없을 수 있다
type Item = YtInfo | null | undefined;

/**
 * yt-dlp 응답이 "지금 진행 중이거나 예정된 라이브"인지 판별.
 * 라이브는 끝이 없어 캐시 다운로드가 무한히 커지고(yt-dlp가 ffmpeg를 외부 다운로더로 띄운다),
 * Spotify 동등물 후보로서는 언제나 오답이다. flat 검색 항목/상세 정보 양쪽에 같은 필드가 온다.
 */
function _detectLive(item: Item): boolean {
  if (!item) return false;
  return Boolean(item.is_live) || item.live_status === "is_live" || item.live_status === "is_upcoming";
}

/**
 * 라이브의 종류를 가린다. `_detectLive`는 "라이브 계열인가"만 보지만,
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

// 곡의 id 칸은 글자다. yt-dlp 는 수로 줄 때도 있다
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

const UNKNOWN_TITLE = "알 수 없는 제목";
const UNKNOWN_ARTIST = "알 수 없는 아티스트";

// yt-dlp 가 준 영상 하나 → 트랙의 공통 칸. 링크 셋은 같은 주소다(유튜브는 보여 줄 곳이 곧 음원)
function trackOf(item: YtInfo, url: string, artist: string | null | undefined) {
  const link = canonicalUrl(url);
  return {
    title: titleOf(item) || UNKNOWN_TITLE,
    artist: artist || UNKNOWN_ARTIST,
    pageUrl: link,
    requestKey: link,
    audioUrl: link,
    duration: item.duration || 0,
    thumbnail: item.thumbnail || item.thumbnails?.[0]?.url,
    platform: "youtube",
    type: "track",
    id: idOf(item.id),
    isLive: _detectLive(item),
    liveStatus: liveStatusOf(item),
  };
}

// 검색 결과 한 줄. 검색 결과에 길이가 없으면 상세 정보로 채운다
// (라이브는 여기서 duration이 늘 0이라 이 갈래를 타고, 상세 정보로 isLive가 확정된다.)
async function searchTrack(item: YtInfo) {
  const url = item.webpage_url || item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : null);
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
async function search(query: string, limit = 1, { exec = youtubedl }: { exec?: RunYtDlp } = {}) {
  try {
    // 이미 YouTube URL인 경우 직접 정보를 가져옴
    if (links.isYouTubeURL(query)) {
      const info = await getInfo(query);
      return info ? [info] : [];
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
      const track = await searchTrack(item).catch(() => null);
      if (track) tracks.push(track);
    }

    return tracks;
  } catch (error) {
    if (errors.codeOf(error)) throw error; // 링크 한 곡이 까닭이 분명하게 실패했다. getInfo 참조
    log.error("유튜브 검색 실패:", messageOf(error));
    return [];
  }
}

async function getInfo(url: string, { exec }: { exec?: RunYtDlp } = {}) {
  try {
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
      throw new Error("youtube-dl에서 정보를 반환하지 않음");
    }

    return { ...trackOf(info, info.webpage_url || url, info.uploader || info.channel), views: info.view_count, uploadDate: info.upload_date, description: info.description, formats: info.formats };
  } catch (error) {
    // 못 트는 까닭이 분명한 실패(비공개 · 삭제 · 연령 제한)는 던진다. 찾는 쪽이 그 까닭을 사용자에게 알린다.
    // 삼키면 "결과를 찾을 수 없습니다"로 뭉개진다. 까닭을 모르는 실패만 null 이다
    if (errors.codeOf(error)) throw error;
    log.error("영상 정보 조회 실패:", errors.briefError(error));
    return null;
  }
}

// 그 위치부터 받는 주소. HLS 재생목록 주소에는 `begin=`을 붙일 수 없다. 위치는 ffmpeg의 `-ss`가 정한다
function seekUrl(baseUrl: string, protocol: unknown, startSeconds: number) {
  const isHls = typeof protocol === "string" && protocol.startsWith("m3u8");
  const canSeek = !isHls && /googlevideo\.com/i.test(baseUrl);
  const seekSeconds = Math.max(0, Number(startSeconds) || 0);
  if (!(seekSeconds > 0 && canSeek)) return { canSeek, finalUrl: baseUrl };
  const separator = baseUrl.includes("?") ? "&" : "?";
  return { canSeek, finalUrl: `${baseUrl}${separator}begin=${Math.floor(seekSeconds * 1000)}` };
}

async function getStream(url: string, startSeconds = 0, { exec }: { exec?: RunYtDlp } = {}) {
  try {
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

    const baseUrl = info.url;
    const { canSeek, finalUrl } = seekUrl(baseUrl, info.protocol, startSeconds);

    return {
      url: finalUrl,
      rawUrl: baseUrl,
      // 영상 자체의 제목. 재생목록 페이지가 주는 제목과 다를 수 있고, 이쪽이 정본이다
      // (watch 페이지의 videoDetails.title이라 요청 언어와 무관하게 원제가 온다).
      title: titleOf(info),
      type: info.acodec && info.acodec.includes("opus") ? "opus" : "arbitrary",
      duration: info.duration || 0,
      bitrate: info.abr || info.tbr || 0,
      canSeek,
      format: info.format,
      httpHeaders: info.http_headers || {},
      isLive: _detectLive(info),
      liveStatus: liveStatusOf(info),
      // yt-dlp가 알려주는 전송 방식. m3u8 계열은 "받아 둔 바이트"가 아니라 "받아 올 주소"를
      // 줘야 하는 형식이라 파이프로 먹일 수 없다. 재생 쪽이 이 값으로 갈래를 고른다.
      protocol: info.protocol || null,
    };
  } catch (error) {
    log.error("스트림 URL 획득 실패:", errors.briefError(error));
    throw error;
  }
}

// 재생목록 한 줄. url 이 없으면 id 가 있다(부르는 쪽이 거른다)
function playlistTrack(entry: YtInfo) {
  const track = trackOf(entry, entry.webpage_url || entry.url || `https://www.youtube.com/watch?v=${entry.id}`, entry.uploader || entry.channel || entry.uploader_id);
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

// offset부터 limit개만 받는다. 유튜브는 시작점까지 이어 받기를 걸어가야 해서 비용이 끝 위치에 비례한다.
// 총 곡 수(playlist_count)는 구간만 받아도 오지만, 믹스(RD…)는 끝이 없어 null이다.
async function getPlaylist(url: string, { offset = 0, limit = config.bot.playlistAddDefault, exec = youtubedl }: { offset?: number; limit?: number; exec?: RunYtDlp } = {}) {
  try {
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
      throw new Error("재생목록 정보를 가져올 수 없음");
    }

    if (!info.entries || info.entries.length === 0) {
      throw new Error("재생목록 항목을 찾을 수 없음");
    }

    const tracks = info.entries.map(readInfo).flatMap((entry) => (entry && (entry.id || entry.url) ? [playlistTrack(entry)] : []));

    if (tracks.length === 0) {
      throw new Error("재생목록에서 유효한 트랙을 찾을 수 없음");
    }

    const unknownPlaylist = "알 수 없는 재생목록";

    return {
      title: info.title || unknownPlaylist,
      tracks: tracks,
      total: info.playlist_count ?? null,
      nextOffset: offset + info.entries.length,
      url: url,
      platform: "youtube",
      type: "playlist",
    };
  } catch (error) {
    log.error("재생목록 조회 실패:", messageOf(error));
    return null;
  }
}

export { _detectLive, liveStatusOf, titleOf, _isVideoEntry, search, getInfo, getStream, getPlaylist };
