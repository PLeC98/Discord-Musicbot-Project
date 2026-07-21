"use strict";

// youtubeMatch — Spotify/외부 트랙의 YouTube 동등물을 "점수제"로 고르는 순수 로직 + 쿼리 구성.
//
// 배경(두 가지 문제):
//  (1) 검색 쿼리를 `"제목" "아티스트"` 따옴표로 던져 유튜브가 과도하게 좁게/엉뚱하게 검색 →
//      정답이 아예 후보에 안 들어옴 (heiakim Remix·Chocolate Cream·U.N.Owen 등에서 실증).
//  (2) 옛 선택 로직이 "제목에 곡명 포함 or 'official' 포함하는 첫 결과"로 유튜브 순위를 뒤엎음
//      (Azari - Shadow Shadow: 본인 채널 업로드가 제목이 비어 있어 제목매칭 실패 → 커버가 선택됨).
//
// 개선:
//  - 쿼리: 사람이 검색하듯 따옴표 없이. `제목 아티스트`(주) + `제목`(보조)를 병합해 후보 폭을 넓힌다.
//  - 선택: 유튜브 순위를 강한 기준선으로 신뢰하되, 채널↔아티스트 일치·길이·정크 감점으로 재정렬.
//    약한 제목 부분일치만으로는 순위를 뒤집지 못한다. 길이는 "명백히 틀린 것"을 거르는 음성 필터.
//
// rankCandidates/scoreCandidate는 순수 함수(네트워크 없음) — 오프라인 테스트 가능.
// 실제 검색(YouTube.search)은 호출측(probe/TrackResolver)이 하고, 결과 병합은 mergeCandidateLists로.

// ── 튜닝 가능한 가중치 ─────────────────────────────────────────────────────
const RANK_BASE = 6; // 순위 점수 = max(0, RANK_BASE - rank) * rankPerPosition (병합 후 절대 순위 기준)
const W = {
  rankPerPosition: 10, // 유튜브 순위 1칸당
  channelMatch: 45, // 채널명이 아티스트와 일치
  channelOfficialBonus: 15, // 일치 + "- Topic"/VEVO면 추가
  channelOfficialStandalone: 20, // 이름 불일치여도 "- Topic"/VEVO(공식 아트트랙 계열)면 가점 (스크립트/로마자 차이 대응)
  durNear: 14, // 길이 차 ≤ 4초 (같은 마스터일 가능성 높음)
  durClose: 6, // 길이 차 ≤ 12초 (MV 인트로/아웃트로 여유)
  durLoose: 0, // 길이 차 ≤ 30초 (중립)
  durFar: -12, // 그 이상 (의심스럽지만 실격 아님)
  durGross: -300, // 명백한 불일치(1시간 루프/확장본/짤) → 사실상 실격
  junkEach: -50, // 커버/리믹스 등 정크 용어 1개당
  titleHasTrack: 6, // 후보 제목에 곡 제목 포함
  titleHasArtist: 4, // 후보 제목에 아티스트명 포함
  titleOfficialTag: 8, // 후보 제목에 "official video/audio/mv" 등
};

// 커버·리믹스·비원본 마커 (곡 제목 자체에 들어 있으면 감점하지 않음)
const JUNK_TERMS = [
  "cover",
  "covered",
  "remix",
  "nightcore",
  "sped up",
  "sped-up",
  "slowed",
  "reverb",
  "8bit",
  "8 bit",
  "chiptune",
  "karaoke",
  "instrumental",
  "off vocal",
  "backing track",
  "reaction",
  "mashup",
  "acoustic",
  "1 hour",
  "one hour",
  "loop",
  "extended",
  "tutorial",
  "lesson",
  "歌ってみた", // 우타이테 커버
  "弾いてみた", // 연주해봄
  "叩いてみた",
  "カバー",
  "リミックス",
  "作業用",
  "耳コピ",
  "커버",
  "리믹스",
  "노래방",
];

const ZERO_WIDTH = /\p{Cf}/gu; // 제로폭·서식 문자(U+200B 등)는 전부 유니코드 카테고리 Cf

// 느슨한 정규화 — 소문자화, 제로폭·괄호·구두점을 공백으로, 유니코드 글자/숫자는 보존(일본어/한국어).
function normLoose(s) {
  return String(s || "")
    .toLowerCase()
    .replace(ZERO_WIDTH, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// 채널명 정규화 — 매칭 방해 접미사 제거(topic/vevo/official/music/records/channel/tv).
function normChannel(s) {
  return normLoose(s)
    .replace(/\b(?:topic|vevo|official|officialchannel|channel|music|records?|tv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 다중 아티스트 분해: "A, B & C feat. D" → [a, b, c, d]
function splitArtists(artist) {
  return String(artist || "")
    .split(/\s*(?:,|&|×|＋|\+|;|\/|feat\.?|ft\.?|with)\s*/i)
    .map(normLoose)
    .filter((a) => a.length >= 2);
}

const despace = (s) => s.replace(/\s+/g, "");

// 채널이 아티스트를 나타내는가 + 공식 계열(topic/vevo) 여부.
function analyzeChannel(channel, artist) {
  const raw = normLoose(channel);
  const isTopic = /(?:^|\s)topic$/.test(raw) || raw.endsWith(" topic");
  const isVevo = raw.endsWith("vevo");

  const nc = normChannel(channel);
  const ncTight = despace(nc);
  let match = false;
  let exact = false;
  if (nc) {
    for (const part of splitArtists(artist)) {
      const pTight = despace(part);
      if (nc === part || ncTight === pTight) {
        match = true;
        exact = true;
        break;
      }
      // 부분 포함(양방향) — 공백 유무 모두 대조 (VEVO/붙여쓰기 채널 대응)
      if (nc.includes(part) || part.includes(nc) || ncTight.includes(pTight) || pTight.includes(ncTight)) {
        match = true;
      }
    }
  }
  return { match, exact, isTopic, isVevo };
}

function countJunk(candidateTitle, targetTitle) {
  const t = " " + normLoose(candidateTitle) + " ";
  const target = normLoose(targetTitle);
  let n = 0;
  for (const term of JUNK_TERMS) {
    const nt = normLoose(term);
    if (!nt) continue;
    if (target.includes(nt)) continue; // 곡 제목 자체에 있으면 정크 아님
    if (t.includes(" " + nt + " ") || t.includes(nt)) n++;
  }
  return n;
}

function durationScore(candSec, targetSec) {
  const c = Number(candSec) || 0;
  const t = Number(targetSec) || 0;
  if (c <= 0 || t <= 0) return { score: 0, label: "unknown" };

  const diff = Math.abs(c - t);
  const gross = c > t * 2.5 || c < t * 0.4 || (diff > 45 && (c > t * 1.6 || c < t * 0.5));
  if (gross) return { score: W.durGross, label: `gross(${c}s vs ${t}s)` };
  if (diff <= 4) return { score: W.durNear, label: `near(${diff}s)` };
  if (diff <= 12) return { score: W.durClose, label: `close(${diff}s)` };
  if (diff <= 30) return { score: W.durLoose, label: `loose(${diff}s)` };
  return { score: W.durFar, label: `far(${diff}s)` };
}

const OFFICIAL_TAG = /official\s*(?:video|audio|music\s*video|mv|m\/v|hd)|\bm\/v\b/i;

/**
 * 사람이 검색하듯 따옴표 없는 쿼리들. 병합 검색용(전부 실행해 후보를 합침).
 * 따옴표 쿼리는 유튜브에서 과도하게 좁아져 정답을 누락시키므로 쓰지 않는다.
 */
function buildSearchQueries(target) {
  const title = String(target.title || "").trim();
  const artist = String(target.artist || "").trim();
  const queries = [];
  if (title && artist) queries.push(`${title} ${artist}`);
  if (title) queries.push(title);
  return [...new Set(queries.filter(Boolean))];
}

/**
 * 여러 검색 결과 리스트를 하나로 병합(id로 중복 제거). rank는 어느 쿼리에서든 가장 높았던 순위(min index).
 * 각 리스트는 유튜브 순위 순서라고 가정. lists 순서 = 쿼리 우선순위(동순위 tiebreak용).
 */
function mergeCandidateLists(lists) {
  const byId = new Map();
  (lists || []).forEach((list, listOrder) => {
    (list || []).forEach((c, i) => {
      if (!c || !c.id) return;
      const ex = byId.get(c.id);
      if (!ex) {
        byId.set(c.id, { ...c, rank: i, listOrder });
      } else if (i < ex.rank) {
        ex.rank = i;
        ex.listOrder = listOrder;
      }
    });
  });
  return [...byId.values()];
}

/**
 * 후보 하나 채점.
 * candidate: { id, url, title, channel, durationSec, rank? }  (rank 없으면 0)
 * target:    { title, artist, durationSec }
 */
function scoreCandidate(candidate, target) {
  const rank = Number.isInteger(candidate.rank) ? candidate.rank : 0;
  const b = {};
  b.rank = Math.max(0, RANK_BASE - rank) * W.rankPerPosition;

  const ch = analyzeChannel(candidate.channel, target.artist);
  const officialUploader = ch.match || ch.isTopic || ch.isVevo;
  if (ch.match) b.channel = W.channelMatch + (ch.isTopic || ch.isVevo ? W.channelOfficialBonus : 0);
  else if (ch.isTopic || ch.isVevo) b.channel = W.channelOfficialStandalone;
  else b.channel = 0;

  const d = durationScore(candidate.durationSec, target.durationSec);
  b.duration = d.score;

  // 정크(cover/remix 등) 감점의 목적은 "남의 파생 버전 거르기". 업로더가 타겟 아티스트 본인
  // (채널 일치) 또는 공식 아트트랙(Topic/VEVO)이면 그 라벨은 원곡과의 관계 설명일 뿐 —
  // 스포티파이 링크가 가리키는 바로 그 녹음이므로 감점하지 않는다.
  // (커버 곡의 스포티파이 링크 → 그 아티스트 채널의 커버 영상을 골라야 하는 대칭성 확보)
  const junk = countJunk(candidate.title, target.title);
  const junkSuppressed = officialUploader && junk > 0;
  b.junk = officialUploader ? 0 : junk * W.junkEach;

  const nTitle = normLoose(candidate.title);
  const nTrack = normLoose(target.title);
  b.title = nTrack && nTitle.includes(nTrack) ? W.titleHasTrack : 0;
  b.artistInTitle = splitArtists(target.artist).some((a) => nTitle.includes(a)) ? W.titleHasArtist : 0;
  b.officialTag = OFFICIAL_TAG.test(candidate.title || "") ? W.titleOfficialTag : 0;

  const score = b.rank + b.channel + b.duration + b.junk + b.title + b.artistInTitle + b.officialTag;

  return {
    candidate,
    rank,
    score,
    breakdown: b,
    flags: { channelMatch: ch.match, channelExact: ch.exact, official: ch.isTopic || ch.isVevo, junk, junkSuppressed, duration: d.label },
  };
}

/**
 * 후보 배열을 점수순으로 정렬(각 항목에 breakdown 포함). 동점은 순위→리스트 우선순위 순.
 * candidate.rank가 있으면 그걸(병합 결과) 순위로, 없으면 배열 인덱스를 순위로 사용.
 */
function rankCandidates(candidates, target) {
  const withRank = candidates.map((c, i) => (Number.isInteger(c.rank) ? c : { ...c, rank: i }));
  const scored = withRank.map((c) => scoreCandidate(c, target));
  scored.sort((a, b) => b.score - a.score || a.rank - b.rank || (a.candidate.listOrder ?? 0) - (b.candidate.listOrder ?? 0));

  let confidence = "low";
  const top = scored[0];
  if (top) {
    // 적용된 감점 기준(breakdown.junk) — 채널 일치로 정크가 억제된 경우도 0으로 취급
    if (top.flags.channelMatch && top.breakdown.junk === 0) confidence = "high";
    else if (top.flags.official && top.flags.duration.startsWith("near")) confidence = "high";
    else if (top.flags.duration.startsWith("near") && top.breakdown.junk === 0) confidence = "high";
    else if (top.breakdown.junk === 0 && top.rank === 0) confidence = "medium";
  }
  return { ranked: scored, best: top ? top.candidate : null, confidence };
}

module.exports = {
  buildSearchQueries,
  mergeCandidateLists,
  rankCandidates,
  scoreCandidate,
  W,
  JUNK_TERMS,
  _internal: { normLoose, normChannel, analyzeChannel, durationScore, countJunk, splitArtists },
};
