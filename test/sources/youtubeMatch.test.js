"use strict";

// src/youtubeMatch.js — 후보 채점의 순수 로직 계약.
//
// 유튜브 검색 결과로 실제 선택을 검증하는 회귀 코퍼스는 여기 두지 않는다.
// 그건 외부 서비스의 현재 순위를 얼린 데이터라 CI가 매번 확인할 성질이 아니다
// (로컬 전용: `node notes/match-corpus/check.js`).
//
// 여기 남은 것은 네트워크도 외부 데이터도 타지 않는, 코드 자체의 계약이다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rankCandidates, scoreCandidate, W, _internal: I } = require("../../src/sources/youtube/match");

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
