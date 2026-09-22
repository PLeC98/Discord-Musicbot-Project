"use strict";

// 자동재생 한 곡을 고른다. 소스에서 후보를 받아 틀 수 있는 트랙으로 바꾸는 데까지가 여기 몫이다.
//
// 소스가 무엇을 주느냐에 따라 길이 셋으로 갈린다. 후보에 어느 칸이 찼는지가 그것을 정한다.
//   youtubeUrl 있음 → 그 영상. 검색을 안 하므로 제목을 못 믿는다 → autoplayFilter를 건다
//   artist+title   → youtubeMatch로 찾는다. durationSec이 같이 오면 길이 신호가 켜져
//                    youtubeMatch가 알아서 걸러 주므로 autoplayFilter가 필요 없다
//   audioUrl 있음  → 위가 안 되면 이것을 그대로 튼다(AnimeThemes). 출처가 곧 정답이라 필터가 없다
//

const autoplayFilter = require("./autoplayFilter");
const pool = require("./autoplayPool");
const sources = require("./autoplaySources");
const match = require("./youtubeMatch");
const assist = require("./autoplayAssist");
const log = require("./logger").child({ category: "autoplay" });

// 유튜브에서 찾은 것이 이보다 짧으면 풀버전이 아니라 TV 사이즈 립이다.
// 그럴 바에는 AnimeThemes 음원을 그대로 트는 편이 낫다. 음질만 나쁘고 단계만 는다.
const FULL_SEC = 150;

// 길이를 안 넘기는 경로에서는 high가 구조적으로 안 나온다(rankCandidates의 세 갈래가 전부
// channelMatch 아니면 duration에 걸려 있다). 그래서 문턱을 유형별로 달리 잡는다.
const CONFIDENCE_OK = new Set(["high", "medium"]);

// 내려간 영상. 소스 DB는 그게 아직 살아 있다고 믿으므로 우리가 기억해야 다시 안 고른다.
// (자동재생은 이 곡을 조용히 버리고 다음을 고른다. 사용자에게 알릴 일이 아니다.)
const DEAD_MAX = 500;
const dead = new Set();

/** 이 영상은 못 튼다고 표시한다. 다음 뽑기부터 후보에서 빠진다. */
function markDead(urlOrTrack) {
  const url = typeof urlOrTrack === "string" ? urlOrTrack : urlOrTrack?.youtubeUrl || urlOrTrack?.url;
  const id = url && require("./YouTube").extractVideoId(url);
  if (!id) return false;
  // 오래된 것부터 버린다. 영상이 되살아나는 일도 있고, 무한정 들고 있을 이유가 없다
  if (dead.size >= DEAD_MAX) dead.delete(dead.values().next().value);
  dead.add(id);
  log.debug(`못 트는 영상으로 표시: ${id}`);
  return true;
}

const isDead = (url) => {
  if (!url || !dead.size) return false;
  const id = require("./YouTube").extractVideoId(url);
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
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

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
  return (cand) => isDead(cand.youtubeUrl) || names.has(nameKey(cand)) || urls.has(cand.youtubeUrl || cand.audioUrl || "");
}

// 가중치대로 하나 뽑되 뽑힌 것은 뺀다. 한 소스가 빈 손이면 다음 소스로 가야 하기 때문이다.
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
 * 표시 이름은 소스 것을 앞세운다. 유튜브 채널명은 아티스트가 아니라 올린 사람이다.
 *
 * 이름만 바꿔서는 안 된다. `platform: "youtube"`이고 주소가 영상 주소면 캐시 장부의 그 영상 칸에
 * 우리 이름이 덮이고, TrackDownloader가 제목을 영상 제목으로 되돌려 놓는다.
 * 그래서 주소와 platform은 출처 것으로 두고, 영상은 `youtubeUrl`에, 소리는 `audioSourceKey`로
 * 나눠 쓴다. 장부에 칸이 따로 생기고 음원 파일은 하나만 받는다. 스포티파이와 같은 방식이다.
 */
function fromYouTube(video, cand) {
  const YouTube = require("./YouTube");
  const videoId = video.id || YouTube.extractVideoId(video.url);
  // 출처가 따로 있는 곡인가(Last.fm·LB Radio·VocaDB·AnimeThemes), 아니면 영상 자체가 출처인가(keyword·유튜브 재생목록)
  const sourced = !!cand.sourceUrl;

  return {
    title: cand.title || video.title,
    artist: cand.artist || video.channel || video.artist || "",
    url: sourced ? cand.sourceUrl : video.url,
    youtubeUrl: sourced ? video.url : undefined,
    platform: sourced ? cand.platform || "youtube" : "youtube",
    // 소리는 영상에서 온다. 출처가 달라도 같은 영상이면 파일 하나를 함께 쓴다
    audioSourceKey: videoId ? `yt:${videoId}` : undefined,
    duration: Number(video.durationSec || video.duration) || 0,
    thumbnail: cand.thumbnail || video.thumbnail || null,
    type: "track",
    id: videoId,
  };
}

/**
 * AnimeThemes가 준 음원 하나를 재생 가능한 트랙으로.
 *
 * `DirectLink.getInfo`를 거치지 않는다. 그쪽 CDN이 HEAD에 403을 준다. 거쳤더라도 쓰지 않을 것이
 * 제목을 파일명으로, 아티스트를 "직접 링크"로, 앨범아트를 빈 그림으로 채우기 때문이다.
 * 우리는 API에서 진짜 이름과 표지를 받아 왔으므로 그것을 그대로 싣는다.
 */
const fromAudio = (cand) => ({
  title: cand.title,
  artist: cand.artist || "",
  // url 은 음원 그대로 둔다. 받는 쪽(DirectLink)이 이 주소로 가져오고, 세션 복원도 이것만 남긴다.
  // 사람에게 보일 링크는 webUrl 로 따로 싣는다. 음원 파일 주소를 눌러 봐야 쓸모가 없다.
  url: cand.audioUrl,
  webUrl: cand.sourceUrl || undefined,
  // 길이를 미리 재지 않는다. 어차피 받아야 하고, TrackDownloader가 받으면서 실측해 고쳐 준다.
  duration: 0,
  durationSource: "미상",
  thumbnail: cand.thumbnail || null,
  // 패널에 "Direct"가 아니라 어디서 온 곡인지 보이게 한다
  platform: cand.platform || "direct",
  // DirectLink와 같은 규약. 이 값이 있어야 캐시 장부에 이름·표지가 남는다
  audioSourceKey: `dl:${require("./CacheManager").md5(cand.audioUrl)}`,
  type: "track",
  id: cand.sourceKey,
});

// artist+title로 유튜브에서 그 곡을 찾는다. 길이를 아는 후보는 그 값을 넘겨 길이 신호를 켠다.
async function findOnYouTube(cand, genre) {
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

  // thumbnail을 꼭 실어야 한다. Last.fm·LB Radio는 표지를 안 주므로 영상 것이 유일한 그림이다.
  // 빠뜨리면 앨범아트 자리에 디스코드의 빈 그림이, 대시보드에는 파일 아이콘이 뜬다.
  const shape = (list) => list.map((r) => ({ id: r.id, url: r.url, title: r.title, channel: r.artist, durationSec: r.duration, isLive: r.isLive, thumbnail: r.thumbnail }));
  const primaryLists = (await run(primary)).map(shape);
  const secondaryLists = primaryLists.some((l) => l.length) ? [] : (await run(secondary)).map(shape);

  // 라이브는 동등물로서 언제나 오답이고, 골라 두면 다운로드가 끝나지 않는다
  const candidates = match.mergeCandidateLists(primaryLists, secondaryLists).filter((c) => c.url && !c.isLive);
  if (!candidates.length) return null;

  let { best, confidence } = match.rankCandidates(candidates, target);
  if (!best) return null;

  // 규칙이 고른 뒤에 한 번 더 묻는다. 꺼져 있거나 못 부르면 같은 배열이 그대로 돌아온다.
  const kept = await assist.filter(candidates, { genre, confident: confidence === "high" });
  if (kept !== candidates) {
    ({ best, confidence } = match.rankCandidates(kept, target));
    if (!best) return null;
  }

  if (!CONFIDENCE_OK.has(confidence)) return null;
  // 이름으로 찾아온 것도 이미 못 튼다고 표시된 영상일 수 있다
  return isDead(best.url) ? null : best;
}

/**
 * 후보 하나를 틀 수 있는 트랙으로 바꾼다. 못 바꾸면 null.
 * @param {object} cand   소스가 준 후보
 * @param {object} limits autoplayFilter.prepare의 결과
 * @param {string} [genre] 장르 이름. AI 보조가 "이 장르가 맞나"를 물을 때만 쓴다
 */
async function resolve(cand, limits, genre) {
  // 1) 유튜브 주소를 직접 받은 것. 검색을 안 했으니 제목을 못 믿는다
  if (cand.youtubeUrl) {
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

  // 2) 이름으로 유튜브에서 찾기
  if (cand.artist && cand.title) {
    const best = await findOnYouTube(cand, genre);
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
  if (cand.audioUrl) return fromAudio(cand);

  return null;
}

/**
 * 이 장르에서 한 곡을 고른다. 못 고르면 null(부르는 쪽이 자동재생을 끈다).
 *
 * @param {object} cfg      { ...defaults, ...genres[이름] }. sources를 들고 있다
 * @param {object[]} recent 최근에 튼 곡들(중복 회피용)
 */
async function pickTrack(cfg, recent = []) {
  const list = (cfg?.sources || []).filter((s) => s && sources.usable(s.type));
  if (!list.length) return null;

  const limits = autoplayFilter.prepare(cfg);
  const reject = rejector(recent);

  // 가중치대로 훑되 한 소스가 빈 손이면 다음으로 간다. 목록이 곧 폴백 사슬이다.
  for (const source of byWeight(list)) {
    // 한 소스 안에서도 몇 번은 더 본다. 후보 하나가 필터에 걸렸다고 소스를 버릴 이유가 없다
    for (let tries = 0; tries < 3; tries++) {
      const cand = await pool.take(source, sources.fetchFrom, reject);
      if (!cand) break;
      const track = await resolve(cand, limits, cfg?.genreName);
      if (track) {
        // 어느 소스에서 어떻게 왔는지. 뭐가 이상할 때 이것부터 본다
        track.pickedFrom = source.type;
        return track;
      }
    }
  }
  return null;
}

module.exports = { pickTrack, resolve, rejector, nameKey, markDead, FULL_SEC, _byWeight: byWeight, _dead: dead };
