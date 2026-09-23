"use strict";

// 자동재생 소스. 설정 한 줄을 곡 목록으로 바꾼다. 부르는 곳이 다를 뿐 계약은 하나다.
//
//   { artist?, title, durationSec?, audioUrl?, youtubeUrl?, thumbnail?, sourceKey,
//     sourceUrl?, platform? }
//
// 뒤의 처리는 어느 칸이 찼는지가 정한다. 유형을 따로 적어 두지 않는다.
//   youtubeUrl 있음 → 그 영상을 튼다
//   artist+title   → youtubeMatch로 찾는다 (durationSec이 있으면 길이 신호가 켜진다)
//   audioUrl 있음  → 위가 안 되면 이것을 그대로 튼다
//
// `sourceUrl`·`platform`은 곡이 어디 것인가를 말한다. 이게 있으면 유튜브 영상은 소리를 대는
// 곳일 뿐이고, 표시 이름과 캐시 장부의 칸은 출처 것이 된다(autoplayRoute 참고).
// keyword·유튜브 재생목록은 영상 자체가 출처라 이 칸을 비워 둔다.

const config = require("../../../config");
const log = require("../../infra/log/logger").child({ category: "autoplay" });
const { ANISONG_SONG_TYPES, ANISONG_ANIME_TYPES, ANISONG_CATEGORIES, ANISONG_BROADCASTS, VOCA_DEFAULT_TYPES, opts, SPEC, usable, needsOf } = require("../../config/schema/genreSources");

const UA = config.userAgents.bot;
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

// getJson의 형제. 필터를 본문으로 받는 API용.
// 422 는 응답 본문을 같이 남긴다. 어느 값이 틀렸는지 저쪽이 적어 주는데, 상태 코드만 남기면
// 설정이 조용히 빈손이 되는 이유를 알 수 없다.
async function postJson(url, body, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = res.status === 422 ? await res.text().catch(() => "") : "";
    throw new Error(`HTTP ${res.status} (${new URL(url).host})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return res.json();
}

// 배열 옵션은 이름 뒤에 []를 붙여야 듣는다. 안 붙이면 400도 아니고 조용히 무시된다
// VocaDB 계열에서 가장 흔한 함정이라 여기 한 곳에서 책임진다.
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
// 옛 길. 유튜브 검색 결과를 그대로 후보로 삼는다. 품질이 제일 낮으니 weight를 낮게 주는 편이 낫다.
async function keyword(source) {
  const word = pick(source.keywords || []);
  if (!word) return [];
  const YouTube = require("../../sources/youtube/index");
  const results = (await YouTube.search(word, 15)) || [];
  // fromSearch: 검색 결과라 제목을 못 믿는다는 표시다. AI 보조가 이것만 판정한다(autoplayAssist)
  // 주소를 직접 주는 소스는 출처가 곧 정답이라 물을 것이 없다.
  return results.filter((r) => r.url && !r.isLive).map((r) => ({ title: r.title, durationSec: r.duration, youtubeUrl: r.url, thumbnail: r.thumbnail, fromSearch: true, sourceKey: `yt:${r.id}` }));
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
// 호출마다 50곡을 새로 짠다. 길이를 준다(병 유형). youtubeMatch의 길이 신호가 켜진다.
async function lbradio(source) {
  const token = config.sources?.listenbrainzToken;
  if (!token) throw new Error("LISTENBRAINZ_TOKEN이 없습니다");
  // 기본은 hard다. 이름과 반대로 hard 쪽이 더 알려진 곡을 준다. 모드는 태그 폭을 바꾼다
  // (easy는 적은 태그만, hard는 비슷한 태그까지 끌어와서 그만큼 큰 아티스트가 섞인다).
  const modes = [].concat(source.mode || "hard");

  // mode 파라미터는 하나만 받지만(둘을 주면 400), 프롬프트 안에서는 원소마다 지정할 수 있다.
  // 그래서 `mode: [easy, hard]` 를 한 번의 요청으로 섞을 수 있다. 50곡을 나눠 채워 준다.
  const tagPart = source.tags?.length ? `tag:(${source.tags.join(",")})` : "";
  const prompt = source.prompt || (tagPart ? modes.map((m) => `${tagPart}::${m}`).join(" ") : "");
  if (!prompt) return [];

  const url = `https://api.listenbrainz.org/1/explore/lb-radio?${query({ prompt, mode: modes[0] })}`;
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
    .filter((t) => t.artist && t.title && !PLACEHOLDER.test(t.artist) && !PLACEHOLDER.test(t.title));
}

// MusicBrainz는 아티스트·곡을 모를 때 정해진 이름으로 자리를 채운다.
// 그대로 두면 그걸 유튜브에 검색하게 된다(250곡 중 1곡꼴).
//
// 대괄호로 싸였다고 다 거르면 안 된다. `[Alexandros]`는 실존하는 일본 록밴드다.
// 그래서 정해진 목록만 본다. https://musicbrainz.org/doc/Style/Unknown_and_untitled
const PLACEHOLDERS = new Set(["[no artist]", "[unknown]", "[anonymous]", "[nobody]", "[traditional]", "[data]", "[dialogue]", "[silence]", "[untitled]", "[unknown]"].map((s) => s.toLowerCase()));
const PLACEHOLDER = {
  test: (value) =>
    PLACEHOLDERS.has(
      String(value || "")
        .trim()
        .toLowerCase(),
    ),
};

// ── animethemes ───────────────────────────────────────────────────────────
// 음원(.ogg)을 직접 준다. 다만 TV 사이즈(중앙값 90초)라 artist+title도 같이 채워 보낸다
// 부르는 쪽이 유튜브에서 풀버전을 먼저 찾고 못 찾으면 이 음원으로 떨어진다.
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
    // 같은 곡이 여러 시즌의 OP일 수 있다. 겹침은 animetheme.id가 아니라 song.id로 막는다
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

// 연도·시즌·매체는 animetheme 쪽에서 조용히 무시된다. anime 쪽에 걸어야 듣는다.
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

// ── anisongdb ─────────────────────────────────────────────────────────────
// AMQ 기반 애니송 DB. AnimeThemes와 같은 갑 유형(음원 직접)이지만 곡 단위 인지도
// (songDifficulty)가 있어 "유명한 곡만"을 걸 수 있다.
const ANISONG = "https://anisongdb.com/api";

// 장르·태그 목록과 난이도 분포. 하루 한 번만 묻는다.
let anisongStats = null;
let anisongStatsAt = 0;

/** 화면이 고를 값을 저쪽에 물어 채운다. 못 받으면 null(빈 목록으로 그린다). */
async function anisongCatalog() {
  if (anisongStats && Date.now() - anisongStatsAt < YEAR_TTL_MS) return anisongStats;
  try {
    const stats = await getJson(`${ANISONG}/database_stats`);
    const seasons = Object.keys(stats?.songs_by_season || {});
    const years = seasons.map((one) => Number(String(one).match(/\d{4}/)?.[0])).filter(Boolean);
    // 0칸은 난이도가 아니라 결측이다(미디어가 없어 출제된 적 없는 곡). 범위 필터도 기본으로
    // 빼므로 여기서도 뺀다. 안 빼면 슬라이더 옆 분포에 없는 봉우리가 생긴다.
    const histogram = Array.isArray(stats?.songs_by_difficulty) ? stats.songs_by_difficulty.slice(1) : [];
    anisongStats = {
      genres: Object.keys(stats?.songs_by_genre || {}),
      tags: Object.keys(stats?.songs_by_tag || {}),
      difficulty: histogram,
      // 1920~30년대에 한두 곡이 있어 슬라이더가 백 해 너비가 된다. 저쪽도 그 해를
      // 고를 수 있게 두므로 우리도 자르지 않는다.
      ...(years.length ? { min: Math.min(...years), max: Math.max(...years) } : {}),
    };
    anisongStatsAt = Date.now();
  } catch (error) {
    log.debug(`AnisongDB 목록을 받아오지 못했습니다: ${error.message}`);
  }
  return anisongStats;
}

/**
 * 설정 한 줄을 저쪽이 받는 filters 로.
 *
 * 안 적은 칸은 아예 빼야 한다. 빈 배열은 minItems 1 에 걸려 422.
 * `include_no_difficulty` 는 켜지 않는다. 난이도 0·null 은 값이 아니라 결측이다.
 */
function anisongFilters(source) {
  const list = (v, allowed) => {
    const kept = [].concat(v || []).map((one) => String(one).toLowerCase());
    const ok = kept.filter((one) => allowed.includes(one));
    return ok.length ? ok : null;
  };
  const labels = (v) => {
    const kept = [].concat(v || []).filter((one) => String(one).trim());
    return kept.length ? { require_any: kept } : null;
  };
  const season = (s, y, fallback) => (y ? `${s || fallback} ${y}` : null);

  const filters = {
    // 삽입곡은 기본으로 끈다. 폭이 쓸데없이 넓어진다
    song_types: list(source.songTypes, ANISONG_SONG_TYPES) || ["opening", "ending"],
    song_categories: list(source.songCategories, ANISONG_CATEGORIES) || ["standard"],
    broadcasts: list(source.broadcasts, ANISONG_BROADCASTS) || ["normal"],
    // require_any 는 OR(require_all 이 AND). HQ 를 같이 받는 이유는 저쪽이 영상을 먼저 올리고
    // 음원 추출을 나중에 해서, 최신 분기로 좁히면 영상만 있는 곡이 넷 중 하나꼴이기 때문이다.
    media_links: { require_any: ["audio", "HQ"] },
  };

  const animeTypes = list(source.animeTypes, ANISONG_ANIME_TYPES);
  if (animeTypes) filters.anime_types = animeTypes;

  const genres = labels(source.genres);
  if (genres) filters.genres = genres;
  const tags = labels(source.tags);
  if (tags) filters.tags = tags;

  // 저쪽이 양끝을 다 받는다. 0 은 결측이라 하한은 1 부터다
  const from = Number(source.difficultyFrom);
  const to = Number(source.difficultyTo);
  if (from > 0 || to > 0) {
    filters.difficulty = {
      start: from > 0 ? Math.min(100, from) : 1,
      end: to > 0 ? Math.min(100, to) : 100,
    };
  }

  // AnimeThemes와 달리 저쪽이 범위를 받으므로 우리가 양끝을 자를 일이 없다
  const start = season(source.seasonFrom, source.yearFrom, "Winter");
  const end = season(source.seasonTo, source.yearTo, "Fall");
  if (start || end) filters.season = { ...(start && { start }), ...(end && { end }) };

  return filters;
}

// 음원 호스트. 저쪽 미러 셋이 같은 파일을 갖고 있지만 하나로 고정해야 한다. 이 주소가
// 캐시 장부의 열쇠이자 최근 재생 판정에 쓰여서, 섞으면 같은 곡이 두 칸으로 갈린다.
// files.catbox.moe 는 미러가 아니므로 쓰지 않는다(없는 파일이 있다).
const ANISONG_HOST = "https://nawdist.animemusicquiz.com";

// AnisongDB 는 표지를 안 준다. 작품 ID 가 후보에 실려 오므로 AniList 에서 받아 온다.
// 분당 30회 제한이 있어 곡마다 치면 닿는다. 한 번 채울 때 묶어서 두 번만 묻는다.
const ANILIST = "https://graphql.anilist.co";
const ANILIST_BATCH = 50;
const COVER_QUERY = `query($ids:[Int]){Page(perPage:${ANILIST_BATCH}){media(id_in:$ids,type:ANIME){id coverImage{extraLarge large}}}}`;

/** 작품 ID 배열 → 표지 주소 Map. 못 받으면 그만큼 빈다(그림 없이 튼다). */
async function anilistCovers(ids) {
  const covers = new Map();
  for (let i = 0; i < ids.length; i += ANILIST_BATCH) {
    try {
      const body = await postJson(ANILIST, { query: COVER_QUERY, variables: { ids: ids.slice(i, i + ANILIST_BATCH) } });
      for (const media of body?.data?.Page?.media || []) {
        const url = media?.coverImage?.extraLarge || media?.coverImage?.large;
        if (media?.id && url) covers.set(media.id, url);
      }
    } catch (error) {
      // 표지가 없어도 곡은 튼다. 소스를 죽일 이유가 아니다
      log.debug(`AniList 표지를 받아오지 못했습니다: ${error.message}`);
    }
  }
  return covers;
}

async function anisongdb(source) {
  // 500까지 받을 수 있지만 뽑는 것은 3분에 한 곡이라 100이면 풀 TTL을 버틴다.
  // 조건에 맞는 곡이 n보다 적으면 그 전부가 온다.
  const n = Math.min(500, Math.max(1, Number(source.n) || 100));
  const songs = await postJson(`${ANISONG}/get_n_random_songs`, { n, filters: anisongFilters(source) });

  const out = [];
  const seen = new Set();
  for (const song of songs || []) {
    if (!song?.songName) continue;
    // amqSongId 가 곡 단위다. annSongId 는 (애니, 곡) 쌍이라 속편·OVA·극장판에 다시 쓰인
    // 같은 곡을 서로 다른 것으로 센다.
    const id = song.amqSongId ?? song.annSongId;
    if (id == null || seen.has(id)) continue;

    // 음원이 없으면 영상에서 소리를 뺀다. ffmpeg 인자는 손댈 것이 없다.
    // `-f opus`가 오디오 전용 컨테이너라 알아서 소리만 고른다.
    const file = song.audio || song.HQ;
    if (!file) continue;

    seen.add(id);
    out.push({
      artist: song.songArtist || song.animeENName || "",
      title: song.songName,
      audioUrl: `${ANISONG_HOST}/${file}`,
      // 곡마다 있는 웹페이지가 없어 작품 페이지를 쓴다.
      // AniList가 드물게 비어 있고 annId는 늘 있으므로 이어 쓴다.
      sourceUrl: song.linked_ids?.anilist ? `https://anilist.co/anime/${song.linked_ids.anilist}` : `https://www.animenewsnetwork.com/encyclopedia/anime.php?id=${song.annId}`,
      platform: "anisongdb",
      sourceKey: `amq:${id}`,
      _anilist: song.linked_ids?.anilist || null,
      // songLength 를 durationSec 으로 싣지 않는다. 곡 길이가 아니라 AMQ 클립 길이라
      // 유튜브에서 풀버전을 찾을 때 오답을 부른다.
    });
  }

  const covers = await anilistCovers([...new Set(out.map((c) => c._anilist).filter(Boolean))]);
  for (const cand of out) {
    cand.thumbnail = covers.get(cand._anilist) || null;
    delete cand._anilist;
  }
  return out;
}

// ── vocadb 계열 ───────────────────────────────────────────────────────────
// 유튜브 주소를 직접 준다. 검색도 매칭도 없다. 셋이 같은 소프트웨어라 코드도 같다.
const VOCA_HOSTS = { vocadb: "vocadb.net", utaitedb: "utaitedb.net", touhoudb: "touhoudb.com" };
const VOCA_PAGE = 50;

// 가사 언어. `languages` 파라미터는 조용히 무시된다. 쓰레기 값을 넣어도 전체가 온다.
// 실제로 듣는 것은 웹이 쓰는 advancedFilters 쪽이고, 한 번에 하나만 걸린다:
// 둘을 걸면 "둘 다 있는 곡"이 되어 ja+ko 가 2,054곡에서 347곡으로 줄어든다(실측 2026-09-18).
function lyricsFilter(one) {
  return one ? { "advancedFilters[0][filterType]": "Lyrics", "advancedFilters[0][param]": one } : {};
}

// 그래서 고른 언어마다 따로 받아 섞는다. 언어 하나에 요청이 두 번이라 한 판에 도는 수를 묶어 두고,
// 그보다 많이 골랐으면 그때그때 몇 개만 뽑는다. 판마다 달라지니 여러 번 돌면 고르게 섞인다.
const LANGS_PER_FETCH = 5;
function someLanguages(list) {
  const all = list || [];
  if (all.length <= LANGS_PER_FETCH) return all.length ? all : [null];
  const left = [...all];
  return Array.from({ length: LANGS_PER_FETCH }, () => left.splice(rand(left.length), 1)[0]);
}

async function vocaFamily(source) {
  const base = `https://${VOCA_HOSTS[source.type]}/api/songs`;
  const common = {
    tagName: source.tags,
    songTypes: (source.songTypes || VOCA_DEFAULT_TYPES[source.type] || ["Original"]).join(","),
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

  const out = [];
  const seen = new Set();
  let failure = null;
  for (const lang of someLanguages(source.languages)) {
    // 언어마다 요청이 두 번이다. 하나가 실패했다고 나머지까지 버릴 이유는 없다.
    // 하나도 못 받았을 때만 던져서 부르는 쪽이 다음 소스로 넘어가게 한다.
    try {
      for (const track of await vocaWindow(base, { ...common, ...lyricsFilter(lang) }, source.type)) {
        // 같은 곡이 여러 언어에 걸린다. 번역 가사까지 세기 때문이다
        if (seen.has(track.sourceKey)) continue;
        seen.add(track.sourceKey);
        out.push(track);
      }
    } catch (error) {
      failure = failure || error;
      log.debug(`${source.type} ${lang || "전체"}: ${error.message}`);
    }
  }
  if (!out.length && failure) throw failure;
  return out;
}

// 조건에 맞는 곡 중 아무 데나 한 창(50곡)을 떠 온다.
async function vocaWindow(base, filters, type) {
  // 깊은 곳에서 집으려면 전체 개수를 먼저 알아야 한다
  const head = await getJson(`${base}?${query({ ...filters, maxResults: 1, getTotalCount: true })}`);
  const total = Number(head?.totalCount) || 0;
  if (!total) return [];

  // fields=Names로 원어·로마자·영문이 한 번에 온다. 표기를 고를 일이 없다
  const start = total > VOCA_PAGE ? rand(total - VOCA_PAGE) : 0;
  const page = await getJson(`${base}?${query({ ...filters, maxResults: VOCA_PAGE, start, fields: "PVs,Artists,Names,ThumbUrl" })}`);

  const out = [];
  for (const song of page?.items || []) {
    // disabled 를 꼭 봐야 한다. 저쪽은 영상이 내려간 것을 알고 표시해 두는데(웹에서 "PV 사용할
    // 수 없음"으로 회색이 되는 그것), 그걸 무시하면 죽은 영상을 골라 재생이 실패한다.
    // 실측: vocadb 100곡 중 10곡에 죽은 PV가 섞여 있다. Bad Apple!! 은 죽은 Original 다음에
    // 멀쩡한 Original 이 있어서, 안 보면 정확히 틀린 것을 집는다.
    const pvs = (song.pvs || []).filter((p) => p.service === "Youtube" && !p.disabled);
    const pv = pvs.find((p) => p.pvType === "Original") || pvs[0];
    if (!pv?.url || !song.name) continue;
    out.push({
      artist: creditOf(song) || song.artistString || "",
      title: song.name,
      youtubeUrl: pv.url,
      // 기본 응답에 들어 있다(100곡 중 빈 것 0개). 없으면 길이 제한에 걸려 통째로 떨어진다.
      durationSec: Number(song.lengthSeconds) || undefined,
      thumbnail: song.thumbUrl || null,
      sourceUrl: `https://${VOCA_HOSTS[type]}/S/${song.id}`,
      platform: type,
      sourceKey: `${type}:${song.id}`,
    });
  }
  return out;
}

// artistString은 애니메이터·일러스트레이터까지 다 붙인 것이다. 만든 사람과 부른 쪽만 추린다.
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
  const Spotify = require("../../sources/spotify");
  const head = await Spotify.getCollection(source.url, { offset: 0, limit: 1 });
  const total = Number(head?.total) || 0;
  const offset = total > PLAYLIST_PAGE ? rand(total - PLAYLIST_PAGE) : 0;
  const part = await Spotify.getCollection(source.url, { offset, limit: PLAYLIST_PAGE });
  return (part?.tracks || []).filter((t) => t.title && t.artist).map((t) => ({ artist: t.artist, title: t.title, durationSec: Number(t.duration) || undefined, thumbnail: t.thumbnail, sourceUrl: t.url || undefined, platform: "spotify", sourceKey: t.url || `${t.artist}|${t.title}` }));
}

async function youtube(source) {
  if (!source.url) return [];
  const YouTube = require("../../sources/youtube/index");
  const head = await YouTube.getPlaylist(source.url, { offset: 0, limit: 1 });
  // 믹스(RD…)는 total이 null이다. 끝이 없어 무작위 오프셋을 쓸 수 없다
  const total = Number(head?.total) || 0;
  if (!total) throw new Error("재생목록의 곡 수를 알 수 없습니다(유튜브 믹스는 소스로 쓸 수 없습니다)");

  const offset = total > PLAYLIST_PAGE ? rand(total - PLAYLIST_PAGE) : 0;
  const part = await YouTube.getPlaylist(source.url, { offset, limit: PLAYLIST_PAGE });
  // 재생목록은 아티스트가 안 온다(제목뿐). 그래서 youtubeMatch를 거치지 않고 주소를 그대로 쓴다
  return (part?.tracks || []).filter((t) => t.url && !t.isLive).map((t) => ({ title: t.title, durationSec: Number(t.duration) || undefined, youtubeUrl: t.url, thumbnail: t.thumbnail, sourceKey: t.url }));
}

// ── 등록부 ────────────────────────────────────────────────────────────────

const FETCHERS = { keyword, lastfm, lbradio, animethemes, anisongdb, vocadb: vocaFamily, utaitedb: vocaFamily, touhoudb: vocaFamily, spotify, youtube };

const TYPES = Object.keys(FETCHERS);

/**
 * 대시보드가 그릴 소스 목록. 검증·실행과 같은 표에서 뽑아 준다.
 * 화면이 따로 목록을 들고 있으면 소스를 더할 때 한쪽만 고치게 된다.
 *
 * 필수 여부는 need 에서 끌어온다(중복해서 적지 않는다).
 */
// 고를 수 있는 방영 연도. 저쪽이 알려 주므로 올해로 어림잡지 않는다.
// 연말에는 다음 해 1분기가 이미 등록돼 있다. 하루에 한 번만 묻는다.
let yearRange = null;
let yearRangeAt = 0;
const YEAR_TTL_MS = 24 * 60 * 60 * 1000;

async function animeYearRange() {
  if (yearRange && Date.now() - yearRangeAt < YEAR_TTL_MS) return yearRange;
  try {
    const ends = await Promise.all([getJson("https://api.animethemes.moe/anime?sort=year&page[size]=1"), getJson("https://api.animethemes.moe/anime?sort=-year&page[size]=1")]);
    const [min, max] = ends.map((r) => Number(r?.anime?.[0]?.year));
    if (min && max && min <= max) {
      yearRange = { min, max };
      yearRangeAt = Date.now();
    }
  } catch (error) {
    log.debug(`AnimeThemes 연도 범위를 받아오지 못했습니다: ${error.message}`);
  }
  // 못 받으면 넉넉히 잡는다. 칸이 아예 안 그려지는 것보다 낫다
  return yearRange || { min: 1960, max: new Date().getFullYear() + 1 };
}

/**
 * 칸 하나에 저쪽에서 받아 온 값을 얹는다.
 *
 * `kind === "range"` 로 가르지 않는 이유: 구간 칸이 둘인 소스가 있어(연도와 인지도)
 * 한쪽 값이 다른 쪽에 얹힌다. 칸 이름으로 가른다.
 */
function fill(field, type, years, anisong) {
  if (type === "animethemes" && field.kind === "range") return years;
  if (type !== "anisongdb") return {};
  if (field.key === "yearFrom") return anisong?.min ? { min: anisong.min, max: anisong.max } : years;
  // 분포를 같이 내린다. 화면이 슬라이더 옆에 그려야 사용자가 높은 쪽 후보가 얼마나
  // 적은지 알고 고른다. 쏠림이 심해서 안 보여 주면 "왜 같은 곡만 나오지"가 된다.
  if (field.key === "difficultyFrom") return anisong?.difficulty?.length ? { histogram: anisong.difficulty } : {};
  // 태그는 364개라 SPEC 에 못 적는다. 저쪽에 물어 채운다.
  if (field.key === "tags") return { options: opts(anisong?.tags || []) };
  if (field.key === "genres" && anisong?.genres?.length) return { options: opts(anisong.genres) };
  return {};
}

async function catalog() {
  // 나란히 부른다. 한쪽이 느리다고 다른 쪽을 기다릴 이유가 없다.
  const [years, anisong] = await Promise.all([animeYearRange(), anisongCatalog()]);
  return TYPES.map((type) => {
    const spec = SPEC[type];
    const required = new Set(spec.need.flat());
    return {
      type,
      label: spec.label,
      hint: spec.hint || "",
      usable: usable(type),
      needs: spec.env || null,
      // need 가 [["tags","prompt"]] 꼴이면 "둘 중 하나"라는 뜻이다
      either: spec.need.filter((g) => g.length > 1).map((g) => [...g]),
      fields: (spec.fields || []).map((one) => ({ ...one, required: required.has(one.key), ...fill(one, type, years, anisong) })),
    };
  });
}

/** 설정에 적힌 소스 하나를 곡 목록으로. 던지면 부르는 쪽이 다음 소스로 넘어간다. */
async function fetchFrom(source) {
  const fetcher = FETCHERS[source?.type];
  if (!fetcher) throw new Error(`모르는 소스입니다: ${source?.type}`);
  const tracks = await fetcher(source);
  log.debug(`${source.type}: ${tracks.length}곡`);
  return tracks;
}

module.exports = {
  fetchFrom,
  TYPES,
  SPEC,
  catalog,
  usable,
  needsOf,
  _placeholder: PLACEHOLDER,
  _lyricsFilter: lyricsFilter,
  _someLanguages: someLanguages,
  _anisongFilters: anisongFilters,
  _anisongCatalog: anisongCatalog,
  _seedAnisongStats: (stats) => {
    anisongStats = stats;
    anisongStatsAt = stats ? Date.now() : 0;
  },
  // 테스트가 바깥으로 나가지 않게 연도 범위를 미리 채워 둔다
  _seedYearRange: (range) => {
    yearRange = range;
    yearRangeAt = range ? Date.now() : 0;
  },
};
