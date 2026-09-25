// VocaDB 계열(VocaDB · UtaiteDB · TouhouDB) 소스.

import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "autoplay" });
import { VOCA_DEFAULT_TYPES, VOCA_ARTIST_TYPES, type Site } from "../../config/schema/genreSources.ts";
import { messageOf } from "../../rules/errorKind.ts";
import type { GenreSource } from "../../config/genres.ts";
import type { Candidate } from "./candidate.ts";
import { rand, getJson, query } from "./http.ts";

// ── vocadb 계열 ───────────────────────────────────────────────────────────
// 유튜브 주소를 직접 준다. 검색도 매칭도 없다. 셋이 같은 소프트웨어라 코드도 같다.
const VOCA_HOSTS: Record<Site, string> = { vocadb: "vocadb.net", utaitedb: "utaitedb.net", touhoudb: "touhoudb.com" };
const isSite = (type: string): type is Site => Object.hasOwn(VOCA_HOSTS, type);

// 여기서 읽는 칸만
type Pv = { service?: string; disabled?: boolean; pvType?: string; url?: string };
type Song = { id?: number; name?: string; artistString?: string; lengthSeconds?: number; thumbUrl?: string; pvs?: Pv[]; artists?: Array<{ name?: string; categories?: string }> };
type SongPage = { totalCount?: number; items?: Song[] };
type Tag = { id?: number } | null;
type Artist = { id?: number; name?: string; names?: Array<{ value?: string }> };

const VOCA_PAGE = 50;

// 곡 검색은 오래 기다린다. 가수를 걸면 저쪽이 느리다(UNI 1,235곡도 첫 창에 6~12초, 깊은 창은 30초에서 저쪽이 500).
// 곡이 도는 동안 다음 곡을 미리 고르고 풀이 한 시간 가므로 기다려도 티가 안 난다.
// 저쪽이 30초에서 끊으니 그보다 조금 길게 잡아 저쪽 답을 받는다.
const VOCA_TIMEOUT_MS = 35_000;

// 정렬 순서에서 몇 번째까지 볼지. 깊은 창은 저쪽이 못 준다(실측 2026-09-25/26, vocadb):
//   가수 · 가수 분류  깊이에 비례해 느려진다. UTAU 0 → 1초, 1,000 → 3~7초, 5,000 → 13~20초, 15,000 이상은 대개 500
//   그 밖             조건이 없으면 30,000 → 10초, 120,000 이상은 500. minScore 를 걸면 빠르다(7,000번째도 0.6초)
// 기본 정렬이면 조건에 맞는 곡 중 평가 높은 쪽에서 고르게 된다. 보통 설정(minScore 등)은 기본 깊이보다 적어 전체에서 고른다
const HEAVY_DEPTH = 2000;
const DEPTH = 30_000;

// 가사 언어 · 가수 분류. 웹이 쓰는 advancedFilters 로 건다. 여럿 걸면 전부 만족하는 곡이다.
// 가사 언어: `languages` 파라미터는 조용히 무시된다. 쓰레기 값을 넣어도 전체가 온다. 그리고 한 번에 하나만 건다:
// 둘을 걸면 "둘 다 있는 곡"이 되어 ja+ko 가 2,054곡에서 347곡으로 줄어든다(실측 2026-09-18).
// 가수 분류: 웹은 아티스트 검색에만 보이지만 곡에도 걸린다. 여럿 고르면 모두 참여한 곡이다
function advancedFilters(lang: string | null, artistTypes: string[] = []) {
  const list = [...(lang ? [["Lyrics", lang]] : []), ...artistTypes.map((type) => ["ArtistType", type])];
  return Object.fromEntries(
    list.flatMap(([type, param], i) => [
      [`advancedFilters[${i}][filterType]`, type],
      [`advancedFilters[${i}][param]`, param],
    ]),
  );
}

// 그래서 고른 언어마다 따로 받아 섞는다. 언어 하나에 요청이 두 번이라 한 판에 도는 수를 묶어 두고,
// 그보다 많이 골랐으면 그때그때 몇 개만 뽑는다. 판마다 달라지니 여러 번 돌면 고르게 섞인다.
const LANGS_PER_FETCH = 5;

function someLanguages(list: string[] | undefined): Array<string | null> {
  const all = list || [];
  if (all.length <= LANGS_PER_FETCH) return all.length ? all : [null];
  const left = [...all];
  return Array.from({ length: LANGS_PER_FETCH }, () => left.splice(rand(left.length), 1)[0]);
}

async function vocaFamily(source: GenreSource): Promise<Candidate[]> {
  const site = source.type;
  // 등록부가 셋에만 이 함수를 준다
  if (!isSite(site)) throw new Error(`VocaDB 계열이 아닙니다: ${site}`);
  const base = `https://${VOCA_HOSTS[site]}/api/songs`;
  const artistTypes = source.artistTypes || [];
  if (artistTypes.length && !VOCA_ARTIST_TYPES[site]) throw new Error(`${site}에는 가수 분류가 없습니다`);
  const common = await filtersOf(source, site);
  const depth = common.artistId.length || artistTypes.length ? HEAVY_DEPTH : DEPTH;

  const out: Candidate[] = [];
  const seen = new Set<string>();
  let failure: unknown = null;
  for (const lang of someLanguages(source.languages)) {
    // 언어마다 요청이 두 번이다. 하나가 실패했다고 나머지까지 버릴 이유는 없다.
    // 하나도 못 받았을 때만 던져서 부르는 쪽이 다음 소스로 넘어가게 한다.
    try {
      for (const track of await vocaWindow(base, { ...common, ...advancedFilters(lang, artistTypes) }, site, depth)) {
        // 같은 곡이 여러 언어에 걸린다. 번역 가사까지 세기 때문이다
        if (seen.has(track.sourceKey)) continue;
        seen.add(track.sourceKey);
        out.push(track);
      }
    } catch (error) {
      failure = failure || error;
      log.debug(`${site} ${lang || "전체"}: ${messageOf(error)}`);
    }
  }
  if (!out.length && failure) throw failure;
  return out;
}

// 언어 · 가수 분류를 뺀 검색 조건. 이름으로 적는 칸은 id 로 푼다(못 풀면 던진다)
async function filtersOf(source: GenreSource, site: Site) {
  const names = (list: string[] | undefined) => (list || []).map((one) => String(one).trim()).filter(Boolean);
  const [tags, excluded, artists] = await Promise.all([Promise.all(names(source.tags).map((one) => tagId(site, one))), Promise.all(names(source.excludeTags).map((one) => tagId(site, one))), Promise.all(names(source.artists).map((one) => artistId(site, one)))]);
  return {
    // 여럿이면 전부 붙은 곡. 제외는 하나라도 붙으면 뺀다
    tagId: tags,
    excludedTagIds: excluded,
    songTypes: (source.songTypes || VOCA_DEFAULT_TYPES[site] || ["Original"]).join(","),
    minScore: source.minScore,
    minLength: source.minLength,
    maxLength: source.maxLength,
    minMilliBpm: source.minBpm ? Number(source.minBpm) * 1000 : undefined,
    maxMilliBpm: source.maxBpm ? Number(source.maxBpm) * 1000 : undefined,
    afterDate: source.yearFrom ? `${source.yearFrom}-01-01` : undefined,
    beforeDate: source.yearTo ? `${source.yearTo}-12-31` : undefined,
    // 여럿이면 모두 참여한 곡. 하위 보이스뱅크(Append 등)까지
    artistId: artists,
    childVoicebanks: artists.length ? true : undefined,
    // 우리가 틀 수 있는 것만. 다른 서비스는 받아도 못 튼다.
    pvServices: "Youtube",
    onlyWithPvs: true,
    sort: source.sort || "RatingScore",
  };
}

// ── 이름 → id ─────────────────────────────────────────────────────────────
// 가수 · 제외 태그는 저쪽이 id 로만 받는다. 태그는 이름(tagName)도 받지만 없는 이름이면 0곡을 조용히 돌려준다.
// 그래서 전부 id 로 풀고, 못 풀면 던진다. 부르는 쪽이 로그에 남기고 다음 소스로 넘어간다.
// 푼 것은 기억한다. 못 푼 것은 기억하지 않는다(나중에 생길 수 있고, 요청이 실패한 것일 수도 있다).
const ids = new Map<string, number>();

async function tagId(site: Site, name: string) {
  const key = `${site}:tag:${name}`;
  const known = ids.get(key);
  if (known !== undefined) return known;
  // 별칭 · 대소문자도 풀린다(ロック → rock). 없으면 null
  const tag = await getJson<Tag>(`https://${VOCA_HOSTS[site]}/api/tags/byName/${encodeURIComponent(name)}`);
  if (!tag?.id) throw new Error(`${site}에 없는 태그입니다: ${name}`);
  ids.set(key, tag.id);
  return tag.id;
}

async function artistId(site: Site, name: string) {
  const key = `${site}:artist:${name}`;
  const known = ids.get(key);
  if (known !== undefined) return known;
  // 칸이 뜻하는 쪽만 찾는다(vocadb 는 보컬, utaitedb 는 우타이테). touhoudb 는 서클 · 작곡가라 거르지 않는다
  const types = VOCA_ARTIST_TYPES[site];
  const page = await getJson<{ items?: Artist[] } | null>(`https://${VOCA_HOSTS[site]}/api/artists?${query({ query: name, nameMatchMode: "Exact", fields: "Names", sort: "SongCount", maxResults: 20, artistTypes: types?.join(",") })}`);
  const found = sameName(page?.items || [], name);
  if (!found?.id) throw new Error(`${site}에서 찾지 못한 이름입니다: ${name}`);
  log.debug(`${site} 이름 풀기: ${name} → ${found.name} (${found.id})`);
  ids.set(key, found.id);
  return found.id;
}

// Exact 로 물어도 딱 같은 이름만 오지 않는다. 대소문자를 안 가리고 별칭까지 본다(UNI 에 ユニちゃん · Urchin 이 같이 온다).
// 대표 이름이 똑같은 것, 별칭이 똑같은 것, 대소문자만 다른 것 순으로 고른다. 같은 단계에서는 곡이 많은 쪽(저쪽 정렬 그대로)
function sameName(items: Artist[], name: string) {
  const all = (one: Artist) => [one.name, ...(one.names || []).map((n) => n.value)].filter((v): v is string => !!v);
  const lower = name.toLowerCase();
  return items.find((one) => one.name === name) || items.find((one) => all(one).includes(name)) || items.find((one) => all(one).some((v) => v.toLowerCase() === lower)) || null;
}

/** 테스트 시임. 기억한 id 를 버린다 */
function _forgetIds() {
  ids.clear();
}

// 조건에 맞는 곡 중 아무 데나 한 창(50곡)을 떠 온다.
// depth: 정렬 순서에서 몇 번째까지만 볼지
async function vocaWindow(base: string, filters: Record<string, unknown>, type: Site, depth: number): Promise<Candidate[]> {
  // 깊은 곳에서 집으려면 전체 개수를 먼저 알아야 한다
  const head = await getJson<SongPage | null>(`${base}?${query({ ...filters, maxResults: 1, getTotalCount: true })}`, {}, VOCA_TIMEOUT_MS);
  const total = Number(head?.totalCount) || 0;
  if (!total) return [];

  const span = Math.min(total, depth);
  const start = span > VOCA_PAGE ? rand(span - VOCA_PAGE) : 0;
  // fields=Names로 원어·로마자·영문이 한 번에 온다. 표기를 고를 일이 없다
  const page = await getJson<SongPage | null>(`${base}?${query({ ...filters, maxResults: VOCA_PAGE, start, fields: "PVs,Artists,Names,ThumbUrl" })}`, {}, VOCA_TIMEOUT_MS);

  return (page?.items || []).flatMap((song) => {
    const one = candidateOf(song, type);
    return one ? [one] : [];
  });
}

function candidateOf(song: Song, type: Site): Candidate | null {
  // disabled 를 꼭 봐야 한다. 저쪽은 영상이 내려간 것을 알고 표시해 두는데(웹에서 "PV 사용할
  // 수 없음"으로 회색이 되는 그것), 그걸 무시하면 죽은 영상을 골라 재생이 실패한다.
  // 실측: vocadb 100곡 중 10곡에 죽은 PV가 섞여 있다. Bad Apple!! 은 죽은 Original 다음에
  // 멀쩡한 Original 이 있어서, 안 보면 정확히 틀린 것을 집는다.
  const pvs = (song.pvs || []).filter((p) => p.service === "Youtube" && !p.disabled);
  const pv = pvs.find((p) => p.pvType === "Original") || pvs[0];
  if (!pv?.url || !song.name) return null;
  return {
    artist: creditOf(song) || song.artistString || "",
    title: song.name,
    youtubeUrl: pv.url,
    // 기본 응답에 들어 있다(100곡 중 빈 것 0개). 없으면 길이 제한에 걸려 통째로 떨어진다.
    durationSec: Number(song.lengthSeconds) || undefined,
    thumbnail: song.thumbUrl || null,
    sourceUrl: `https://${VOCA_HOSTS[type]}/S/${song.id}`,
    platform: type,
    sourceKey: `${type}:${song.id}`,
  };
}

// artistString은 애니메이터·일러스트레이터까지 다 붙인 것이다. 만든 사람과 부른 쪽만 추린다.
function creditOf(song: Song) {
  const roles = (want: string) => (song.artists || []).filter((a) => String(a.categories || "").includes(want)).map((a) => a.name);
  const makers = roles("Producer");
  const singers = roles("Vocalist");
  return [makers.join(", "), singers.join(", ")].filter(Boolean).join(" feat. ");
}

export { vocaFamily, advancedFilters, someLanguages, _forgetIds };
