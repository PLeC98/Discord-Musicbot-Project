// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// AnimeThemes 소스.

import http from "./http.ts";
const { query, getJson } = http;

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

const exported = { animethemes };
export default exported;
export { exported as "module.exports" };
