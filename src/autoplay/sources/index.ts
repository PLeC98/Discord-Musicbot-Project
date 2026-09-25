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

import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "autoplay" });
import { SPEC, usable, needsOf, opts, type Field } from "../../config/schema/genreSources.ts";
import { messageOf } from "../../rules/errorKind.ts";
import type { GenreSource } from "../../config/genres.ts";
import type { Candidate } from "./candidate.ts";
import type { Search } from "./keyword.ts";
import type { AnisongStats } from "./anisongdb.ts";
import { getJson, remembered } from "./http.ts";
import { keyword } from "./keyword.ts";
import { lastfm } from "./lastfm.ts";
import { lbradio, PLACEHOLDER } from "./lbradio.ts";
import { animethemes } from "./animethemes.ts";
import { anisongdb, anisongCatalog, anisongFilters, _seedAnisongStats, YEAR_TTL_MS, CATALOG_WAIT_MS, CATALOG_RETRY_MS } from "./anisongdb.ts";
import { vocaFamily, advancedFilters, someLanguages } from "./voca.ts";
import { spotify, youtube } from "./playlists.ts";

// ── 등록부 ────────────────────────────────────────────────────────────────

/** 소스가 부르는 것의 가짜(테스트). 지금은 keyword 의 search 뿐이다 */
type FetchDeps = { search?: Search };
type Fetcher = (source: GenreSource, deps: FetchDeps) => Promise<Candidate[]>;
type YearRange = { min: number; max: number };
// 여기서 읽는 칸만
type AnimePage = { anime?: Array<{ year?: number }> };

const FETCHERS: Record<string, Fetcher> = { keyword, lastfm, lbradio, animethemes, anisongdb, vocadb: vocaFamily, utaitedb: vocaFamily, touhoudb: vocaFamily, spotify, youtube };

const TYPES = Object.keys(FETCHERS);

/**
 * 대시보드가 그릴 소스 목록. 검증·실행과 같은 표에서 뽑아 준다.
 * 화면이 따로 목록을 들고 있으면 소스를 더할 때 한쪽만 고치게 된다.
 *
 * 필수 여부는 need 에서 끌어온다(중복해서 적지 않는다).
 */
// AnimeThemes 에서 고를 수 있는 방영 연도. 저쪽이 알려 주므로 올해로 어림잡지 않는다(연말에는 다음 해 1분기가 이미
// 등록돼 있다). 하루 한 번 묻고, 화면은 오래 기다리지 않는다(http.remembered)
const yearRange = remembered<YearRange>(
  async () => {
    try {
      const ends = await Promise.all([getJson<AnimePage | null>("https://api.animethemes.moe/anime?sort=year&page[size]=1"), getJson<AnimePage | null>("https://api.animethemes.moe/anime?sort=-year&page[size]=1")]);
      const [min, max] = ends.map((r) => Number(r?.anime?.[0]?.year));
      return min && max && min <= max ? { min, max } : null;
    } catch (error) {
      log.debug(`AnimeThemes 연도 범위를 받아오지 못했습니다: ${messageOf(error)}`);
      return null;
    }
  },
  { ttlMs: YEAR_TTL_MS, retryMs: CATALOG_RETRY_MS, waitMs: CATALOG_WAIT_MS },
);

async function animeYearRange() {
  // 못 받았거나 늦으면 넉넉히 잡는다. 칸이 아예 안 그려지는 것보다 낫다
  return (await yearRange.get()) || { min: 1960, max: new Date().getFullYear() + 1 };
}

/**
 * 칸 하나에 저쪽에서 받아 온 값을 얹는다.
 *
 * `kind === "range"` 로 가르지 않는 이유: 구간 칸이 둘인 소스가 있어(연도와 인지도)
 * 한쪽 값이 다른 쪽에 얹힌다. 칸 이름으로 가른다.
 */
function fill(field: Field, type: string, years: YearRange, anisong: AnisongStats | null) {
  if (type === "animethemes" && field.kind === "range") return years;
  return type === "anisongdb" ? fillAnisong(field, years, anisong) : {};
}

function fillAnisong(field: Field, years: YearRange, anisong: AnisongStats | null) {
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
// deps: 소스가 부르는 것의 가짜(테스트). 지금은 keyword 의 search 뿐이다
async function fetchFrom(source: GenreSource, deps: FetchDeps = {}): Promise<Candidate[]> {
  const fetcher = FETCHERS[source?.type];
  if (!fetcher) throw new Error(`모르는 소스입니다: ${source?.type}`);
  const tracks = await fetcher(source, deps);
  log.debug(`${source.type}: ${tracks.length}곡`);
  return tracks;
}

export { fetchFrom, TYPES, SPEC, catalog, usable, needsOf, PLACEHOLDER as _placeholder, advancedFilters as _advancedFilters, someLanguages as _someLanguages, anisongFilters as _anisongFilters, anisongCatalog as _anisongCatalog, _seedAnisongStats };
export const _seedYearRange = (range: YearRange | null) => yearRange.seed(range);
