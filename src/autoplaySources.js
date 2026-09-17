"use strict";

// 자동재생 소스 — 설정 한 줄을 곡 목록으로 바꾼다. 부르는 곳이 다를 뿐 계약은 하나다.
//
//   { artist?, title, durationSec?, audioUrl?, youtubeUrl?, thumbnail?, sourceKey,
//     sourceUrl?, platform? }
//
// 뒤의 처리는 **어느 칸이 찼는지가 정한다** — 유형을 따로 적어 두지 않는다.
//   youtubeUrl 있음 → 그 영상을 튼다
//   artist+title   → youtubeMatch로 찾는다 (durationSec이 있으면 길이 신호가 켜진다)
//   audioUrl 있음  → 위가 안 되면 이것을 그대로 튼다
//
// `sourceUrl`·`platform`은 **곡이 어디 것인가**를 말한다. 이게 있으면 유튜브 영상은 소리를 대는
// 곳일 뿐이고, 표시 이름과 캐시 장부의 칸은 출처 것이 된다(스포티파이와 같은 처지 — autoplayRoute 참고).
// keyword·유튜브 재생목록은 영상 자체가 출처라 이 칸을 비워 둔다.
//
// 한 파일에 모은 까닭: 소스마다 20~40줄이고 지켜야 할 계약이 같다. 흩어 두면 계약이 안 보인다.

const config = require("../config");
const log = require("./logger").child({ category: "autoplay" });

const UA = "Discord-Musicbot-Project (autoplay)";
const TIMEOUT_MS = 15000;
// LB Radio는 재생목록을 그때그때 짜 주느라 느리다(실측 5~15초, 더 걸리기도 한다).
// 15초로는 자주 끊겨 멀쩡한 소스가 빈손으로 취급된다.
const SLOW_MS = 30000;
const rand = (n) => Math.floor(Math.random() * n);
const pick = (list) => (list.length ? list[rand(list.length)] : null);

async function getJson(url, headers = {}, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${new URL(url).host})`);
  return res.json();
}

// 배열 옵션은 이름 뒤에 []를 붙여야 듣는다. 안 붙이면 400도 아니고 **조용히 무시된다**
// — VocaDB 계열에서 가장 흔한 함정이라 여기 한 곳에서 책임진다.
function query(params) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      for (const one of value) q.append(`${key}[]`, one);
    } else q.append(key, value);
  }
  return q.toString();
}

// ── keyword ───────────────────────────────────────────────────────────────
// 옛 길. 유튜브 검색 결과를 그대로 후보로 삼는다 — 품질이 제일 낮으니 weight를 낮게 주는 편이 낫다.
async function keyword(source) {
  const word = pick(source.keywords || []);
  if (!word) return [];
  const YouTube = require("./YouTube");
  const results = (await YouTube.search(word, 15)) || [];
  return results.filter((r) => r.url && !r.isLive).map((r) => ({ title: r.title, durationSec: r.duration, youtubeUrl: r.url, thumbnail: r.thumbnail, sourceKey: `yt:${r.id}` }));
}

// ── lastfm ────────────────────────────────────────────────────────────────
// 길이를 안 준다(정 유형). 깊은 쪽이 오히려 알차므로 무작위 쪽을 퍼 올린다.
async function lastfm(source) {
  const key = config.sources?.lastfmKey;
  if (!key) throw new Error("LASTFM_API_KEY가 없습니다");
  const tag = pick(source.tags || []);
  if (!tag) return [];

  const page = 1 + rand(Math.max(1, Number(source.pages) || 5));
  const url = `https://ws.audioscrobbler.com/2.0/?${query({ method: "tag.getTopTracks", tag, limit: 1000, page, api_key: key, format: "json" })}`;
  const list = (await getJson(url))?.tracks?.track || [];
  return list
    .map((t) => ({
      artist: t.artist?.name || "",
      title: t.name || "",
      sourceUrl: t.url || undefined, // Last.fm 곡 페이지가 곧 출처 주소다
      platform: "lastfm",
      sourceKey: t.url || `${t.artist?.name}|${t.name}`,
    }))
    .filter((t) => t.artist && t.title);
}

// ── lbradio ───────────────────────────────────────────────────────────────
// 호출마다 50곡을 새로 짠다. **길이를 준다**(병 유형) — youtubeMatch의 길이 신호가 켜진다.
async function lbradio(source) {
  const token = config.sources?.listenbrainzToken;
  if (!token) throw new Error("LISTENBRAINZ_TOKEN이 없습니다");
  const prompt = source.prompt || (source.tags?.length ? `tag:(${source.tags.join(",")})` : "");
  if (!prompt) return [];

  const url = `https://api.listenbrainz.org/1/explore/lb-radio?${query({ prompt, mode: source.mode || "easy" })}`;
  const list = (await getJson(url, { Authorization: `Token ${token}` }, SLOW_MS))?.payload?.jspf?.playlist?.track || [];
  return list
    .map((t) => ({
      artist: t.creator || "",
      title: t.title || "",
      // 200곡 중 196곡에 길이가 있었다. 없는 것은 정 유형으로 떨어져 필터를 탄다.
      durationSec: Number(t.duration) > 0 ? Math.round(Number(t.duration) / 1000) : undefined,
      sourceUrl: t.identifier?.[0] || undefined, // MusicBrainz 녹음 주소
      platform: "lbradio",
      sourceKey: String(t.identifier?.[0] || `${t.creator}|${t.title}`),
    }))
    .filter((t) => t.artist && t.title);
}

// ── animethemes ───────────────────────────────────────────────────────────
// 음원(.ogg)을 직접 준다. 다만 TV 사이즈(중앙값 90초)라 artist+title도 같이 채워 보낸다
// — 부르는 쪽이 유튜브에서 풀버전을 먼저 찾고 못 찾으면 이 음원으로 떨어진다.
const SEASON_ORDER = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
const THEME_PARTS = "song.artists,animethemeentries.videos.audio";

async function animethemes(source) {
  const narrowed = source.yearFrom || source.yearTo || source.season?.length || source.mediaFormat?.length;
  const themes = narrowed ? await themesByAnime(source) : await themesAtRandom(source);

  const out = [];
  const seen = new Set();
  for (const theme of themes) {
    const song = theme.song;
    if (!song?.title) continue;
    // 같은 곡이 여러 시즌의 OP일 수 있다 — 겹침은 animetheme.id가 아니라 song.id로 막는다
    if (seen.has(song.id)) continue;

    const videos = (theme.animethemeentries || []).flatMap((e) => e.videos || []);
    // overlap이 None인 판본이 하나도 없으면 음원에 대사가 얹혀 있다(60곡 중 5곡). 그것만 버린다.
    const clean = videos.find((v) => v.overlap === "None");
    if (videos.length && !clean) continue;
    const audio = (clean || videos[0])?.audio;
    if (!audio?.link) continue;

    seen.add(song.id);
    out.push({
      artist: (song.artists || []).map((a) => a.name).join(", ") || theme.anime?.name || "",
      title: song.title,
      audioUrl: audio.link,
      thumbnail: (theme.anime?.images || []).find((i) => /large/i.test(i.facet))?.link || null,
      sourceUrl: theme.anime?.slug ? `https://animethemes.moe/anime/${theme.anime.slug}` : undefined,
      platform: "animethemes",
      sourceKey: `at:${song.id}`,
    });
  }
  return out;
}

// 조건이 없으면 sort=random 한 번이면 된다(100건까지).
async function themesAtRandom(source) {
  const url = `https://api.animethemes.moe/animetheme?${query({
    sort: "random",
    "page[size]": 100,
    include: `anime.images,${THEME_PARTS}`,
    "filter[type]": source.themeType,
    "filter[sequence]": source.sequence,
  })}`;
  return (await getJson(url))?.animethemes || [];
}

// 연도·시즌·매체는 animetheme 쪽에서 **조용히 무시된다.** anime 쪽에 걸어야 듣는다.
// 시즌은 범위 문법이 없어 연도로만 자르고 양끝 시즌은 우리가 걸러낸다.
async function themesByAnime(source) {
  const url = `https://api.animethemes.moe/anime?${query({
    sort: "random",
    "page[size]": 25,
    include: `images,animethemes.${THEME_PARTS.split(",").join(",animethemes.")}`,
    "filter[year-gte]": source.yearFrom,
    "filter[year-lte]": source.yearTo,
    "filter[season]": source.season?.join(","),
    "filter[media_format]": source.mediaFormat?.join(","),
  })}`;
  const list = (await getJson(url))?.anime || [];

  const from = source.yearFrom ? source.yearFrom * 4 + (SEASON_ORDER[source.seasonFrom] ?? 0) : -Infinity;
  const to = source.yearTo ? source.yearTo * 4 + (SEASON_ORDER[source.seasonTo] ?? 3) : Infinity;

  const out = [];
  for (const anime of list) {
    const at = anime.year * 4 + (SEASON_ORDER[anime.season] ?? 0);
    if (at < from || at > to) continue;
    for (const theme of anime.animethemes || []) {
      if (source.themeType && theme.type !== source.themeType) continue;
      if (source.sequence && theme.sequence !== source.sequence) continue;
      out.push({ ...theme, anime });
    }
  }
  return out;
}

// ── vocadb 계열 ───────────────────────────────────────────────────────────
// **유튜브 주소를 직접 준다** — 검색도 매칭도 없다. 셋이 같은 소프트웨어라 코드도 같다.
const VOCA_HOSTS = { vocadb: "vocadb.net", utaitedb: "utaitedb.net", touhoudb: "touhoudb.com" };
const VOCA_PAGE = 50;

// 기본 곡 종류가 사이트마다 다르다 — **우타이테는 남의 곡을 부르는 사람들**이라 Original로 받으면
// 정작 우타이테가 아니라 보컬로이드 원곡이 온다(MARETU feat. 初音ミク 같은 것).
const VOCA_DEFAULT_TYPES = { utaitedb: ["Cover"] };

async function vocaFamily(source) {
  const base = `https://${VOCA_HOSTS[source.type]}/api/songs`;
  const filters = {
    tagName: source.tags,
    songTypes: (source.songTypes || VOCA_DEFAULT_TYPES[source.type] || ["Original"]).join(","),
    languages: source.languages,
    minScore: source.minScore,
    minLength: source.minLength,
    maxLength: source.maxLength,
    minMilliBpm: source.minBpm ? source.minBpm * 1000 : undefined,
    maxMilliBpm: source.maxBpm ? source.maxBpm * 1000 : undefined,
    afterDate: source.yearFrom ? `${source.yearFrom}-01-01` : undefined,
    beforeDate: source.yearTo ? `${source.yearTo}-12-31` : undefined,
    artistId: source.artistIds,
    childVoicebanks: source.artistIds?.length ? true : undefined,
    // 우리가 틀 수 있는 것만. 다른 서비스는 받아도 못 튼다.
    pvServices: "Youtube",
    onlyWithPvs: true,
    sort: source.sort || "RatingScore",
  };

  // 깊은 곳에서 집으려면 전체 개수를 먼저 알아야 한다
  const head = await getJson(`${base}?${query({ ...filters, maxResults: 1, getTotalCount: true })}`);
  const total = Number(head?.totalCount) || 0;
  if (!total) return [];

  // fields=Names로 원어·로마자·영문이 한 번에 온다 — 표기를 고를 일이 없다
  const start = total > VOCA_PAGE ? rand(total - VOCA_PAGE) : 0;
  const page = await getJson(`${base}?${query({ ...filters, maxResults: VOCA_PAGE, start, fields: "PVs,Artists,Names,ThumbUrl" })}`);

  const out = [];
  for (const song of page?.items || []) {
    const pvs = song.pvs || [];
    const pv = pvs.find((p) => p.service === "Youtube" && p.pvType === "Original") || pvs.find((p) => p.service === "Youtube");
    if (!pv?.url || !song.name) continue;
    out.push({
      artist: creditOf(song) || song.artistString || "",
      title: song.name,
      youtubeUrl: pv.url,
      // 기본 응답에 들어 있다(100곡 중 빈 것 0개). 없으면 길이 제한에 걸려 통째로 떨어진다.
      durationSec: Number(song.lengthSeconds) || undefined,
      thumbnail: song.thumbUrl || null,
      sourceUrl: `https://${VOCA_HOSTS[source.type]}/S/${song.id}`,
      platform: source.type,
      sourceKey: `${source.type}:${song.id}`,
    });
  }
  return out;
}

// artistString은 애니메이터·일러스트레이터까지 다 붙인 것이다 — 만든 사람과 부른 쪽만 추린다.
function creditOf(song) {
  const roles = (want) => (song.artists || []).filter((a) => String(a.categories || "").includes(want)).map((a) => a.name);
  const makers = roles("Producer");
  const singers = roles("Vocalist");
  return [makers.join(", "), singers.join(", ")].filter(Boolean).join(" feat. ");
}

// ── 재생목록 ──────────────────────────────────────────────────────────────
// 통째로 받지 않는다. total을 알면 무작위 오프셋으로 한 구간만 집어 온다.
const PLAYLIST_PAGE = 50;

async function spotify(source) {
  if (!source.url) return [];
  const Spotify = require("./Spotify");
  const head = await Spotify.getCollection(source.url, { offset: 0, limit: 1 });
  const total = Number(head?.total) || 0;
  const offset = total > PLAYLIST_PAGE ? rand(total - PLAYLIST_PAGE) : 0;
  const part = await Spotify.getCollection(source.url, { offset, limit: PLAYLIST_PAGE });
  return (part?.tracks || []).filter((t) => t.title && t.artist).map((t) => ({ artist: t.artist, title: t.title, durationSec: Number(t.duration) || undefined, thumbnail: t.thumbnail, sourceUrl: t.url || undefined, platform: "spotify", sourceKey: t.url || `${t.artist}|${t.title}` }));
}

async function youtube(source) {
  if (!source.url) return [];
  const YouTube = require("./YouTube");
  const head = await YouTube.getPlaylist(source.url, { offset: 0, limit: 1 });
  // 믹스(RD…)는 total이 null이다 — 끝이 없어 무작위 오프셋을 쓸 수 없다
  const total = Number(head?.total) || 0;
  if (!total) throw new Error("재생목록의 곡 수를 알 수 없습니다(유튜브 믹스는 소스로 쓸 수 없습니다)");

  const offset = total > PLAYLIST_PAGE ? rand(total - PLAYLIST_PAGE) : 0;
  const part = await YouTube.getPlaylist(source.url, { offset, limit: PLAYLIST_PAGE });
  // 재생목록은 아티스트가 안 온다(제목뿐) — 그래서 youtubeMatch를 거치지 않고 주소를 그대로 쓴다
  return (part?.tracks || []).filter((t) => t.url && !t.isLive).map((t) => ({ title: t.title, durationSec: Number(t.duration) || undefined, youtubeUrl: t.url, thumbnail: t.thumbnail, sourceKey: t.url }));
}

// ── 등록부 ────────────────────────────────────────────────────────────────

const FETCHERS = { keyword, lastfm, lbradio, animethemes, vocadb: vocaFamily, utaitedb: vocaFamily, touhoudb: vocaFamily, spotify, youtube };

/**
 * 소스 타입 명세 — **설정 검증과 실행이 같은 표를 본다.**
 *
 *   label  사람에게 보일 이름(기동 경고 문구에 쓴다)
 *   need   반드시 있어야 하는 값. 안쪽 배열은 "이 중 **하나**는 있어야 한다"
 *   env    .env에 있어야 하는 이름(없으면 그 소스만 못 쓴다)
 *
 * 고를 수 있는 값 전체와 왜 어떤 것을 안 내놓는지는
 * notes/plan-autoplay-routes.md의 "소스별 설정 옵션"에 적어 두었다.
 */
const SPEC = {
  keyword: { label: "키워드", need: [["keywords"]] },
  lastfm: { label: "Last.fm", need: [["tags"]], env: "LASTFM_API_KEY", has: () => !!config.sources?.lastfmKey },
  lbradio: { label: "ListenBrainz", need: [["tags", "prompt"]], env: "LISTENBRAINZ_TOKEN", has: () => !!config.sources?.listenbrainzToken },
  animethemes: { label: "AnimeThemes", need: [] },
  vocadb: { label: "VocaDB", need: [] },
  utaitedb: { label: "UtaiteDB", need: [] },
  touhoudb: { label: "TouhouDB", need: [] },
  spotify: { label: "스포티파이", need: [["url"]], env: "SPOTIFY_CLIENT_ID", has: () => !!config.spotify?.clientId },
  youtube: { label: "유튜브 재생목록", need: [["url"]] },
};

const TYPES = Object.keys(FETCHERS);

/** 이 타입을 지금 쓸 수 있나 — 키가 필요한 소스는 키가 있어야 한다. */
const usable = (type) => (SPEC[type] ? !SPEC[type].has || SPEC[type].has() : false);

/** 이 타입이 무엇을 필요로 하는지(없으면 null) — 기동 시 문구를 만들 때 쓴다. */
const needsOf = (type) => (SPEC[type]?.env ? { env: SPEC[type].env, label: SPEC[type].label } : null);

/** 설정에 적힌 소스 하나를 곡 목록으로. 던지면 부르는 쪽이 다음 소스로 넘어간다. */
async function fetchFrom(source) {
  const fetcher = FETCHERS[source?.type];
  if (!fetcher) throw new Error(`모르는 소스입니다: ${source?.type}`);
  const tracks = await fetcher(source);
  log.debug(`${source.type}: ${tracks.length}곡`);
  return tracks;
}

module.exports = { fetchFrom, TYPES, SPEC, usable, needsOf };
