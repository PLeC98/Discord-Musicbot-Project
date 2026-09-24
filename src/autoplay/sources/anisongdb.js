// AnisongDB 소스. 표지는 AniList 에서.

import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "autoplay" });
import genreSources from "../../config/schema/genreSources.ts";
const { ANISONG_SONG_TYPES, ANISONG_ANIME_TYPES, ANISONG_CATEGORIES, ANISONG_BROADCASTS } = genreSources;
import http from "./http.js";
const { TIMEOUT_MS, userAgent, getJson, remembered } = http;

// getJson의 형제. 필터를 본문으로 받는 API용.
// 422 는 응답 본문을 같이 남긴다. 어느 값이 틀렸는지 저쪽이 적어 주는데, 상태 코드만 남기면
// 설정이 조용히 빈손이 되는 이유를 알 수 없다.
async function postJson(url, body, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": userAgent() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = res.status === 422 ? await res.text().catch(() => "") : "";
    throw new Error(`HTTP ${res.status} (${new URL(url).host})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return res.json();
}

// ── anisongdb ─────────────────────────────────────────────────────────────
// AMQ 기반 애니송 DB. AnimeThemes와 같은 갑 유형(음원 직접)이지만 곡 단위 인지도
// (songDifficulty)가 있어 "유명한 곡만"을 걸 수 있다.
const ANISONG = "https://anisongdb.com/api";

const YEAR_TTL_MS = 24 * 60 * 60 * 1000;
// 화면(운영자 자동재생 설정)이 저쪽을 기다리는 한도와, 못 받았을 때 다시 묻기까지 쉬는 시간
const CATALOG_WAIT_MS = 2000;
const CATALOG_RETRY_MS = 10 * 60 * 1000;

// 저쪽의 통계. 못 받으면 까닭을 남기고 null
async function loadAnisongStats() {
  try {
    const stats = await getJson(`${ANISONG}/database_stats`);
    const seasons = Object.keys(stats?.songs_by_season || {});
    const years = seasons.map((one) => Number(String(one).match(/\d{4}/)?.[0])).filter(Boolean);
    // 0칸은 난이도가 아니라 결측이다(미디어가 없어 출제된 적 없는 곡). 범위 필터도 기본으로
    // 빼므로 여기서도 뺀다. 안 빼면 슬라이더 옆 분포에 없는 봉우리가 생긴다.
    const histogram = Array.isArray(stats?.songs_by_difficulty) ? stats.songs_by_difficulty.slice(1) : [];
    return {
      genres: Object.keys(stats?.songs_by_genre || {}),
      tags: Object.keys(stats?.songs_by_tag || {}),
      difficulty: histogram,
      // 1920~30년대에 한두 곡이 있어 슬라이더가 백 해 너비가 된다. 저쪽도 그 해를
      // 고를 수 있게 두므로 우리도 자르지 않는다.
      ...(years.length ? { min: Math.min(...years), max: Math.max(...years) } : {}),
    };
  } catch (error) {
    log.debug(`AnisongDB 목록을 받아오지 못했습니다: ${error.message}`);
    return null;
  }
}

// 장르·태그 목록과 난이도 분포. 하루 한 번 묻고, 화면은 오래 기다리지 않는다(http.remembered)
const anisongStats = remembered(loadAnisongStats, { ttlMs: YEAR_TTL_MS, retryMs: CATALOG_RETRY_MS, waitMs: CATALOG_WAIT_MS });

/** 화면이 고를 값을 저쪽에 물어 채운다. 못 받았거나 늦으면 null(빈 목록으로 그린다). */
const anisongCatalog = () => anisongStats.get();

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

// 테스트가 바깥으로 나가지 않게 통계를 미리 채워 둔다
const _seedAnisongStats = (stats) => anisongStats.seed(stats);

const exported = { anisongdb, anisongCatalog, anisongFilters, _seedAnisongStats, YEAR_TTL_MS, CATALOG_WAIT_MS, CATALOG_RETRY_MS };
export default exported;
export { exported as "module.exports" };
