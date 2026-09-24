// VocaDB 계열(VocaDB · UtaiteDB · TouhouDB) 소스.

import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "autoplay" });
import genreSources from "../../config/schema/genreSources.ts";
const { VOCA_DEFAULT_TYPES } = genreSources;
import http from "./http.js";
const { rand, getJson, query } = http;

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

const exported = { vocaFamily, lyricsFilter, someLanguages };
export default exported;
export { exported as "module.exports" };
