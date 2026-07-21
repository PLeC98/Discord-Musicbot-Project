"use strict";

// youtubeMatch — Spotify/외부 트랙의 YouTube 동등물을 "점수제"로 고르는 순수 로직.
//
// 배경: 유튜브 검색 자체는 정답을 대체로 1등으로 준다. 문제는 옛 선택 로직이
// "제목에 곡명 포함 or 'official' 포함하는 첫 결과"로 그 순위를 뒤엎던 것.
// (Azari - Shadow Shadow: 본인 채널 업로드가 제목이 비어 있어 제목매칭에 실패 →
//  커버/MV가 대신 선택됨.)
//
// 개선 원칙:
//  1) 유튜브 순위를 강한 기준선(prior)으로 신뢰한다.
//  2) 약한 신호(제목 부분일치)만으로는 순위를 뒤집지 못한다.
//  3) 채널↔아티스트 일치는 강한 양성 신호(순위를 뒤집을 수 있음).
//  4) 길이는 "명백히 틀린 것"을 걸러내는 음성 필터로 쓴다(정밀 판정용 아님).
//  5) 커버/리믹스/instrumental 등은 강하게 감점.
//
// 순수 함수 — 네트워크 없음. 후보 메타데이터만 받아 점수화하므로 오프라인 테스트 가능.

// ── 튜닝 가능한 가중치 (한곳에 모아 조정 용이) ──────────────────────────────
const W = {
  rankPerPosition: 10, // 유튜브 순위 기준선: (N - index) * 이 값
  channelMatch: 45, // 채널명이 아티스트와 일치
  channelOfficialBonus: 15, // 그 채널이 "- Topic"/VEVO/공식 계열이면 추가
  durNear: 14, // 길이 차 ≤ 4초 (같은 마스터일 가능성 높음)
  durClose: 6, // 길이 차 ≤ 12초 (MV 인트로/아웃트로 여유)
  durLoose: 0, // 길이 차 ≤ 30초 (중립)
  durFar: -12, // 그 이상 (의심스럽지만 실격은 아님)
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

const ZERO_WIDTH = /\p{Cf}/gu;

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

// 채널이 아티스트를 나타내는가 + 공식 계열(topic/vevo/artist 본인) 여부.
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
 * 후보 하나 채점.
 * candidate: { id, url, title, channel, durationSec }
 * target:    { title, artist, durationSec }
 * index:     유튜브 검색 순위(0=1등), poolSize: 후보 총수
 */
function scoreCandidate(candidate, target, index, poolSize) {
  const b = {}; // 신호별 breakdown
  b.rank = (poolSize - index) * W.rankPerPosition;

  const ch = analyzeChannel(candidate.channel, target.artist);
  b.channel = ch.match ? W.channelMatch + (ch.isTopic || ch.isVevo ? W.channelOfficialBonus : 0) : 0;

  const d = durationScore(candidate.durationSec, target.durationSec);
  b.duration = d.score;

  const junk = countJunk(candidate.title, target.title);
  b.junk = junk * W.junkEach;

  const nTitle = normLoose(candidate.title);
  const nTrack = normLoose(target.title);
  b.title = nTrack && nTitle.includes(nTrack) ? W.titleHasTrack : 0;
  b.artistInTitle = splitArtists(target.artist).some((a) => nTitle.includes(a)) ? W.titleHasArtist : 0;
  b.officialTag = OFFICIAL_TAG.test(candidate.title || "") ? W.titleOfficialTag : 0;

  const score = b.rank + b.channel + b.duration + b.junk + b.title + b.artistInTitle + b.officialTag;

  return {
    candidate,
    index,
    score,
    breakdown: b,
    flags: {
      channelMatch: ch.match,
      channelExact: ch.exact,
      official: ch.isTopic || ch.isVevo,
      junk,
      duration: d.label,
    },
  };
}

/**
 * 후보 배열을 점수순으로 정렬해 반환(각 항목에 breakdown 포함). 동점은 유튜브 순위 우선.
 * confidence: 최상위 후보의 신뢰도 라벨.
 */
function rankCandidates(candidates, target) {
  const scored = candidates.map((c, i) => scoreCandidate(c, target, i, candidates.length));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  let confidence = "low";
  const top = scored[0];
  if (top) {
    if (top.flags.channelMatch && top.flags.junk === 0) confidence = "high";
    else if (top.flags.duration.startsWith("near") && top.flags.junk === 0) confidence = "high";
    else if (top.breakdown.junk === 0 && top.index === 0) confidence = "medium";
  }
  return { ranked: scored, best: top ? top.candidate : null, confidence };
}

module.exports = { rankCandidates, scoreCandidate, W, JUNK_TERMS, _internal: { normLoose, normChannel, analyzeChannel, durationScore, countJunk, splitArtists } };
