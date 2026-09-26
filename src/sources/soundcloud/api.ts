// 사운드클라우드 곡 · 세트 · 스트림. 모두 yt-dlp 가 읽는다(run.ts).

import { readInfo } from "../ytdlpInfo.ts";
import { canonicalUrl } from "../../rules/canonicalUrl.ts";
import { codedError, codeOf } from "../../rules/errorKind.ts";
import youtubedl from "../ytdlpSpawn.ts";
import * as run from "./run.ts";
import type { YtInfo } from "../ytdlpInfo.ts";
import type { RunYtDlp } from "../ytdlpSpawn.ts";

/** 세트에서 한 번에 받는 곡 수. 곡마다 요청이 들어(4) 서버의 재생목록 곡 수 설정과 상관없이 이만큼씩 받고 나머지는 "더 넣기"로 */
const SET_BATCH = 10;

// 제목이 없는 곡은 없다시피 해 표시 문구로 채운다. 가수(올린 사람)는 비워 둔다
const UNKNOWN_TITLE = "알 수 없는 제목";

/** 찾은 곡. 트랙 모델(player/track)의 TrackInfo 와 같은 칸 */
type ScTrack = { title: string; artist?: string; duration: number; thumbnail?: string | null; platform: "soundcloud"; id?: string; pageUrl: string; requestKey: string; audioUrl: string };
/** 세트 한 구간. total 은 세트 전체 곡 수, setId 는 이어 받을 때 부를 숫자 id. 뺀 곡은 미리듣기 · 받을 수 없음(지역 제한 등)으로 센다 */
type ScSet = { title: string | null; setId: string | null; tracks: ScTrack[]; total: number | null; nextOffset: number; skipped: { preview: number; unavailable: number } };
/** 곡 찾기가 받는 것. 짧은 링크는 풀어 봐야 곡인지 세트인지 안다 */
type Found = { kind: "track"; track: ScTrack } | ({ kind: "set" } & ScSet);

const idOf = (id: unknown) => (id == null ? undefined : String(id));

// 곡이 가진 포맷 이름들
const formatIds = (item: YtInfo) => (item.formats || []).map((f) => String((f as { format_id?: unknown } | null)?.format_id ?? ""));
// 미리듣기(30초 조각)만 있는 곡인가. 조각은 포맷 이름 끝이 _preview 다
const previewOnly = (item: YtInfo) => {
  const ids = formatIds(item);
  return ids.length > 0 && ids.every((id) => /_preview$/.test(id));
};

// yt-dlp 가 준 곡 하나 → 트랙. 링크는 곡 페이지(짧은 링크 · API 주소로 들어와도 같은 곡이면 같은 열쇠)
function trackOf(item: YtInfo): ScTrack | null {
  if (!item.webpage_url) return null;
  const link = canonicalUrl(item.webpage_url);
  return {
    title: item.title || item.fulltitle || UNKNOWN_TITLE,
    artist: item.uploader || undefined,
    duration: item.duration || 0,
    thumbnail: item.thumbnail || item.thumbnails?.[0]?.url || null,
    platform: "soundcloud",
    id: idOf(item.id),
    pageUrl: link,
    requestKey: link,
    audioUrl: link,
  };
}

// 곡 하나. 미리듣기만 열린 곡은 30초 조각을 곡처럼 틀지 않는다
function oneTrack(item: YtInfo): ScTrack {
  if (previewOnly(item)) throw codedError("preview-only", `미리듣기만 열린 곡입니다: ${item.title ?? item.webpage_url}`);
  const track = trackOf(item);
  if (!track) throw new Error("yt-dlp 가 곡 페이지 주소를 주지 않았습니다");
  return track;
}

// 세트의 한 구간. 받을 수 없는 곡(null)과 미리듣기는 빼고 센다
function setOf(info: YtInfo, offset: number): ScSet {
  const skipped = { preview: 0, unavailable: 0 };
  const tracks: ScTrack[] = [];
  const entries = info.entries || [];
  for (const raw of entries) {
    const item = readInfo(raw);
    if (!item) skipped.unavailable++;
    else if (previewOnly(item)) skipped.preview++;
    else {
      const track = trackOf(item);
      if (track) tracks.push(track);
      else skipped.unavailable++;
    }
  }
  return { title: info.title || null, setId: idOf(info.id) ?? null, tracks, total: info.playlist_count ?? null, nextOffset: offset + entries.length, skipped };
}

/**
 * 곡 찾기. 곡 링크면 그 곡, 세트 링크면 offset 부터 한 구간(SET_BATCH 를 넘지 않는다). 짧은 링크는 yt-dlp 가 푼 결과로 가른다.
 * 실패는 이름을 단 오류로 던진다(없는 곡 · 세트, 지역 차단, 미리듣기, 요청 제한, 네트워크)
 */
async function find(url: string, { offset = 0, limit = SET_BATCH, what = "track" }: { offset?: number; limit?: number; what?: run.What } = {}, exec: RunYtDlp = youtubedl): Promise<Found> {
  const size = Math.max(1, Math.min(limit, SET_BATCH));
  const info = readInfo(await run.read(url, "lookup", what, { playlistItems: `${offset + 1}:${offset + size}` }, exec));
  if (!info) throw new Error("yt-dlp 가 정보를 주지 않았습니다");
  if (info._type === "playlist") return { kind: "set", ...setOf(info, offset) };
  return { kind: "track", track: oneTrack(info) };
}

// 고른 포맷의 정보. AAC 가 없는 곡은 mp3 까지 물어 한 번 더
async function streamInfo(url: string, canPlayHls: boolean, exec: RunYtDlp) {
  const ask = (formats: run.Formats) => run.read(url, formats, "track", { format: "bestaudio/best" }, exec);
  try {
    return await ask(canPlayHls ? "play" : "progressive");
  } catch (error) {
    if (codeOf(error) !== "no-formats") throw error;
    if (!canPlayHls) throw codedError("stream-failed", "이 ffmpeg 는 HLS 를 열지 못하고, 이 곡에는 mp3 가 없습니다", { cause: error });
    return ask("lookup");
  }
}

/**
 * 재생용 스트림 서술자. AAC(HLS)를 묻고, HLS 를 못 여는 ffmpeg 면 mp3 를 묻는다.
 * AAC 가 없는 곡은 mp3 까지 물어 한 번 더 본다. 미리듣기 조각이 골리면 틀지 않는다. 탐색은 ffmpeg 가 한다.
 */
async function getStream(url: string, { canPlayHls = true }: { canPlayHls?: boolean } = {}, exec: RunYtDlp = youtubedl) {
  const info = readInfo(await streamInfo(url, canPlayHls, exec));
  if (!info?.url) throw new Error("yt-dlp 가 스트림 주소를 주지 않았습니다");
  if (/_preview$/.test(info.format_id || "")) throw codedError("preview-only", `미리듣기만 열린 곡입니다: ${info.title ?? url}`);
  return {
    url: info.url,
    protocol: info.protocol || null,
    duration: Math.round(info.duration || 0),
    bitrate: info.abr || info.tbr || 0,
    platform: "soundcloud",
    httpHeaders: info.http_headers || {},
  };
}

export { SET_BATCH, find, getStream, trackOf, previewOnly };
export type { ScTrack, ScSet, Found };
