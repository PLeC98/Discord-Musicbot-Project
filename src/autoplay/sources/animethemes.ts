// AnimeThemes 소스.

import { query, getJson } from "./http.ts";
import type { GenreSource } from "../../config/genres.ts";
import type { Candidate } from "./candidate.ts";

// 여기서 읽는 칸만
type Video = { overlap?: string; audio?: { link?: string } };
type Song = { id?: number; title?: string; artists?: Array<{ name?: string }> };
type Anime = { name?: string; slug?: string; year?: number; season?: string; images?: Array<{ facet?: string; link?: string }>; animethemes?: Theme[] };
type Theme = { type?: string; sequence?: number | null; song?: Song; animethemeentries?: Array<{ videos?: Video[] }>; anime?: Anime };

// ── animethemes ───────────────────────────────────────────────────────────
// 음원(.ogg)을 직접 준다. 다만 TV 사이즈(중앙값 90초)라 artist+title도 같이 채워 보낸다
// 부르는 쪽이 유튜브에서 풀버전을 먼저 찾고 못 찾으면 이 음원으로 떨어진다.
const SEASON_ORDER: Record<string, number> = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };

const THEME_PARTS = "song.artists,animethemeentries.videos.audio";

async function animethemes(source: GenreSource): Promise<Candidate[]> {
  const narrowed = source.yearFrom || source.yearTo || source.season?.length || source.mediaFormat?.length;
  const themes = narrowed ? await themesByAnime(source) : await themesAtRandom(source);

  const out: Candidate[] = [];
  const seen = new Set<number | undefined>();
  for (const theme of themes) {
    const song = theme.song;
    // 같은 곡이 여러 시즌의 OP일 수 있다. 겹침은 animetheme.id가 아니라 song.id로 막는다
    if (!song?.title || seen.has(song.id)) continue;
    const link = audioOf(theme);
    if (!link) continue;
    seen.add(song.id);
    out.push(candidateOf(theme, song, song.title, link));
  }
  return out;
}

// 들을 음원 주소. overlap이 None인 판본이 하나도 없으면 음원에 대사가 얹혀 있다(60곡 중 5곡). 그것만 버린다.
function audioOf(theme: Theme) {
  const videos = (theme.animethemeentries || []).flatMap((e) => e.videos || []);
  const clean = videos.find((v) => v.overlap === "None");
  if (videos.length && !clean) return null;
  return (clean || videos[0])?.audio?.link || null;
}

function candidateOf(theme: Theme, song: Song, title: string, audioUrl: string): Candidate {
  const anime = theme.anime;
  return {
    artist: (song.artists || []).map((a) => a.name).join(", ") || anime?.name || "",
    title,
    audioUrl,
    thumbnail: (anime?.images || []).find((i) => /large/i.test(String(i.facet)))?.link || null,
    sourceUrl: anime?.slug ? `https://animethemes.moe/anime/${anime.slug}` : undefined,
    platform: "animethemes",
    sourceKey: `at:${song.id}`,
  };
}

// 조건이 없으면 sort=random 한 번이면 된다(100건까지).
async function themesAtRandom(source: GenreSource): Promise<Theme[]> {
  const url = `https://api.animethemes.moe/animetheme?${query({
    sort: "random",
    "page[size]": 100,
    include: `anime.images,${THEME_PARTS}`,
    "filter[type]": source.themeType,
    "filter[sequence]": source.sequence,
  })}`;
  return (await getJson<{ animethemes?: Theme[] } | null>(url))?.animethemes || [];
}

// 연도·시즌·매체는 animetheme 쪽에서 조용히 무시된다. anime 쪽에 걸어야 듣는다.
// 시즌은 범위 문법이 없어 연도로만 자르고 양끝 시즌은 우리가 걸러낸다.
async function themesByAnime(source: GenreSource): Promise<Theme[]> {
  const url = `https://api.animethemes.moe/anime?${query({
    sort: "random",
    "page[size]": 25,
    include: `images,animethemes.${THEME_PARTS.split(",").join(",animethemes.")}`,
    "filter[year-gte]": source.yearFrom,
    "filter[year-lte]": source.yearTo,
    "filter[season]": source.season?.join(","),
    "filter[media_format]": source.mediaFormat?.join(","),
  })}`;
  const list = (await getJson<{ anime?: Anime[] } | null>(url))?.anime || [];

  const { from, to } = seasonRange(source);
  return list.flatMap((anime) => {
    const at = Number(anime.year) * 4 + (SEASON_ORDER[anime.season ?? ""] ?? 0);
    return at < from || at > to ? [] : wantedThemes(anime, source);
  });
}

// 방영 시기를 분기 수로. 양끝 시즌을 안 적었으면 그해 처음 · 끝
function seasonRange(source: GenreSource) {
  const from = source.yearFrom ? Number(source.yearFrom) * 4 + (SEASON_ORDER[source.seasonFrom ?? ""] ?? 0) : -Infinity;
  const to = source.yearTo ? Number(source.yearTo) * 4 + (SEASON_ORDER[source.seasonTo ?? ""] ?? 3) : Infinity;
  return { from, to };
}

// 그 작품의 주제가 중 종류(OP · ED)와 순번이 맞는 것
function wantedThemes(anime: Anime, source: GenreSource): Theme[] {
  return (anime.animethemes || []).filter((theme) => (!source.themeType || theme.type === source.themeType) && (!source.sequence || theme.sequence === source.sequence)).map((theme) => ({ ...theme, anime }));
}

export { animethemes };
