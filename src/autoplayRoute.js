"use strict";

// 자동재생 한 곡을 고른다. 소스에서 후보를 받아 **틀 수 있는 트랙**으로 바꾸는 데까지가 여기 몫이다.
//
// 소스가 무엇을 주느냐에 따라 길이 셋으로 갈린다 — 후보에 **어느 칸이 찼는지**가 그것을 정한다.
//   youtubeUrl 있음 → 그 영상. 검색을 안 하므로 제목을 못 믿는다 → autoplayFilter를 건다
//   artist+title   → youtubeMatch로 찾는다. durationSec이 같이 오면 길이 신호가 켜져
//                    youtubeMatch가 알아서 걸러 주므로 autoplayFilter가 필요 없다
//   audioUrl 있음  → 위가 안 되면 이것을 그대로 튼다(AnimeThemes). 출처가 곧 정답이라 필터가 없다
//
// 왜 이렇게 나뉘는지와 문턱을 어떻게 재서 정했는지는 notes/plan-autoplay-routes.md에 있다.

const autoplayFilter = require("./autoplayFilter");
const pool = require("./autoplayPool");
const sources = require("./autoplaySources");
const match = require("./youtubeMatch");
const log = require("./logger").child({ category: "autoplay" });

// 유튜브에서 찾은 것이 이보다 짧으면 풀버전이 아니라 TV 사이즈 립이다.
// 그럴 바에는 AnimeThemes 음원을 그대로 트는 편이 낫다 — 음질만 나쁘고 단계만 는다.
const FULL_SEC = 150;

// 길이를 안 넘기는 경로에서는 high가 구조적으로 안 나온다(rankCandidates의 세 갈래가 전부
// channelMatch 아니면 duration에 걸려 있다). 그래서 문턱을 유형별로 달리 잡는다.
const CONFIDENCE_OK = new Set(["high", "medium"]);

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** 소스를 가로질러 같은 곡을 잡으려면 주소가 아니라 이름을 봐야 한다. */
const nameKey = (t) => `${norm(t.artist)}|${norm(t.title)}`;

/** 최근에 튼 곡들을 "이건 싫다" 판정으로 바꾼다. */
function rejector(recent) {
  const names = new Set();
  const urls = new Set();
  for (const t of recent || []) {
    if (!t) continue;
    if (t.title) names.add(nameKey(t));
    if (t.url) urls.add(t.url);
  }
  return (cand) => names.has(nameKey(cand)) || urls.has(cand.youtubeUrl || cand.audioUrl || "");
}

// 무게대로 하나 뽑되 뽑힌 것은 뺀다 — 한 소스가 빈 손이면 다음 소스로 가야 하기 때문이다.
function* byWeight(list) {
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
 * 유튜브 영상 하나를 재생 가능한 트랙으로.
 *
 * **표시 이름은 소스 것을 앞세운다.** 유튜브 채널명은 아티스트가 아니라 올린 사람이라
 * 그대로 두면 `lcozzarelli — Sarah Vaughan - Fever`처럼 나온다. 우리가 "Sarah Vaughan의 Fever"를
 * 찾아서 고른 것이므로 아티스트는 소스가 안다. 소스가 이름을 모를 때(keyword·유튜브 재생목록)만
 * 영상 쪽을 쓴다.
 */
const fromYouTube = (video, cand) => ({
  title: cand.title || video.title,
  artist: cand.artist || video.channel || video.artist || "",
  url: video.url,
  duration: Number(video.durationSec || video.duration) || 0,
  thumbnail: cand.thumbnail || video.thumbnail || null,
  platform: "youtube",
  type: "track",
  id: video.id,
});

/** AnimeThemes가 준 음원 하나를 재생 가능한 트랙으로. */
const fromAudio = (cand) => ({
  title: cand.title,
  artist: cand.artist || "",
  url: cand.audioUrl,
  // 길이를 미리 재지 않는다. 어차피 받아야 하고, TrackDownloader가 받으면서 실측해 고쳐 준다.
  duration: 0,
  durationSource: "미상",
  thumbnail: cand.thumbnail || null,
  platform: "direct",
  type: "track",
  id: cand.sourceKey,
});

// artist+title로 유튜브에서 그 곡을 찾는다. 길이를 아는 후보는 그 값을 넘겨 길이 신호를 켠다.
async function findOnYouTube(cand) {
  const YouTube = require("./YouTube");
  const target = { title: cand.title, artist: cand.artist, durationSec: Number(cand.durationSec) || 0 };
  const { primary, secondary } = match.buildSearchQueries(target);

  const run = async (queries) => {
    const lists = [];
    for (const one of queries.slice(0, 2)) {
      try {
        lists.push((await YouTube.search(one, 8)) || []);
      } catch {
        lists.push([]); // 한 검색어가 실패해도 나머지로 계속한다
      }
    }
    return lists;
  };

  const shape = (list) => list.map((r) => ({ id: r.id, url: r.url, title: r.title, channel: r.artist, durationSec: r.duration, isLive: r.isLive }));
  const primaryLists = (await run(primary)).map(shape);
  const secondaryLists = primaryLists.some((l) => l.length) ? [] : (await run(secondary)).map(shape);

  // 라이브는 동등물로서 언제나 오답이고, 골라 두면 다운로드가 끝나지 않는다
  const candidates = match.mergeCandidateLists(primaryLists, secondaryLists).filter((c) => c.url && !c.isLive);
  if (!candidates.length) return null;

  const { best, confidence } = match.rankCandidates(candidates, target);
  return best && CONFIDENCE_OK.has(confidence) ? best : null;
}

/**
 * 후보 하나를 틀 수 있는 트랙으로 바꾼다. 못 바꾸면 null.
 * @param {object} cand   소스가 준 후보
 * @param {object} limits autoplayFilter.prepare의 결과
 */
async function resolve(cand, limits) {
  // 1) 유튜브 주소를 직접 받은 것 — 검색을 안 했으니 제목을 못 믿는다
  if (cand.youtubeUrl) {
    const track = fromYouTube({ url: cand.youtubeUrl, title: cand.title, durationSec: cand.durationSec, id: cand.sourceKey }, cand);
    const verdict = autoplayFilter.judge(track, limits);
    if (!verdict.ok) {
      // 소스를 같이 남긴다 — "길이 없음"이 무더기로 나오면 그 소스가 길이를 안 준다는 뜻이고,
      // 그건 후보가 나쁜 게 아니라 소스 쪽을 고쳐야 하는 일이다.
      log.debug(`걸러냄(${verdict.reason}${verdict.detail ? `: ${verdict.detail}` : ""}) [${cand.sourceKey}]: ${track.title}`);
      return null;
    }
    return track;
  }

  // 2) 이름으로 유튜브에서 찾기
  if (cand.artist && cand.title) {
    const best = await findOnYouTube(cand);
    if (best) {
      const track = fromYouTube(best, cand);
      const verdict = autoplayFilter.judge(track, limits);
      // 길이를 넘긴 후보는 youtubeMatch가 이미 걸러 냈다. 모르는 후보만 여기서 한 번 더 본다.
      const needsFilter = !cand.durationSec;
      // 음원이 따로 있는데 찾은 것이 짧으면 TV 사이즈 립이다 — 그럴 바엔 음원을 쓴다
      const tooShort = cand.audioUrl && track.duration < FULL_SEC;
      if ((!needsFilter || verdict.ok) && !tooShort) return track;
    }
  }

  // 3) 음원을 직접 받은 것 — 출처가 곧 정답이라 필터가 없다
  if (cand.audioUrl) return fromAudio(cand);

  return null;
}

/**
 * 이 장르에서 한 곡을 고른다. 못 고르면 null(부르는 쪽이 자동재생을 끈다).
 *
 * @param {object} cfg      { ...defaults, ...genres[이름] } — sources를 들고 있다
 * @param {object[]} recent 최근에 튼 곡들(중복 회피용)
 */
async function pickTrack(cfg, recent = []) {
  const list = (cfg?.sources || []).filter((s) => s && sources.usable(s.type));
  if (!list.length) return null;

  const limits = autoplayFilter.prepare(cfg);
  const reject = rejector(recent);

  // 무게대로 훑되 한 소스가 빈 손이면 다음으로 간다. 목록이 곧 폴백 사슬이다.
  for (const source of byWeight(list)) {
    // 한 소스 안에서도 몇 번은 더 본다 — 후보 하나가 필터에 걸렸다고 소스를 버릴 이유가 없다
    for (let tries = 0; tries < 3; tries++) {
      const cand = await pool.take(source, sources.fetchFrom, reject);
      if (!cand) break;
      const track = await resolve(cand, limits);
      if (track) return track;
    }
  }
  return null;
}

module.exports = { pickTrack, resolve, rejector, nameKey, FULL_SEC, _byWeight: byWeight };
