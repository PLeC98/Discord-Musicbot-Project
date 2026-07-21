"use strict";

// src/youtubeMatch.js — 점수제 YouTube 동등물 선택 로직 (오프라인, 네트워크 없음).
// 후보 데이터는 실제 yt-dlp 검색에서 캡처한 것(2026-07-20, Azari - Shadow Shadow 등).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rankCandidates, _internal } = require("../src/youtubeMatch");

// 실측 캡처: YouTube.search('"Shadow Shadow" "Azari"', 6)
const SHADOW_CANDIDATES = [
  { id: "2ZoIHGC-xZU", title: "​", channel: "Azari", durationSec: 141 }, // 본인 채널, 제목 비어있음(제로폭)
  { id: "AFcNm8upMYc", title: "Shadow Shadow (English Cover)【Will Stetson】「Azari」", channel: "Will Stetson", durationSec: 146 },
  { id: "f8TOY2PLfaE", title: "ㅤ", channel: "LOLUET", durationSec: 147 },
  { id: "hT4rmRfzSuA", title: "Shadow Shadow / Ver.Chogakusei", channel: "Chogakusei Official", durationSec: 146 },
  { id: "bMG7oL0gc24", title: "Shadow Shadow / Azari (cover) - 橘 優", channel: "橘優", durationSec: 141 },
];
const SHADOW_TARGET = { title: "Shadow Shadow", artist: "Azari", durationSec: 141 };

// 실측 캡처: YouTube.search("Shadow Shadow", 6) — 브로드 쿼리, 프로세카 MV가 2위
const SHADOW_BROAD = [
  { id: "2ZoIHGC-xZU", title: "​", channel: "Azari", durationSec: 141 },
  { id: "0wlO4fkF3VU", title: "Shadow Shadow / 25時、ナイトコードで。 × 鏡音レン【3DMV】", channel: "プロジェクトセカイ カラフルステージ! feat. 初音ミク", durationSec: 130 },
  { id: "zM2xBtnv7XM", title: "[FULL VER] Shadow Shadow — 25時、ナイトコードで。【プロセカ Color Coded】", channel: "Yan☆", durationSec: 142 },
  { id: "oOUw68yWKO8", title: "『 Shadow Shadow 』 歌ってみた ／ Dear:", channel: "Dear:", durationSec: 142 },
  { id: "r00px-X3QGY", title: "Shadow Shadow (English Cover) 【JubyPhonic】", channel: "JubyPhonic", durationSec: 141 },
];

test("Shadow Shadow (정밀 쿼리): 제목이 비어도 채널일치로 Azari 본인 영상 선택", () => {
  const { best, confidence } = rankCandidates(SHADOW_CANDIDATES, SHADOW_TARGET);
  assert.equal(best.id, "2ZoIHGC-xZU", "구 로직은 Will Stetson 커버를 골랐음");
  assert.equal(confidence, "high", "채널일치 + 정크없음 → 높은 신뢰도");
});

test("Shadow Shadow (브로드 쿼리): 프로세카 공식 MV 대신 Azari 본인 영상 선택", () => {
  const { best, ranked } = rankCandidates(SHADOW_BROAD, SHADOW_TARGET);
  assert.equal(best.id, "2ZoIHGC-xZU", "구 로직은 프로세카 MV(제목에 곡명 포함)를 골랐음");
  // 프로세카 MV는 채널 불일치 → Azari보다 낮은 점수
  const azari = ranked.find((r) => r.candidate.id === "2ZoIHGC-xZU");
  const proseka = ranked.find((r) => r.candidate.id === "0wlO4fkF3VU");
  assert.ok(azari.score > proseka.score);
});

test("커버는 정크 감점으로 침몰 (English Cover / 歌ってみた)", () => {
  const { ranked } = rankCandidates(SHADOW_BROAD, SHADOW_TARGET);
  const juby = ranked.find((r) => r.candidate.id === "r00px-X3QGY"); // English Cover
  const dear = ranked.find((r) => r.candidate.id === "oOUw68yWKO8"); // 歌ってみた
  assert.ok(juby.flags.junk >= 1, "English Cover는 정크로 인식");
  assert.ok(dear.flags.junk >= 1, "歌ってみた는 정크로 인식");
});

// ── 채널명이 아티스트명과 다른 경우들 (사용자 우려 지점) ──────────────────

test("채널일치가 없어도: 순위+길이+정크로 판정, 약한 제목매칭이 1위를 뒤집지 못함", () => {
  const target = { title: "Some Song", artist: "Obscure Artist", durationSec: 200 };
  const candidates = [
    { id: "correct", title: "Some Song", channel: "Random Label Uploads", durationSec: 200 }, // 채널 불일치지만 유튜브 1위 + 길이 정확
    { id: "cover", title: "Some Song (Piano Cover)", channel: "PianoGuy", durationSec: 205 }, // 커버
    { id: "wrongdur", title: "Some Song Some Song", channel: "Whatever", durationSec: 200 },
  ];
  const { best } = rankCandidates(candidates, target);
  assert.equal(best.id, "correct", "유튜브 1위 + 길이 정확이 우세");
});

test("길이 그로스 불일치(1시간 루프)는 채널일치가 있어도 실격", () => {
  const target = { title: "My Song", artist: "MyBand", durationSec: 180 };
  const candidates = [
    { id: "loop", title: "My Song (1 Hour Loop)", channel: "MyBand", durationSec: 3600 }, // 본인 채널이지만 1시간
    { id: "real", title: "My Song", channel: "MyBand - Topic", durationSec: 182 }, // Topic 아트트랙
  ];
  const { best } = rankCandidates(candidates, target);
  assert.equal(best.id, "real", "1시간 루프는 길이 그로스로 탈락, Topic 아트트랙 선택");
});

test("VEVO/Topic 공식 계열 인식", () => {
  assert.equal(_internal.analyzeChannel("TaylorSwiftVEVO", "Taylor Swift").match, true);
  assert.equal(_internal.analyzeChannel("TaylorSwiftVEVO", "Taylor Swift").isVevo, true);
  assert.equal(_internal.analyzeChannel("Kenshi Yonezu - Topic", "Kenshi Yonezu").isTopic, true);
  assert.equal(_internal.analyzeChannel("아이유 official", "아이유").match, true);
  // 불일치
  assert.equal(_internal.analyzeChannel("Some Cover Channel", "Azari").match, false);
});

test("곡 제목 자체에 'remix'가 있으면 정크로 감점하지 않음", () => {
  assert.equal(_internal.countJunk("Song Title (Remix)", "Song Title (Remix)"), 0);
  assert.equal(_internal.countJunk("Song Title (Remix)", "Song Title"), 1);
});

test("다중 아티스트: 채널이 그중 하나와만 일치해도 인정", () => {
  const r = _internal.analyzeChannel("Bruno Mars", "Mark Ronson, Bruno Mars");
  assert.equal(r.match, true);
});
