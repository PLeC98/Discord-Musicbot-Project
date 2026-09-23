"use strict";

// 사이트 지식. 어느 호스트가 어느 사이트인가, id 는 어디 있나. 판정이 아니다(판정은 inputKind · canonicalUrl · audioKeyOf).
// 순수 함수만 둔다. 사이트를 더하면 이 파일과 그 판정들만 고친다.

// ── 유튜브 ──

function parseYouTubeURL(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 유튜브 호스트이기만 하면 참. 재생 가능한 형태인지는 보지 않는다(isYouTubeURL이 본다). */
function isYouTubeHost(value) {
  return parseYouTubeURL(value) !== null;
}

// /live/ID는 라이브였던 영상의 링크일 뿐 다른 형태와 같은 영상 ID를 쓴다.
// 지금 라이브인지는 URL이 아니라 메타데이터(is_live)가 정한다. 방송이 끝나면 같은 링크가 VOD가 된다.
function isYouTubeURL(value) {
  const parsed = parseYouTubeURL(value);
  if (!parsed) return false;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "youtu.be") return /^\/[a-zA-Z0-9_-]+/.test(parsed.pathname);
  if (parsed.pathname === "/watch") return /^[a-zA-Z0-9_-]+$/.test(parsed.searchParams.get("v") || "");
  if (parsed.pathname === "/playlist") return /^[a-zA-Z0-9_-]+$/.test(parsed.searchParams.get("list") || "");
  return /^\/(embed|v|shorts|live)\/[a-zA-Z0-9_-]+/.test(parsed.pathname);
}

function isYouTubePlaylist(value) {
  const parsed = parseYouTubeURL(value);
  if (!parsed || !/^[a-zA-Z0-9_-]+$/.test(parsed.searchParams.get("list") || "")) return false;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  return hostname === "youtu.be" || parsed.pathname === "/playlist" || parsed.pathname === "/watch";
}

function extractVideoId(value) {
  const parsed = parseYouTubeURL(value);
  if (!parsed) return null;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  let videoId;
  if (hostname === "youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] || null;
  } else if (parsed.pathname === "/watch") {
    videoId = parsed.searchParams.get("v");
  } else {
    const match = parsed.pathname.match(/^\/(?:embed|v|shorts|live)\/([a-zA-Z0-9_-]+)/);
    videoId = match?.[1] || null;
  }
  return /^[a-zA-Z0-9_-]+$/.test(videoId || "") ? videoId : null;
}

function extractPlaylistId(url) {
  const match = url.match(/[&?]list=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function createThumbnailUrl(videoId, quality = "maxresdefault") {
  return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
}

function createVideoUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// ── 스포티파이 ──

function isSpotifyURL(url) {
  const patterns = [/^https?:\/\/open\.spotify\.com\/(track|album|playlist|artist)\/[a-zA-Z0-9]+/, /^spotify:(track|album|playlist|artist):[a-zA-Z0-9]+/];
  return patterns.some((p) => p.test(url));
}

function parseSpotifyURL(url) {
  let m = String(url).match(/^https?:\/\/open\.spotify\.com\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)/);
  if (m) return { type: m[1], id: m[2] };
  m = String(url).match(/^spotify:(track|album|playlist|artist):([a-zA-Z0-9]+)/);
  if (m) return { type: m[1], id: m[2] };
  return { type: null, id: null };
}

// ── 사운드클라우드 ──

function isSoundCloudURL(url) {
  const patterns = [
    /^https?:\/\/(www\.|m\.)?soundcloud\.com\/[\w-]+\/[\w-]+/,
    /^https?:\/\/(www\.|m\.)?soundcloud\.com\/[\w-]+\/sets\/[\w-]+/,
    /^https?:\/\/(www\.|m\.)?soundcloud\.com\/[\w-]+$/,
    // 모바일 앱 공유용 짧은 링크 (yt-dlp가 리디렉션을 따라감)
    /^https?:\/\/on\.soundcloud\.com\/[\w-]+/,
  ];
  return patterns.some((pattern) => pattern.test(url));
}

// ── 직접 링크(확장자로 가린다) ──

const DIRECT_AUDIO_FORMATS = [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma", ".opus", ".webm", ".mp4", ".mkv", ".avi", ".mov"];

function isDirectAudioLink(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();

    // URL이 지원되는 오디오 형식으로 끝나는지 확인
    const hasAudioExtension = DIRECT_AUDIO_FORMATS.some((format) => pathname.endsWith(format));

    // 직접 HTTP/HTTPS 링크인지 확인
    const isHttpLink = urlObj.protocol === "http:" || urlObj.protocol === "https:";

    return isHttpLink && hasAudioExtension;
  } catch (error) {
    return false;
  }
}

// ── 링크인가 ──

/** http · https 주소인가. 링크가 아닌 글(검색어)과 가른다 */
function isHttpLink(value) {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value.trim());
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

module.exports = { isHttpLink, parseYouTubeURL, isYouTubeHost, isYouTubeURL, isYouTubePlaylist, extractVideoId, extractPlaylistId, createThumbnailUrl, createVideoUrl, isSpotifyURL, parseSpotifyURL, isSoundCloudURL, DIRECT_AUDIO_FORMATS, isDirectAudioLink };
