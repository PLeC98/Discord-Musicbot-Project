// AnimeThemes 소스. 새 GraphQL API(https://rs.animethemes.moe/graphql)를 부른다. 옛 JSON:API(api.animethemes.moe)는 폐기됐고 2026-11-08부터 503을 돌려준다.
//
// 무작위(기본)는 themeShuffle 한 번, 인기순(sort: popular)은 사용자 재생목록에 많이 담긴 판본 상위 POPULAR_DEPTH개를 받는다.
// 서버가 거르는 조건은 종류, 매체(하나일 때), 연도 구간뿐이다(무작위만 해당하고 인기순은 서버 조건이 없다). 나머지(시즌, 양끝 시즌, 매체 여럿, 순번)는 받은 뒤 거른다.
// NSFW, 스포일러는 영상 장면에 대한 표시라 거르지 않는다(소리만 쓴다).

import { postGraphql } from "./http.ts";
import type { GenreSource } from "../../config/genres.ts";
import type { Candidate } from "./candidate.ts";

const API = "https://rs.animethemes.moe/graphql";

// 여기서 읽는 필드만
type Video = { overlap?: string; audio?: { link?: string } | null };
type Staff = { role?: string; relevance?: number; artist?: { name?: { main?: string } } };
type Song = { id?: number; title?: { romaji?: string | null; native?: string | null }; staff?: Staff[] };
type Anime = { slug?: string; siteUrl?: string; year?: number | null; season?: string | null; format?: string | null; title?: { romaji?: string }; imagesV2?: Array<{ facet?: string; link?: string }> };
type Theme = { type?: string; sequence?: number | null; anime?: Anime; song?: Song | null; entries?: Array<{ videos?: { nodes?: Video[] } }> };

const THEME_FIELDS = "type sequence anime { slug siteUrl year season format title { romaji } imagesV2 { facet link } } song { id title { romaji native } staff { role relevance artist { name { main } } } } entries { videos { nodes { overlap audio { link } } } }";
const SHUFFLE = `query($first: Int!, $input: ThemeShuffleInput) { themeShuffle(first: $first, input: $input) { ${THEME_FIELDS} } }`;
const POPULAR = `query($after: String) { mostPopularEntries(pagination: { first: 100, after: $after }) { pageInfo { hasNextPage endCursor } nodes { theme { ${THEME_FIELDS} } } } }`;

/** 무작위 한 번에 받는 수(API 상한) */
const SHUFFLE_SIZE = 100;
/** 받은 뒤 거르고 이보다 적게 남으면 MORE_SHUFFLES번까지 더 뽑는다 */
const ENOUGH = 20;
const MORE_SHUFFLES = 2;
/** 인기순은 늘 이 상위 개수 안에서 고른다. 조건이 좁아도 더 내려가지 않는다(편집기 안내에 적힌 수) */
const POPULAR_DEPTH = 500;

// 설정에 적힌 값(옛 JSON:API 철자)을 새 API의 열거형으로 바꾼다. 설정은 그대로 둔다
const SEASON_ENUM: Record<string, string> = { Winter: "WINTER", Spring: "SPRING", Summer: "SUMMER", Fall: "FALL" };
const FORMAT_ENUM: Record<string, string> = { TV: "TV", "TV Short": "TV_SHORT", Movie: "MOVIE", OVA: "OVA", ONA: "ONA", Special: "SPECIAL" };
const SEASON_ORDER: Record<string, number> = { WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3 };

// 받은 TV 사이즈 음원(.ogg)을 준다. 가수+제목도 같이 실어 호출부가 유튜브에서 풀버전을 먼저 찾고, 못 찾으면 이 음원을 쓴다.
async function animethemes(source: GenreSource): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const seen = new Set<number>();
  const keep = (themes: Theme[]) => {
    for (const theme of themes) {
      const cand = wanted(theme, source) ? candidateOf(theme) : null;
      // 같은 곡이 여러 시즌의 주제가일 수 있다. 겹침은 곡 id로 막는다
      if (!cand || seen.has(cand.id)) continue;
      seen.add(cand.id);
      out.push(cand.candidate);
    }
  };
  if (source.sort === "popular") keep(await popularThemes());
  else {
    const input = shuffleInput(source);
    for (let round = 0; round <= MORE_SHUFFLES && (round === 0 || out.length < ENOUGH); round++) {
      keep((await postGraphql<{ themeShuffle?: Theme[] }>("animethemes", API, SHUFFLE, { first: SHUFFLE_SIZE, input }))?.themeShuffle || []);
    }
  }
  return out;
}

/** 서버에 넘길 무작위 조건. 매체는 하나일 때만(여럿이면 받은 뒤 거른다) */
function shuffleInput(source: GenreSource) {
  const formats = (source.mediaFormat || []).map((one) => FORMAT_ENUM[one]).filter(Boolean);
  return {
    type: source.themeType ? [source.themeType] : ["OP", "ED"],
    ...(formats.length === 1 ? { format: formats[0] } : {}),
    ...(source.yearFrom ? { yearGte: Number(source.yearFrom) } : {}),
    ...(source.yearTo ? { yearLte: Number(source.yearTo) } : {}),
  };
}

/** 인기순 상위 POPULAR_DEPTH개 판본의 주제가. 페이지마다 100개씩 커서로 넘긴다 */
async function popularThemes(): Promise<Theme[]> {
  type Page = { mostPopularEntries?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: Array<{ theme?: Theme }> } };
  const themes: Theme[] = [];
  let after: string | null = null;
  while (themes.length < POPULAR_DEPTH) {
    const page: Page["mostPopularEntries"] = (await postGraphql<Page>("animethemes", API, POPULAR, { after }))?.mostPopularEntries;
    for (const node of page?.nodes || []) if (node.theme) themes.push(node.theme);
    if (!page?.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }
  return themes.slice(0, POPULAR_DEPTH);
}

/** 설정의 조건에 맞는 주제가인지 본다(종류, 순번, 매체, 연도, 시즌, 양끝 시즌). 무작위에서는 일부를 서버가 이미 걸렀다 */
const wanted = (theme: Theme, source: GenreSource) => typeOk(theme, source) && animeOk(theme.anime, source) && inSeasonRange(theme.anime, source);

// 종류(고르지 않았으면 OP, ED)와 순번
function typeOk(theme: Theme, source: GenreSource) {
  const types = source.themeType ? [source.themeType] : ["OP", "ED"];
  return types.includes(String(theme.type)) && (!source.sequence || theme.sequence === source.sequence);
}

// 매체(여럿), 시즌(여럿)
function animeOk(anime: Anime | undefined, source: GenreSource) {
  const formats = (source.mediaFormat || []).map((one) => FORMAT_ENUM[one]).filter(Boolean);
  const seasons = (source.season || []).map((one) => SEASON_ENUM[one]).filter(Boolean);
  return (!formats.length || formats.includes(String(anime?.format))) && (!seasons.length || seasons.includes(String(anime?.season)));
}

// 연도와 양끝 시즌 사이
function inSeasonRange(anime: Anime | undefined, source: GenreSource) {
  const { from, to } = seasonRange(source);
  if (from === -Infinity && to === Infinity) return true;
  const at = Number(anime?.year) * 4 + (SEASON_ORDER[anime?.season ?? ""] ?? 0);
  return at >= from && at <= to;
}

// 방영 시기를 분기 수로. 양끝 시즌을 안 적었으면 그해 처음, 끝
function seasonRange(source: GenreSource) {
  const from = source.yearFrom ? Number(source.yearFrom) * 4 + (SEASON_ORDER[SEASON_ENUM[source.seasonFrom ?? ""] ?? ""] ?? 0) : -Infinity;
  const to = source.yearTo ? Number(source.yearTo) * 4 + (SEASON_ORDER[SEASON_ENUM[source.seasonTo ?? ""] ?? ""] ?? 3) : Infinity;
  return { from, to };
}

/**
 * 들을 음원. 대사가 겹치지 않는 판본(overlap NONE)의 음원. 판본이 여럿이어도 음원은 하나다.
 * 판본은 있는데 모두 대사가 겹치면 "" (음원 없이 이름만 보내 유튜브 풀버전을 찾게 한다), 판본이 아예 없으면 null(버린다)
 */
function audioOf(theme: Theme): string | null {
  const videos = (theme.entries || []).flatMap((entry) => entry.videos?.nodes || []);
  if (!videos.length) return null;
  return videos.find((video) => video.overlap === "NONE" && video.audio?.link)?.audio?.link || "";
}

/** 후보 하나와 곡 id. 곡, 제목, 음원을 정할 수 없으면 null */
function candidateOf(theme: Theme): { id: number; candidate: Candidate } | null {
  const song = theme.song;
  const title = song ? song.title?.romaji || song.title?.native : null;
  // id가 없는 곡은 겹침도 출처 키도 구분할 수 없어 뺀다
  if (!song || song.id === undefined || !title) return null;
  const audio = audioOf(theme);
  if (audio === null) return null;
  const anime = theme.anime;
  const candidate: Candidate = {
    artist: singersOf(song) || anime?.title?.romaji || "",
    title,
    thumbnail: coverOf(anime),
    sourceUrl: pageOf(anime),
    platform: "animethemes",
    sourceKey: `at:${song.id}`,
  };
  // 대사가 겹친 판본뿐이면 음원 없이 보낸다. 유튜브에서 확실한 풀버전을 찾을 때만 튼다(strict)
  return { id: song.id, candidate: audio ? { ...candidate, audioUrl: audio } : { ...candidate, strict: true } };
}

// 가수는 공연자(Performance)만 relevance 순서로. 작곡, 편곡, 작사가도 같은 명단에 있다
function singersOf(song: Song) {
  return (song.staff || [])
    .filter((one) => one.role === "Performance")
    .sort((a, b) => (a.relevance ?? 0) - (b.relevance ?? 0))
    .map((one) => one.artist?.name?.main)
    .filter(Boolean)
    .join(", ");
}

// 작품의 큰 표지. 없으면 null
const coverOf = (anime: Anime | undefined) => (anime?.imagesV2 || []).find((image) => image.facet === "LARGE_COVER")?.link || null;

// 작품 페이지. 저쪽이 주는 주소, 없으면 slug로
const pageOf = (anime: Anime | undefined) => anime?.siteUrl || (anime?.slug ? `https://animethemes.moe/anime/${anime.slug}` : undefined);

export { animethemes, POPULAR_DEPTH };
