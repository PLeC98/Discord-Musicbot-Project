// 자동재생 한 곡을 고른다. 소스에서 후보를 받아 틀 수 있는 트랙으로 바꾸는 데까지가 여기 몫이다.
//
// 소스가 무엇을 주느냐에 따라 길이 셋으로 갈린다. 후보에 어느 칸이 찼는지가 그것을 정한다.
//   youtubeUrl 있음 → 그 영상. 검색을 안 하므로 제목을 못 믿는다 → autoplayFilter를 건다
//   artist+title   → youtubeMatch로 찾는다. durationSec이 같이 오면 길이 신호가 켜져
//                    youtubeMatch가 알아서 걸러 주므로 autoplayFilter가 필요 없다
//   audioUrl 있음  → 위가 안 되거나 유튜브 쪽 근거가 모자라면 이것을 튼다.
//                    출처가 곧 정답이라 필터가 없다(upgradeWorthIt)
//
// 이름으로 찾기 전에 링크 장부부터 본다. 같은 요청(소스 안의 곡)을 전에 틀었으면 그때 정한 음원을 그대로 쓴다.
// 검색을 아끼고, 같은 곡이 뽑힐 때마다 다른 영상이 나오지 않는다.
//

import * as autoplayFilter from "./filter.ts";
import * as links from "../rules/links.ts";
import { canonicalUrl } from "../rules/canonicalUrl.ts";
import { candidateKind } from "../rules/candidateKind.ts";
import * as pool from "./pool.ts";
import * as sources from "./sources/index.ts";
import * as match from "../sources/youtube/match.ts";
import * as aiAssist from "./assist/index.ts";
import * as YouTube from "../sources/youtube/index.ts";
import * as trackLookup from "../store/trackLookup.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "autoplay" });
import type { GenreSource } from "../config/genres.ts";
import type { Candidate } from "./sources/candidate.ts";
import type { Limits, FilterConfig } from "./filter.ts";
import type { Judged } from "./assist/index.ts";

/** 틀 수 있는 트랙. 대기열에 담는 곡의 모양에 자동재생이 붙이는 칸 */
type PickedTrack = {
  title: string;
  artist: string;
  pageUrl: string;
  requestKey: string;
  audioUrl: string;
  platform: string;
  duration: number;
  durationSource?: string;
  thumbnail: string | null;
  type: "track";
  id?: string | number | null;
  audioFoundBy?: "ledger";
  /** 어느 소스에서 왔나 */
  pickedFrom?: string;
};
/** 유튜브 영상 하나. 검색 결과이거나 주소만 아는 것 */
type Video = { url: string; id?: string | number | null; title?: string | null; channel?: string | null; artist?: string | null; durationSec?: number | null; duration?: number | null; thumbnail?: string | null };
/** 최근에 튼 곡에서 읽는 칸 */
type Played = { title?: string | null; artist?: string | null; audioUrl?: string | null; [field: string]: unknown };
/** 싫다고 할지 볼 때 후보에서 읽는 칸 */
type Rejectable = Pick<Candidate, "title" | "artist" | "youtubeUrl" | "audioUrl">;
/** 장르 설정. 소스 목록과 거르기 설정 */
type PickConfig = FilterConfig & { sources?: GenreSource[]; genreName?: string };
// AI 보조에서 부르는 칸만
type Assist = {
  filter<T extends Judged>(candidates: T[], about: { genre?: string; confident: boolean }): Promise<T[]>;
  accepts(track: PickedTrack, about: { genre?: string }): Promise<boolean>;
};
/** 유튜브 검색. 여기서 읽는 칸만 */
type Search = (query: string, limit: number) => Promise<Array<{ id?: string | number | null; audioUrl?: string | null; title?: string | null; artist?: string | null; duration?: number | null; isLive?: boolean; thumbnail?: string | null }> | null | undefined>;
type Deps = {
  search: Search;
  known(requestKey: string): { audioUrl: string; durationSec?: number | null } | null;
  fetch(source: GenreSource): Promise<Candidate[]>;
  assist: Assist;
};

// 유튜브에서 찾은 것이 이보다 짧으면 풀버전이 아니라 TV 사이즈 립이다.
// 그럴 바에는 AnimeThemes 음원을 그대로 트는 편이 낫다. 음질만 나쁘고 단계만 는다.
const FULL_SEC = 150;

// 길이를 안 넘기는 경로에서는 high가 구조적으로 안 나온다(rankCandidates의 세 갈래가 전부
// channelMatch 아니면 duration에 걸려 있다). 그래서 문턱을 유형별로 달리 잡는다.
const CONFIDENCE_OK = new Set(["high", "medium"]);

// 내려간 영상. 소스 DB는 그게 아직 살아 있다고 믿으므로 우리가 기억해야 다시 안 고른다.
// (자동재생은 이 곡을 조용히 버리고 다음을 고른다. 사용자에게 알릴 일이 아니다.)
const DEAD_MAX = 500;
const dead = new Set<string>();

/** 이 영상은 못 튼다고 표시한다. 다음 뽑기부터 후보에서 빠진다. */
function markDead(urlOrTrack: string | { audioUrl?: string | null; [field: string]: unknown } | null | undefined): boolean {
  const url = typeof urlOrTrack === "string" ? urlOrTrack : urlOrTrack?.audioUrl;
  const id = url && links.extractVideoId(url);
  if (!id) return false;
  // 오래된 것부터 버린다. 영상이 되살아나는 일도 있고, 무한정 들고 있을 이유가 없다
  const oldest = dead.values().next().value;
  if (dead.size >= DEAD_MAX && oldest !== undefined) dead.delete(oldest);
  dead.add(id);
  log.debug(`못 트는 영상으로 표시: ${id}`);
  return true;
}

const isDead = (url: string | null | undefined) => {
  if (!url || !dead.size) return false;
  const id = links.extractVideoId(url);
  return !!id && dead.has(id);
};

// 글자와 숫자만 남긴다. 소스마다 띄어쓰기·하이픈·장식 기호가 달라서, 공백만 정리해서는
// 같은 곡을 놓친다: `Nan mo nee`/`Nanmonee`, `Laid-Back Journey`/`Laid Back Journey`,
// `Happy☆Material`/`Happy Material`. 두 애니송 DB 를 짝지어 재 보니 81.5% → 88.2%였다.
//
// ⚠️ `[^a-z0-9]` 로 쓰면 안 된다. 일본어 제목이 통째로 빈 문자열이 되어 서로 다른 곡이
//    전부 한 칸으로 뭉개진다. 소스 절반이 일본어 제목을 준다. \p{L}\p{N} 여야 한다.
//
// 판본 표기(`… Diavolo Ver.`)나 참여 표기(`… feat. Mummy-D`)는 글자가 남으므로 그대로 갈린다.
// 로마자 표기 차이(`Iki o Suu`/`Iki wo Suu`)는 여기서 못 잡는다. 그건 ID 로 이어야 하는 일이다.
const norm = (s: unknown) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** 소스를 가로질러 같은 곡을 잡으려면 주소가 아니라 이름을 봐야 한다. */
const nameKey = (t: Played) => `${norm(t.artist)}|${norm(t.title)}`;

/** 최근에 튼 곡들을 "이건 싫다" 판정으로 바꾼다. 주소는 음원 주소끼리 다듬어 견준다(출처 페이지는 작품 하나에 곡이 여럿일 수 있다) */
function rejector(recent: Array<Played | null | undefined> | null | undefined): (cand: Rejectable) => boolean {
  const names = new Set<string>();
  const audio = new Set<string>();
  for (const t of recent || []) {
    if (!t) continue;
    if (t.title) names.add(nameKey(t));
    if (t.audioUrl) audio.add(canonicalUrl(t.audioUrl));
  }
  return (cand) => isDead(cand.youtubeUrl) || names.has(nameKey(cand)) || audio.has(canonicalUrl(cand.youtubeUrl || cand.audioUrl || ""));
}

// 가중치대로 하나 뽑되 뽑힌 것은 뺀다. 한 소스가 빈 손이면 다음 소스로 가야 하기 때문이다.
function* byWeight(list: GenreSource[]): Generator<GenreSource> {
  const left = list.map((s) => ({ source: s, weight: Math.max(1, Number(s.weight) || 1) }));
  while (left.length) {
    const total = left.reduce((sum, x) => sum + x.weight, 0);
    let roll = Math.random() * total;
    let i = left.findIndex((x) => (roll -= x.weight) < 0);
    if (i < 0) i = left.length - 1;
    yield left.splice(i, 1)[0].source;
  }
}

/**
 * 이 후보를 무엇이라 부르나(요청 열쇠). 링크 장부가 이것으로 찾는다.
 * 소스가 곡 페이지를 주면 다듬은 그 주소(스포티파이 소스와 스포티파이 링크를 넣은 사용자가 같은 줄을 쓴다),
 * 영상 자체가 후보면 그 영상, 소스 안의 곡 id 면 그대로(amq:48944 · vocadb:123 …),
 * 이름뿐이면 소스 이름을 붙인다(lastfm:가수|제목). 작품 페이지처럼 곡 여럿을 가리키는 주소는 쓰지 않는다.
 */
function requestKeyOf(cand: Partial<Candidate>): string {
  const key = String(cand.sourceKey ?? "");
  if (links.isHttpLink(key)) return canonicalUrl(key);
  if (cand.youtubeUrl && !cand.sourceUrl) return canonicalUrl(cand.youtubeUrl);
  if (/^[a-z]+:\d+$/.test(key)) return key;
  return `${cand.platform || "autoplay"}:${key || `${cand.artist}|${cand.title}`}`;
}

/**
 * 유튜브 영상 하나를 재생 가능한 트랙으로.
 *
 * 표시 이름은 소스 것을 앞세운다. 유튜브 채널명은 아티스트가 아니라 올린 사람이다.
 *
 * 이름만 바꿔서는 안 된다. `platform: "youtube"`면 TrackDownloader가 제목을 영상 제목으로 되돌려 놓는다.
 * 그래서 보여 줄 링크와 platform은 출처 것으로 두고 영상은 음원 주소에만 쓴다.
 * 장부에는 요청 열쇠로 줄이 따로 생기고, 음원 파일은 영상 하나에 하나다. 스포티파이와 같은 방식이다.
 */
function fromYouTube(video: Video, cand: Candidate): PickedTrack {
  // 출처가 따로 있는 곡인가(Last.fm·LB Radio·VocaDB·AnimeThemes), 아니면 영상 자체가 출처인가(keyword·유튜브 재생목록)
  const sourced = !!cand.sourceUrl;
  const videoUrl = canonicalUrl(video.url);

  return {
    title: cand.title || video.title || "",
    artist: cand.artist || video.channel || video.artist || "",
    pageUrl: sourced && cand.sourceUrl ? cand.sourceUrl : videoUrl,
    requestKey: requestKeyOf(cand),
    audioUrl: videoUrl,
    platform: sourced ? cand.platform || "youtube" : "youtube",
    duration: Number(video.durationSec || video.duration) || 0,
    thumbnail: cand.thumbnail || video.thumbnail || null,
    type: "track",
    id: video.id || links.extractVideoId(video.url),
  };
}

/**
 * AnimeThemes가 준 음원 하나를 재생 가능한 트랙으로.
 *
 * `DirectLink.getInfo`를 거치지 않는다. 그쪽 CDN이 HEAD에 403을 준다. 거쳤더라도 쓰지 않을 것이
 * 제목을 파일명으로, 아티스트를 "직접 링크"로, 앨범아트를 빈 그림으로 채우기 때문이다.
 * 우리는 API에서 진짜 이름과 표지를 받아 왔으므로 그것을 그대로 싣는다.
 */
const fromAudio = (cand: Candidate & { audioUrl: string }): PickedTrack => ({
  title: cand.title,
  artist: cand.artist || "",
  // 사람에게 보일 링크는 출처 페이지다. 음원 파일 주소를 눌러 봐야 쓸모가 없다(출처 페이지가 없을 때만 음원)
  pageUrl: cand.sourceUrl || cand.audioUrl,
  requestKey: requestKeyOf(cand),
  audioUrl: cand.audioUrl,
  // 길이를 미리 재지 않는다. 어차피 받아야 하고, TrackDownloader가 받으면서 실측해 고쳐 준다.
  duration: 0,
  durationSource: "미상",
  thumbnail: cand.thumbnail || null,
  // 패널에 "Direct"가 아니라 어디서 온 곡인지 보이게 한다
  platform: cand.platform || "direct",
  type: "track",
  id: cand.sourceKey,
});

// 바깥 경계. 테스트는 이것을 넘겨 진짜 소스 · 검색 · 장부 · AI 보조를 부르지 않는다
const REAL: Deps = {
  search: (query, limit) => YouTube.search(query, limit),
  // 장부가 아는 음원 주소. 받아 둔 파일이 있으면 그 길이도(후보가 길이를 안 주는 소스가 있다)
  known(requestKey) {
    const hit = trackLookup.resolveFromCache(requestKey);
    if (hit.hit) return { audioUrl: hit.track.audioUrl, durationSec: hit.track.duration };
    const audioUrl = trackLookup.getAudioUrl(requestKey);
    return audioUrl ? { audioUrl } : null;
  },
  fetch: (source) => sources.fetchFrom(source),
  assist: aiAssist,
};

// artist+title로 유튜브에서 그 곡을 찾는다. 길이를 아는 후보는 그 값을 넘겨 길이 신호를 켠다.
async function findOnYouTube(cand: Candidate, genre: string | undefined, { search, assist }: Deps) {
  const target = { title: cand.title, artist: cand.artist, durationSec: Number(cand.durationSec) || 0 };
  const { primary, secondary } = match.buildSearchQueries(target);

  const run = async (queries: string[]) => {
    const lists: Array<Awaited<ReturnType<Search>> & object> = [];
    for (const one of queries.slice(0, 2)) {
      try {
        lists.push((await search(one, 8)) || []);
      } catch {
        lists.push([]); // 한 검색어가 실패해도 나머지로 계속한다
      }
    }
    return lists;
  };

  // thumbnail을 꼭 실어야 한다. Last.fm·LB Radio는 표지를 안 주므로 영상 것이 유일한 그림이다.
  // 빠뜨리면 앨범아트 자리에 디스코드의 빈 그림이, 대시보드에는 파일 아이콘이 뜬다.
  const shape = (list: Awaited<ReturnType<Search>> & object) => list.map((r) => ({ id: r.id, url: r.audioUrl, title: r.title, channel: r.artist, durationSec: r.duration, isLive: r.isLive, thumbnail: r.thumbnail }));
  const primaryLists = (await run(primary)).map(shape);
  const secondaryLists = primaryLists.some((l) => l.length) ? [] : (await run(secondary)).map(shape);

  // 라이브는 동등물로서 언제나 오답이고, 골라 두면 다운로드가 끝나지 않는다
  const candidates = match.mergeCandidateLists(primaryLists, secondaryLists).filter((c): c is typeof c & { url: string } => !!c.url && !c.isLive);
  if (!candidates.length) return null;

  let { best, confidence, ranked } = match.rankCandidates(candidates, target);
  if (!best) return null;

  // 규칙이 고른 뒤에 한 번 더 묻는다. 꺼져 있거나 못 부르면 같은 배열이 그대로 돌아온다.
  const kept = await assist.filter(candidates, { genre, confident: confidence === "high" });
  if (kept !== candidates) {
    ({ best, confidence, ranked } = match.rankCandidates(kept, target));
    if (!best) return null;
  }

  if (!CONFIDENCE_OK.has(confidence)) return null;
  if (!upgradeWorthIt(cand, confidence, ranked[0])) return null;
  // 이름으로 찾아온 것도 이미 못 튼다고 표시된 영상일 수 있다
  return isDead(best.url) ? null : best;
}

/**
 * 음원을 이미 가진 후보를 유튜브 것으로 바꿔도 되는가.
 *
 * medium 은 "나쁜 신호가 없다"일 뿐 "같은 곡이다"가 아니다. 그런데 애니송 DB 는 길이를
 * 실어 보내지 않고(AMQ 클립 길이라 곡 길이가 아니다), 가수 이름이 채널명과 같은 일도
 * 드물다. 그래서 high 로 가는 세 길이 전부 막히고 "정크 단어가 없는 검색 1위"만 남아
 * medium 이 된다.
 *
 * 올바른 녹음을 이미 손에 쥐고 있을 때는 그만큼으로는 부족하다. 최소한 영상 제목에
 * 곡 제목이 들어 있어야 바꾼다. 아니면 음원을 그대로 튼다.
 */
function upgradeWorthIt(cand: Candidate, confidence: string, top: { breakdown?: { title?: number } } | undefined) {
  if (!cand.audioUrl) return true;
  const ok = confidence === "high" || !!top?.breakdown?.title;
  if (!ok) log.debug(`음원을 그대로 씁니다(유튜브 쪽 근거 부족: ${confidence}) [${cand.sourceKey}]: ${cand.title}`);
  return ok;
}

/** 유튜브 주소를 직접 받은 후보. candidateKind 가 youtube 면 주소가 있다 */
async function fromGivenVideo(cand: Candidate, limits: Limits, genre: string | undefined, assist: Assist): Promise<PickedTrack | null> {
  if (!cand.youtubeUrl) return null;
  const track = fromYouTube({ url: cand.youtubeUrl, title: cand.title, durationSec: cand.durationSec }, cand);
  const verdict = autoplayFilter.judge(track, limits);
  if (!verdict.ok) {
    // 소스를 같이 남긴다. "길이 없음"이 무더기로 나오면 그 소스가 길이를 안 준다는 뜻이고,
    // 그건 후보가 나쁜 게 아니라 소스 쪽을 고쳐야 하는 일이다.
    log.debug(`걸러냄(${verdict.reason}${verdict.detail ? `: ${verdict.detail}` : ""}) [${cand.sourceKey}]: ${track.title}`);
    return null;
  }
  // 검색으로 얻은 것(키워드)만 한 번 더 묻는다. 주소를 직접 주는 소스는 출처가 곧 정답이다.
  // 실측에서 AI가 규칙을 이긴 것이 바로 이 경로였다(86% → 95%).
  if (cand.fromSearch && !(await assist.accepts(track, { genre }))) return null;
  return track;
}

/**
 * 후보 하나를 틀 수 있는 트랙으로 바꾼다. 못 바꾸면 null.
 * @param cand   소스가 준 후보
 * @param limits autoplayFilter.prepare의 결과
 * @param genre 장르 이름. AI 보조가 "이 장르가 맞나"를 물을 때만 쓴다
 * @param deps  바깥 경계(REAL). 생략하면 진짜
 */
async function resolve(cand: Candidate, limits: Limits, genre?: string, deps: Deps = REAL): Promise<PickedTrack | null> {
  const kind = candidateKind(cand);
  const { assist } = deps;

  // 1) 유튜브 주소를 직접 받은 것. 검색을 안 했으니 제목을 못 믿는다
  if (kind === "youtube") return fromGivenVideo(cand, limits, genre, assist);

  // 2) 이름으로 유튜브에서 찾기. 장부에 이 요청의 음원이 있으면 찾지 않고 그것을 쓴다
  if (kind === "search") {
    const ledger = fromLedger(cand, deps.known(requestKeyOf(cand)));
    if (ledger) return ledger;
    const best = await findOnYouTube(cand, genre, deps);
    if (best) {
      const track = fromYouTube(best, cand);
      const verdict = autoplayFilter.judge(track, limits);
      // 길이를 넘긴 후보는 youtubeMatch가 이미 걸러 냈다. 모르는 후보만 여기서 한 번 더 본다.
      const needsFilter = !cand.durationSec;
      // 음원이 따로 있는데 찾은 것이 짧으면 TV 사이즈 립이다. 그럴 바엔 음원을 쓴다
      const tooShort = cand.audioUrl && track.duration < FULL_SEC;
      if ((!needsFilter || verdict.ok) && !tooShort) return track;
    }
  }

  // 3) 음원을 직접 받은 것. 출처가 곧 정답이라 필터가 없다
  if (cand.audioUrl) return fromAudio({ ...cand, audioUrl: cand.audioUrl });

  return null;
}

/**
 * 장부가 아는 음원으로 트랙을 만든다. 전에 이 요청을 틀 때 정한 것이라 거르기를 다시 하지 않는다.
 * 영상이면 그 영상(못 트는 것으로 표시된 영상은 빼고), 음원 파일이었으면 소스가 지금 준 음원을 쓴다.
 * 모르면 null(평소대로 찾는다).
 */
function fromLedger(cand: Candidate, known: ReturnType<Deps["known"]>): PickedTrack | null {
  if (!known?.audioUrl) return null;
  if (links.isYouTubeURL(known.audioUrl)) {
    if (isDead(known.audioUrl)) return null;
    const track = fromYouTube({ url: known.audioUrl, durationSec: known.durationSec || cand.durationSec }, cand);
    track.audioFoundBy = "ledger"; // 내려갔으면 다시 찾는다
    return track;
  }
  return cand.audioUrl ? fromAudio({ ...cand, audioUrl: cand.audioUrl }) : null;
}

/**
 * 이 장르에서 한 곡을 고른다. 못 고르면 null(부르는 쪽이 자동재생을 끈다).
 *
 * @param cfg      { ...defaults, ...genres[이름] }. sources를 들고 있다
 * @param recent 최근에 튼 곡들(중복 회피용)
 * @param deps   바깥 경계(resolve 와 같다)
 */
async function pickTrack(cfg: PickConfig | null | undefined, recent: Array<Played | null | undefined> = [], deps: Deps = REAL): Promise<PickedTrack | null> {
  const list = (cfg?.sources || []).filter((s) => s && sources.usable(s.type));
  if (!list.length) return null;

  const limits = autoplayFilter.prepare(cfg);
  const reject = rejector(recent);

  // 가중치대로 훑되 한 소스가 빈 손이면 다음으로 간다. 목록이 곧 폴백 사슬이다.
  for (const source of byWeight(list)) {
    // 한 소스 안에서도 몇 번은 더 본다. 후보 하나가 필터에 걸렸다고 소스를 버릴 이유가 없다
    for (let tries = 0; tries < 3; tries++) {
      const cand = await pool.take(source, deps.fetch, reject);
      if (!cand) break;
      const track = await resolve(cand, limits, cfg?.genreName, deps);
      if (track) {
        // 어느 소스에서 어떻게 왔는지. 뭐가 이상할 때 이것부터 본다
        track.pickedFrom = source.type;
        return track;
      }
    }
  }
  return null;
}

export { REAL, pickTrack, resolve, requestKeyOf, rejector, nameKey, markDead, FULL_SEC, byWeight as _byWeight, dead as _dead };
export type { Deps, PickedTrack, PickConfig };
