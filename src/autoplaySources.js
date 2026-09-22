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

const config = require("../config");
const log = require("./logger").child({ category: "autoplay" });

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
  const YouTube = require("./YouTube");
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

// ── vocadb 계열 ───────────────────────────────────────────────────────────
// 유튜브 주소를 직접 준다. 검색도 매칭도 없다. 셋이 같은 소프트웨어라 코드도 같다.
const VOCA_HOSTS = { vocadb: "vocadb.net", utaitedb: "utaitedb.net", touhoudb: "touhoudb.com" };
const VOCA_PAGE = 50;

// 기본 곡 종류가 사이트마다 다르다. 셋 다 같은 소프트웨어지만 무엇이 "본체"인지가 다르다.
//   utaitedb. 우타이테는 남의 곡을 부르는 사람들이다. Original로 받으면 정작 우타이테가
//              아니라 보컬로이드 원곡이 온다(MARETU feat. 初音ミク 같은 것).
//   touhoudb. 동방은 어레인지 문화다. Original은 ZUN의 게임 BGM 3,190곡뿐이고,
//              사람들이 듣는 것은 Arrangement 46,557곡 쪽이다(Bad Apple!! · チルノのパーフェクトさんすう教室).
const VOCA_DEFAULT_TYPES = { utaitedb: ["Cover"], touhoudb: ["Arrangement"] };

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
  // 믹스(RD…)는 total이 null이다. 끝이 없어 무작위 오프셋을 쓸 수 없다
  const total = Number(head?.total) || 0;
  if (!total) throw new Error("재생목록의 곡 수를 알 수 없습니다(유튜브 믹스는 소스로 쓸 수 없습니다)");

  const offset = total > PLAYLIST_PAGE ? rand(total - PLAYLIST_PAGE) : 0;
  const part = await YouTube.getPlaylist(source.url, { offset, limit: PLAYLIST_PAGE });
  // 재생목록은 아티스트가 안 온다(제목뿐). 그래서 youtubeMatch를 거치지 않고 주소를 그대로 쓴다
  return (part?.tracks || []).filter((t) => t.url && !t.isLive).map((t) => ({ title: t.title, durationSec: Number(t.duration) || undefined, youtubeUrl: t.url, thumbnail: t.thumbnail, sourceKey: t.url }));
}

// ── 등록부 ────────────────────────────────────────────────────────────────

const FETCHERS = { keyword, lastfm, lbradio, animethemes, vocadb: vocaFamily, utaitedb: vocaFamily, touhoudb: vocaFamily, spotify, youtube };

/**
 * 소스 타입 명세. 설정 검증과 실행이 같은 표를 본다.
 *
 *   label  사람에게 보일 이름(기동 경고 문구에 쓴다)
 *   need   반드시 있어야 하는 값. 안쪽 배열은 "이 중 하나는 있어야 한다"
 *   env    .env에 있어야 하는 이름(없으면 그 소스만 못 쓴다)
 */
// 값이 정해져 있는 칸들. 오타를 설정 시점에 잡는다. 안 그러면 저쪽이 422/400을 돌려주고
// 그 소스가 조용히 빈손이 되어, 설정은 멀쩡한데 그 소스만 안 쓰이는 꼴이 된다.
const SEASONS = ["Winter", "Spring", "Summer", "Fall"];
const MEDIA_FORMATS = ["TV", "TV Short", "Movie", "OVA", "ONA", "Special"];
const LB_MODES = ["easy", "medium", "hard"];

// 정렬 이름은 저쪽 코드값이다. 화면에는 한국어로 보인다. 코드값은 예제 파일 주석으로 충분하다.
const SONG_SORT_OPTIONS = [
  { value: "RatingScore", label: "평가 점수 높은 순" },
  { value: "FavoritedTimes", label: "즐겨찾기 많은 순" },
  { value: "PublishDate", label: "발표 최신순" },
  { value: "AdditionDate", label: "등록 최신순" },
  { value: "TagUsageCount", label: "태그 많은 순" },
  { value: "SongType", label: "곡 종류순" },
  { value: "Name", label: "이름순" },
];
const SONG_SORTS = SONG_SORT_OPTIONS.map((one) => one.value);

// 검사도 사이트별이어야 한다. vocadb 에 Arrangement 를 적으면 0곡이 온다
const vocaEnums = (site) => ({
  songTypes: VOCA_SONG_TYPES[site],
  sort: SONG_SORTS,
  languages: VOCA_LANGUAGES[site].map((one) => one.value),
  ...(VOCA_ARTIST_TYPES[site] ? { artistTypes: VOCA_ARTIST_TYPES[site] } : {}),
});

// 대시보드가 그릴 입력칸. kind 는 화면이 무엇을 띄울지 정한다.
// list(칩) · text · url · number · range(구간 슬라이더) ·
// enum(하나 고르기) · enumList(알약으로 여럿) · enumDrop(드롭다운에서 여럿).
// deep: true 는 "자주 안 쓰는 것"이라 접어 둔다.
// width 는 칸 너비다. 없으면 한 줄을 다 쓴다. narrow(좁은 숫자칸) · half(늘 반 줄) ·
// halfWide(모바일만 한 줄, 그 위로는 반 줄).
// when: "다른칸" 은 그 칸이 채워졌을 때만 나온다.
const f = (key, kind, label, extra = {}) => ({ key, kind, label, ...extra });
// 고를 값이 정해진 칸. 화면에 보일 말이 API 값과 다르면 짝지어 준다.
const opts = (list) => list.map((v) => (typeof v === "string" ? { value: v, label: v } : v));

const SEASON_OPTIONS = opts([
  { value: "Winter", label: "1분기" },
  { value: "Spring", label: "2분기" },
  { value: "Summer", label: "3분기" },
  { value: "Fall", label: "4분기" },
]);

// 사이트마다 있는 것이 다르다. 돌려쓰면 없는 값을 고르게 되고, 그걸 넣으면 0곡이 온다.
// (실측 2026-09-18. 유튜브 PV 있는 곡 기준으로 한 건이라도 있는 것만)
const VOCA_SONG_TYPES = {
  vocadb: ["Unspecified", "Original", "Remaster", "Remix", "Cover", "Instrumental", "Mashup", "MusicPV", "DramaPV", "Other"],
  utaitedb: ["Unspecified", "Original", "Remaster", "Remix", "Cover", "Instrumental", "Mashup", "MusicPV", "Live", "Other"],
  touhoudb: ["Unspecified", "Original", "Remaster", "Cover", "Arrangement", "Rearrangement", "ShortVersion", "Instrumental", "MusicPV", "DramaPV", "Other"],
};

// 부르는 쪽 분류. TouhouDB에는 아예 없다(0명). 동방은 사람이 부르는 어레인지라 그렇다.
// UtaiteDB는 우타이테와 그 밖뿐이고, 보컬 합성 라이브러리 목록은 VocaDB에만 있다.
const VOCA_ARTIST_TYPES = {
  vocadb: ["Vocaloid", "UTAU", "CeVIO", "SynthesizerV", "VOICEVOX", "Voiceroid", "NEUTRINO", "VoiSona", "ACEVirtualSinger", "AIVOICE", "OtherVoiceSynthesizer", "NewType", "OtherVocalist"],
  utaitedb: ["Utaite", "OtherVocalist"],
  touhoudb: null,
};

// 가사 언어. 저쪽이 목록을 안 주므로 ISO 639-1 전체를 훑어 곡이 실제로 있는 것만 남겼다
// (실측 2026-09-18, 유튜브 PV 있는 곡 기준. 사이트마다 다르고, 많은 순서다).
//
// ha·ln·yo·jv 는 뺐다. 표본 20곡이 전부 "로마자 표기" 항목이었다. 하우사어 곡 12,997개가
// 있는 것이 아니라, 로마자 가사에 엉뚱한 코드가 붙어 있는 것이다.
//
// 번역 가사만 있는 곡도 걸린다(영어는 표본의 절반쯤). 그 언어로 부른 곡만 고를 길은 저쪽에 없다.
const LANG_NAMES = {
  ja: "일본어",
  en: "영어",
  zh: "중국어",
  ko: "한국어",
  es: "스페인어",
  pt: "포르투갈어",
  fr: "프랑스어",
  ru: "러시아어",
  id: "인도네시아어",
  tl: "타갈로그어",
  de: "독일어",
  uk: "우크라이나어",
  it: "이탈리아어",
  tr: "튀르키예어",
  th: "태국어",
  pl: "폴란드어",
  vi: "베트남어",
  nl: "네덜란드어",
  la: "라틴어",
  ms: "말레이어",
  fi: "핀란드어",
  sr: "세르비아어",
  sv: "스웨덴어",
  cs: "체코어",
  eo: "에스페란토",
  be: "벨라루스어",
  ca: "카탈루냐어",
  ro: "루마니아어",
  so: "소말리아어",
  ar: "아랍어",
  no: "노르웨이어",
  el: "그리스어",
  bs: "보스니아어",
  bg: "불가리아어",
  he: "히브리어",
  hi: "힌디어",
  hu: "헝가리어",
  kk: "카자흐어",
  yi: "이디시어",
  bn: "벵골어",
  da: "덴마크어",
  eu: "바스크어",
  ga: "아일랜드어",
  mn: "몽골어",
  ur: "우르두어",
  cy: "웨일스어",
  sa: "산스크리트어",
  sk: "슬로바키아어",
  ta: "타밀어",
  tg: "타지크어",
  zu: "줄루어",
  et: "에스토니아어",
  gl: "갈리시아어",
  my: "버마어",
  ba: "바시키르어",
  bo: "티베트어",
  kn: "칸나다어",
  oc: "오크어",
  sw: "스와힐리어",
  te: "텔루구어",
};

const VOCA_LANG_CODES = {
  // prettier-ignore
  vocadb: ["ja","en","zh","ko","es","pt","fr","ru","id","tl","de","uk","it","tr","th","pl","vi","nl","la","ms","fi","sr","sv","cs","eo","be","ca","ro","so","ar","no","el","bs","bg","he","hi","hu","kk","yi","bn","da","eu","ga","mn","ur","cy","sa","sk","ta","tg","zu","et","gl","my","ba","bo","kn","oc","sw","te"],
  // prettier-ignore
  utaitedb: ["ja","en","ru","fr","pt","uk","zh","ko","pl","de","es","id","it","tl","el","vi","tr","bs","la","nl","sv","th"],
  // prettier-ignore
  touhoudb: ["ja","en","de","zh","fr","ko","la","sa","pl","es","ga","el","it","ro","ru","cs","he","id","sv","th","vi"],
};

const VOCA_LANGUAGES = Object.fromEntries(Object.entries(VOCA_LANG_CODES).map(([site, codes]) => [site, codes.map((code) => ({ value: code, label: LANG_NAMES[code] }))]));

const VOCA_SINGER = {
  vocadb: { typeLabel: "보컬 라이브러리", artistLabel: "특정 보컬만", artistHint: "이름으로 적습니다. 예) UNI, 初音ミク" },
  utaitedb: { typeLabel: "가수 분류", artistLabel: "특정 우타이테만", artistHint: "이름으로 적습니다" },
  touhoudb: { artistLabel: "특정 아티스트만", artistHint: "이름으로 적습니다. 예) ZUN, 暁Records" },
};

// 척도는 사이트마다 크게 다르지만(예제 파일의 표 참고) 설명할 말은 같다
const VOCA_SCORE_HINT = '해당 사이트의 "評価" 점수.';

function vocaFields(site) {
  const singer = VOCA_SINGER[site];
  const types = VOCA_ARTIST_TYPES[site];
  return [
    f("tags", "list", "장르 태그", { hint: "rock, pop, ballad, EDM, 和風 등" }),
    f("minScore", "number", "최소 평가 점수", { width: "half", min: 0, hint: VOCA_SCORE_HINT }),
    // 언어마다 따로 받아 섞는다(vocaFamily). 저쪽이 한 번에 하나만 받는다
    f("languages", "enumDrop", "가사 언어", { width: "half", options: VOCA_LANGUAGES[site], hint: "번역 가사만 있는 곡도 섞입니다" }),
    ...(types ? [f("artistTypes", "enumList", singer.typeLabel, { deep: true, options: opts(types) })] : []),
    f("artists", "list", singer.artistLabel, { deep: true, hint: singer.artistHint }),
    f("songTypes", "enumList", "곡 종류", { deep: true, options: opts(VOCA_SONG_TYPES[site]), hint: `기본값: ${(VOCA_DEFAULT_TYPES[site] || ["Original"]).join(", ")}` }),
    f("excludeTags", "list", "제외할 태그", { deep: true }),
    f("minLength", "number", "최소 길이(초)", { deep: true, width: "narrow", min: 0 }),
    f("maxLength", "number", "최대 길이(초)", { deep: true, width: "narrow", min: 0 }),
    f("minBpm", "number", "최소 BPM", { deep: true, width: "narrow", min: 0 }),
    f("maxBpm", "number", "최대 BPM", { deep: true, width: "narrow", min: 0 }),
    f("yearFrom", "number", "해당 연도 이후 발표", { deep: true, width: "narrow" }),
    f("yearTo", "number", "해당 연도 이전 발표", { deep: true, width: "narrow" }),
    f("sort", "enum", "정렬", { deep: true, options: SONG_SORT_OPTIONS }),
  ];
}

const SPEC = {
  keyword: { label: "키워드", hint: "지정한 키워드 중 하나를 뽑아 유튜브에서 검색합니다. 품질이 가장 낮으니 가중치를 낮게 주세요.", need: [["keywords"]], fields: [f("keywords", "list", "검색어", { hint: "무작위로 하나를 뽑아 사용합니다" })] },
  lastfm: {
    label: "Last.fm",
    hint: "태그로 곡 이름을 받아 유튜브에서 찾습니다.",
    need: [["tags"]],
    env: "LASTFM_API_KEY",
    has: () => !!config.sources?.lastfmKey,
    fields: [f("tags", "list", "태그", { hint: "태그마다 품질 편차가 큽니다. 관련 태그를 여럿 적는 것이 좋습니다" }), f("pages", "number", "가져 올 페이지 수", { deep: true, min: 1, hint: "기본 5" })],
  },
  lbradio: {
    label: "ListenBrainz Radio",
    hint: "태그나 프롬프트를 기반으로 플레이리스트를 제공해 줍니다. 둘 중 하나는 적어야 합니다.",
    need: [["tags", "prompt"]],
    enums: { mode: LB_MODES },
    env: "LISTENBRAINZ_TOKEN",
    has: () => !!config.sources?.listenbrainzToken,
    fields: [f("tags", "list", "태그", { hint: "MusicBrainz 공식 장르명" }), f("mode", "enumList", "모드", { options: opts(LB_MODES), hint: "easy가 마이너한 곡을, hard가 유명한 곡을 줍니다. 여럿 고르면 섞습니다" }), f("prompt", "text", "프롬프트 직접 작성", { deep: true, hint: "예) tag:(jazz,funk)::or, artist:(Miles Davis)" })],
  },
  animethemes: {
    label: "AnimeThemes",
    hint: "애니 주제가 DB. 유튜브에 풀버전이 있으면 그쪽을, 없으면 TV 사이즈 음원을 재생합니다.",
    need: [],
    enums: { themeType: ["OP", "ED"], season: SEASONS, seasonFrom: SEASONS, seasonTo: SEASONS, mediaFormat: MEDIA_FORMATS },
    fields: [
      f("themeType", "enum", "주제가 종류", { width: "halfWide", options: opts(["OP", "ED"]), emptyLabel: "OP/ED" }),
      f("mediaFormat", "enumList", "매체", { width: "halfWide", options: opts(MEDIA_FORMATS), hint: "비우면 전부" }),
      // 두 점으로 잡는 구간. 고를 수 있는 범위는 저쪽에 물어 채운다(catalog)
      f("yearFrom", "range", "방영 연도", { to: "yearTo", hint: "양 끝까지 벌리면 전체" }),
      // 분기는 연도를 자른 뒤에나 뜻이 있다. 연도가 전체면 아예 안 보인다
      f("seasonFrom", "enum", "시작 분기", { width: "half", when: "yearFrom", options: SEASON_OPTIONS, emptyLabel: "그 해 처음부터" }),
      f("seasonTo", "enum", "끝 분기", { width: "half", when: "yearFrom", options: SEASON_OPTIONS, emptyLabel: "그 해 끝까지" }),
      f("season", "enumList", "특정 분기만", { deep: true, width: "halfWide", options: SEASON_OPTIONS, hint: "연도와 무관하게 이 분기만" }),
      f("sequence", "number", "몇 번째 주제가", { deep: true, width: "halfWide", min: 1, hint: "1이면 OP1, ED1만" }),
    ],
  },
  vocadb: { label: "VocaDB", hint: "보컬로이드 DB.", need: [], enums: vocaEnums("vocadb"), fields: vocaFields("vocadb") },
  utaitedb: { label: "UtaiteDB", hint: "우타이테 DB", need: [], enums: vocaEnums("utaitedb"), fields: vocaFields("utaitedb") },
  touhoudb: { label: "TouhouDB", hint: "동방 DB. 동방 어레인지, OST 등이 있습니다.", need: [], enums: vocaEnums("touhoudb"), fields: vocaFields("touhoudb") },
  spotify: { label: "스포티파이 재생목록", need: [["url"]], env: "SPOTIFY_CLIENT_ID", has: () => !!config.spotify?.clientId, fields: [f("url", "url", "주소", { hint: "재생목록·앨범·아티스트" })] },
  youtube: { label: "유튜브 재생목록", need: [["url"]], fields: [f("url", "url", "주소", { hint: "자동 생성 믹스(list=RD…)는 곡 수에 끝이 없어 사용이 불가능합니다" })] },
};

const TYPES = Object.keys(FETCHERS);

/** 이 타입을 지금 쓸 수 있나. 키가 필요한 소스는 키가 있어야 한다. */
const usable = (type) => (SPEC[type] ? !SPEC[type].has || SPEC[type].has() : false);

/** 이 타입이 무엇을 필요로 하는지(없으면 null). 기동 시 문구를 만들 때 쓴다. */
const needsOf = (type) => (SPEC[type]?.env ? { env: SPEC[type].env, label: SPEC[type].label } : null);

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

async function catalog() {
  const years = await animeYearRange();
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
      fields: (spec.fields || []).map((one) => ({ ...one, required: required.has(one.key), ...(one.kind === "range" && type === "animethemes" ? years : {}) })),
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
  // 테스트가 바깥으로 나가지 않게 연도 범위를 미리 채워 둔다
  _seedYearRange: (range) => {
    yearRange = range;
    yearRangeAt = range ? Date.now() : 0;
  },
};
