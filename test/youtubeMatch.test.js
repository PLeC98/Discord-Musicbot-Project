"use strict";

// src/youtubeMatch.js — Spotify 트랙의 YouTube 동등물 선택
//
// 회귀 코퍼스(test/fixtures/youtube-match-corpus.json)는 실제 유튜브 검색 결과를 그대로 얼린
// 것이다. 기대값은 사용자가 지정한 정답이거나, 이전 조사에서 정답으로 확인된 것이다.
// 네트워크를 타지 않으므로 결과가 흔들리지 않고, 가중치를 만질 때 무엇이 깨지는지 바로 보인다.
//
// 코퍼스가 잡는 것(전부 실제로 틀렸던 사례):
//  - 공식 채널의 영어판/라이브가 원곡을 이기던 것 (버전 감점 · 면제 제외)
//  - 가사·자막 재업로드가 길이만으로 공식 MV를 이기던 것 (재배포 감점 · 공식이면 면제)
//  - 공식 MV의 인트로/아웃트로가 길이 감점을 받던 것 (긴 쪽 완화)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { mergeCandidateLists, rankCandidates, scoreCandidate, W, _internal: I } = require("../src/youtubeMatch");

const corpus = require(path.join(__dirname, "fixtures", "youtube-match-corpus.json"));

function choose(entry) {
  const cands = mergeCandidateLists(entry.lists.primary, entry.lists.secondary).filter((c) => c.url && !c.isLive);
  return rankCandidates(cands, entry.target);
}

// ── 회귀 코퍼스 ──────────────────────────────────────────────

for (const entry of corpus.filter((e) => e.expect)) {
  test(`코퍼스: ${entry.note}`, () => {
    const { best, ranked } = choose(entry);
    assert.ok(best, "후보가 있어야 한다");
    const chosen = ranked[0];
    const want = ranked.find((r) => r.candidate.id === entry.expect);
    assert.equal(best.id, entry.expect, `\n  기대: ${entry.expect} (${want ? want.score + "점" : "후보에 없음"})` + `\n  실제: ${best.id} (${chosen.score}점) "${best.title}"`);
  });
}

test("정답이 존재하지 않는 곡도 던지지 않고 무언가를 고른다", () => {
  const entry = corpus.find((e) => !e.expect);
  const { best, confidence } = choose(entry);
  assert.ok(best === null || typeof best.url === "string");
  assert.ok(["low", "medium", "high"].includes(confidence));
});

// ── 용어 판정 ────────────────────────────────────────────────

test("라틴 용어는 단어 경계로 찾는다 (부분 문자열 오탐 회귀)", () => {
  assert.equal(I.countJunk("The Discovery Song", "x"), 0, "Discovery가 cover에 걸리면 안 된다");
  assert.equal(I.countJunk("Loophole", "x"), 0, "Loophole이 loop에 걸리면 안 된다");
  assert.equal(I.countVersion("Alive and Well", "x"), 0, "Alive가 live에 걸리면 안 된다");

  assert.equal(I.countJunk("Song (Cover)", "x"), 1);
  assert.equal(I.countVersion("Song (Live)", "x"), 1);
});

test("일본어·한국어 용어는 붙여쓰기라 부분 문자열로 찾는다", () => {
  assert.equal(I.countJunk("【歌ってみた】曲", "x"), 1);
  assert.equal(I.countVersion("곡 (한국어판)", "x"), 1);
});

test("곡 제목 자체에 든 용어는 감점하지 않는다", () => {
  assert.equal(I.countVersion("UNDEAD (English Version)", "UNDEAD - English Version"), 0);
  assert.equal(I.countJunk("Live and Let Die", "Live and Let Die"), 0);
});

// ── 면제 규칙 ────────────────────────────────────────────────

const target = { title: "곡", artist: "아티스트", durationSec: 200 };
const cand = (over) => ({ id: "x", url: "u", title: "곡", channel: "남의채널", durationSec: 200, rank: 0, ...over });

test("버전 표기는 공식 채널이어도 면제되지 않는다", () => {
  const r = scoreCandidate(cand({ title: "곡 (English ver.)", channel: "아티스트" }), target);
  assert.equal(r.breakdown.version, W.versionEach, "공식 채널이 올린 영어판도 감점 대상");
  assert.equal(r.flags.channelMatch, true);
});

test("정크는 공식 채널이거나 길이가 정확하면 면제된다", () => {
  // 길이를 어긋나게 둬야 채널 때문에 면제되는지가 드러난다 — 길이가 정확하면 그것만으로 면제된다.
  const off = { durationSec: 220 };
  const own = scoreCandidate(cand({ title: "곡 (Cover)", channel: "아티스트", ...off }), target);
  const other = scoreCandidate(cand({ title: "곡 (Cover)", ...off }), target);
  assert.equal(own.breakdown.junk, 0, "본인 채널이면 면제");
  assert.equal(other.breakdown.junk, W.junkEach, "남의 채널이면 감점");

  const exact = scoreCandidate(cand({ title: "곡 (Cover)" }), target); // 길이 정확
  assert.equal(exact.breakdown.junk, 0, "같은 마스터로 보이면 면제");
});

test("음악방송 무대는 버전 불일치로 본다 (제목에 live가 없어도)", () => {
  const r = scoreCandidate(cand({ title: "【TVPP】 Twice – TT @Show Music Core" }), target);
  assert.ok(r.breakdown.version < 0, "라이브 무대는 스튜디오 마스터가 아니다");
});

test("재배포 감점도 공식 채널이면 면제된다 (공식 Lyric Video가 정답인 경우)", () => {
  const own = scoreCandidate(cand({ title: "곡 (Lyric Video)", channel: "아티스트" }), target);
  const other = scoreCandidate(cand({ title: "곡 [Color Coded Lyrics]" }), target);
  assert.equal(own.breakdown.reupload, 0);
  assert.equal(other.breakdown.reupload, W.reuploadEach);
});

// ── 길이 ─────────────────────────────────────────────────────

test("긴 쪽의 길이 감점이 짧은 쪽보다 약하다 (MV 인트로/아웃트로)", () => {
  const long = I.durationScore(250, 200); // MV
  const short = I.durationScore(150, 200); // 클립·TV size
  assert.equal(long.score, W.durFarLong);
  assert.equal(short.score, W.durFar);
  assert.ok(long.score > short.score, "긴 쪽을 덜 의심한다");
});

test("명백한 불일치는 여전히 실격 수준", () => {
  assert.equal(I.durationScore(3600, 200).score, W.durGross);
});

// ── 확신도 ───────────────────────────────────────────────────

test("버전·재배포가 걸린 후보에는 high를 주지 않는다", () => {
  const version = rankCandidates([cand({ title: "곡 (English ver.)", channel: "아티스트" })], target);
  assert.notEqual(version.confidence, "high");

  const reup = rankCandidates([cand({ title: "곡 [Lyrics]" })], target);
  assert.notEqual(reup.confidence, "high");

  const clean = rankCandidates([cand({ channel: "아티스트" })], target);
  assert.equal(clean.confidence, "high");
});
