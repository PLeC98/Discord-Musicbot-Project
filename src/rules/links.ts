// 사이트 지식. 어느 호스트가 어느 사이트인가, id 는 어디 있나. 판정이 아니다(판정은 inputKind, canonicalUrl, audioKeyOf).
// 순수 함수만 둔다. 사이트를 더하면 이 파일과 그 판정들만 고친다.

// ── 주소 읽기 ──

/** 읽은 사이트 주소. host 는 받은 호스트(소문자, 끝 점 뗌), site 는 그 사이트의 정본 호스트, parts 는 경로 칸 */
type SiteUrl = { host: string; site: string; parts: string[]; params: URLSearchParams; url: URL };

// 어디에 있든 거절한다. new URL 은 소리 없이 지우고 읽는다(open.spo<줄바꿈>tify.com 이 받아진다)
const STRIPPED = /[\t\n\r]/;
// 첫 ?, # 앞(스킴, 호스트, 경로)에 있으면 거절한다. 보이지 않는 글자가 판정과 키를 어긋나게 한다. 쿼리, 조각 안의 공백은 둔다
const HIDDEN = /[\s\p{Cf}]/u;

/**
 * 사이트 주소를 읽는다. hosts 는 받는 호스트 → 정본 호스트. http, https 만, 사용자 이름, 비밀번호, 기본이 아닌 포트는 받지 않는다.
 * 경로 칸은 맨 앞의 빈 칸과 맨 뒤의 빈 칸 하나를 버린다(뒤 / 는 같은 주소다). 안쪽의 빈 칸은 남겨 사이트가 거절한다
 */
function readSiteUrl(value: unknown, hosts: Readonly<Record<string, string>>): SiteUrl | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (STRIPPED.test(text) || HIDDEN.test(text.split(/[?#]/, 1)[0])) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!Object.hasOwn(hosts, host)) return null;
  const parts = url.pathname.split("/").slice(1);
  if (parts.at(-1) === "") parts.pop();
  return { host, site: hosts[host], parts, params: url.searchParams, url };
}

// ── 유튜브 ──

const YOUTUBE_HOSTS = { "youtube.com": "youtube.com", "www.youtube.com": "youtube.com", "m.youtube.com": "youtube.com", "music.youtube.com": "youtube.com", "youtu.be": "youtu.be" };
const YOUTUBE_ID = /^[A-Za-z0-9_-]+$/;
const youtubeIdOf = (value: string | null | undefined) => (value && YOUTUBE_ID.test(value) ? value : null);

/**
 * 유튜브 주소가 가리키는 영상과 재생목록. 둘 다 없으면 null(유튜브 주소가 아니거나 다루지 않는 모양).
 * /live/ID 는 라이브였던 영상의 링크일 뿐 다른 모양과 같은 영상 id 다. 지금 라이브인지는 주소가 아니라 정보(is_live)가 정한다
 */
function parseYouTube(value: unknown): { videoId: string | null; listId: string | null } | null {
  const link = readSiteUrl(value, YOUTUBE_HOSTS);
  if (!link) return null;
  const { site, parts, params } = link;
  const list = youtubeIdOf(params.get("list"));
  let videoId: string | null = null;
  let listId: string | null = null;
  if (site === "youtu.be") {
    videoId = youtubeIdOf(parts[0]);
    listId = list;
  } else if (parts.length === 1 && parts[0] === "watch") {
    videoId = youtubeIdOf(params.get("v"));
    listId = list;
  } else if (parts.length === 1 && parts[0] === "playlist") {
    listId = list;
  } else if (["embed", "v", "shorts", "live"].includes(parts[0]) && parts.length >= 2) {
    // embed/videoseries 는 재생목록을 싣는 틀, embed/live_stream 은 채널의 지금 방송이다(yt-dlp 도 영상 id 로 보지 않는다)
    if (parts[0] === "embed" && parts[1] === "videoseries") listId = list;
    else if (parts[1] !== "live_stream") videoId = youtubeIdOf(parts[1]);
  }
  return videoId || listId ? { videoId, listId } : null;
}

/** 유튜브 호스트이기만 하면 참. 재생할 수 있는 모양인지는 보지 않는다(isYouTubeURL 이 본다) */
function isYouTubeHost(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return Object.hasOwn(YOUTUBE_HOSTS, parsed.hostname.toLowerCase().replace(/\.$/, ""));
  } catch {
    return false;
  }
}

const isYouTubeURL = (value: unknown): boolean => parseYouTube(value) !== null;
const isYouTubePlaylist = (value: unknown): boolean => Boolean(parseYouTube(value)?.listId);
const extractVideoId = (value: unknown): string | null => parseYouTube(value)?.videoId ?? null;
const extractPlaylistId = (value: unknown): string | null => parseYouTube(value)?.listId ?? null;

/** 유튜브 주소에 실린 재생목록 id(list 값). 주소 모양은 보지 않는다(장르 출처를 목록 주소로 다듬는 곳이 쓴다) */
function youtubeListOf(value: unknown): string | null {
  const link = readSiteUrl(value, YOUTUBE_HOSTS);
  return link ? youtubeIdOf(link.params.get("list")) : null;
}

/** 영상 id 의 보는 주소(한 모양으로 적는다) */
const youtubeWatchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

// ── 스포티파이 ──

type SpotifyLink = { type: "track" | "album" | "playlist" | "artist"; id: string };
const SPOTIFY_TYPES: ReadonlySet<string> = new Set(["track", "album", "playlist", "artist"]);
// 공유 링크의 지역 칸(intl-ko, intl-pt-BR). 같은 곡이다
const SPOTIFY_REGION = /^intl-[a-z]+(?:-[a-z]+)*$/i;

const spotifyOf = (type: string | undefined, id: string | undefined): SpotifyLink | null => (type && SPOTIFY_TYPES.has(type) && id && /^[A-Za-z0-9]+$/.test(id) ? { type: type as SpotifyLink["type"], id } : null);

/** 스포티파이 주소(open.spotify.com)나 URI(spotify:종류:id)가 가리키는 것. 종류 뒤의 칸은 보지 않는다. 아니면 null */
function parseSpotify(value: unknown): SpotifyLink | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^spotify:/i.test(text)) {
    const [, type, id] = text.split(/[?#]/, 1)[0].replace(/\/$/, "").split(":");
    return spotifyOf(type, id);
  }
  const link = readSiteUrl(text, { "open.spotify.com": "open.spotify.com" });
  if (!link) return null;
  const parts = link.parts.filter(Boolean);
  if (SPOTIFY_REGION.test(parts[0] ?? "")) parts.shift();
  return spotifyOf(parts[0], parts[1]);
}

const isSpotifyURL = (value: unknown): boolean => parseSpotify(value) !== null;

// ── 사운드클라우드 ──

const SOUNDCLOUD_HOSTS = {
  "soundcloud.com": "soundcloud.com",
  "www.soundcloud.com": "soundcloud.com",
  "m.soundcloud.com": "soundcloud.com",
  // 모바일 앱이 공유하는 짧은 링크. yt-dlp 가 리다이렉트를 따라간다
  "on.soundcloud.com": "on.soundcloud.com",
  // 곡, 세트의 숫자 id 주소. 세트를 이어 받을 때 이것으로 부른다. yt-dlp 가 그대로 받는다
  "api.soundcloud.com": "api.soundcloud.com",
  "api-v2.soundcloud.com": "api-v2.soundcloud.com",
};

// 사용자 이름 뒤에 와도 곡이 아닌 경로(프로필의 탭들)
const SOUNDCLOUD_TABS = new Set(["sets", "likes", "tracks", "reposts", "albums", "popular-tracks", "followers", "following", "comments", "spotlight", "playlists", "toptracks"]);

type SoundCloudLink = { kind: "track" | "set" | "short" | "other"; url: string; secret: boolean; mix: string | null };

const secretOrNone = (part: string | undefined) => part === undefined || /^s-[\w-]+$/.test(part);
const mixOf = (parts: string[]) => (parts[0] === "discover" && parts.length === 3 && /^[\w:-]+$/.test(parts[2]) ? parts[2] : null);

// soundcloud.com 의 경로. 첫 칸(사용자 이름)은 통째로, 둘째 칸은 첫 글자만 본다(soundcloud.com/사용자/곡.mp3 도 사운드클라우드다). 안쪽의 빈 칸은 받지 않는다
function soundCloudPage(parts: string[]): Omit<SoundCloudLink, "url"> | null {
  if (parts.includes("") || !/^[\w-]+$/.test(parts[0] ?? "") || (parts.length >= 2 && !/^[\w-]/.test(parts[1]))) return null;
  if (parts[1] === "sets" && parts.length >= 3 && parts.length <= 4 && secretOrNone(parts[3])) return { kind: "set", secret: parts[3] !== undefined, mix: mixOf(parts) };
  if (parts.length >= 2 && parts.length <= 3 && !SOUNDCLOUD_TABS.has(parts[1]) && secretOrNone(parts[2])) return { kind: "track", secret: parts[2] !== undefined, mix: null };
  return { kind: "other", secret: false, mix: null };
}

// 짧은 링크와 숫자 id 주소. id 칸은 통째로 본다
function soundCloudShortcut(site: string, parts: string[]): SoundCloudLink["kind"] | null {
  if (site === "on.soundcloud.com") return /^[\w-]+$/.test(parts[0] ?? "") ? "short" : null;
  if (!/^\d+$/.test(parts[1] ?? "")) return null;
  if (parts[0] === "tracks") return "track";
  return parts[0] === "playlists" ? "set" : null;
}

/**
 * 사운드클라우드 주소가 무엇을 가리키나. 사운드클라우드 주소가 아니면 null.
 *   kind    track  곡(/사용자/곡, 비밀 공유 /사용자/곡/s-…, api 의 tracks/<id>)
 *           set    세트, 앨범(/사용자/sets/이름, 비밀 공유 …/s-…, api 의 playlists/<id>)
 *           short  앱 공유용 짧은 링크(곡인지 세트인지는 yt-dlp 가 풀어야 안다)
 *           other  사용자 프로필, 좋아요, 재게시 같은 모음. 받지 않는다
 *   url     정본 호스트와 경로만 남긴 주소(쿼리를 버린다)
 *   secret  비밀 공유 주소인가(s-…)
 *   mix     discover 믹스(/discover/sets/<id>)의 id
 */
function parseSoundCloud(value: unknown): SoundCloudLink | null {
  const link = readSiteUrl(value, SOUNDCLOUD_HOSTS);
  if (!link) return null;
  const { site, parts } = link;
  const url = `https://${site}/${parts.join("/")}`;
  if (site !== "soundcloud.com") {
    const kind = soundCloudShortcut(site, parts);
    return kind && { kind, url, secret: false, mix: null };
  }
  const page = soundCloudPage(parts);
  return page && { ...page, url };
}

const isSoundCloudURL = (value: unknown): boolean => parseSoundCloud(value) !== null;

// ── 알려진 사이트 ──

// 위 사이트들의 호스트(하위 도메인 포함). 모양이 맞지 않는 주소(유튜브 클립, 채널, 스포티파이 에피소드, 짧은 링크)도 그 사이트의 페이지다
const KNOWN_SITE_HOSTS = ["youtube.com", "youtu.be", "youtube-nocookie.com", "spotify.com", "spotify.link", "soundcloud.com"];

/** 알려진 사이트의 주소인가. 직접 링크(파일, 방송 주소), 검색어와 구분한다. 공백 없는 spotify: 는 URI 모양이다(사람이 쓴 "spotify: 노래" 는 검색어) */
function isKnownSiteHost(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (/^spotify:\S+$/i.test(value.trim())) return true;
  try {
    const host = new URL(value.trim()).hostname.toLowerCase().replace(/\.$/, "");
    return KNOWN_SITE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
  } catch {
    return false;
  }
}

// ── 스킴을 뺀 주소 ──

/**
 * 스킴(https://)을 뺀 알려진 사이트 주소(youtube.com/watch?v=…, youtu.be/…, open.spotify.com/track/…)면 https:// 를 붙인 주소, 아니면 받은 그대로.
 * 알려진 사이트만 본다. 점이 든 이름(will.i.am), 공백이 든 글은 검색어로 둔다
 */
function withSiteScheme(text: string): string {
  if (!text || /\s/.test(text) || /^[a-z][a-z\d+.-]*:\/\//i.test(text) || /^spotify:/i.test(text)) return text;
  const full = `https://${text}`;
  return isKnownSiteHost(full) ? full : text;
}

// ── 링크인가 ──

/** http, https 주소인가. 링크가 아닌 텍스트(검색어)와 구분한다 */
function isHttpLink(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value.trim());
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export { isHttpLink, readSiteUrl, parseYouTube, isYouTubeHost, isYouTubeURL, isYouTubePlaylist, youtubeWatchUrl, extractVideoId, extractPlaylistId, youtubeListOf, isSpotifyURL, parseSpotify, isSoundCloudURL, parseSoundCloud, isKnownSiteHost, withSiteScheme };
