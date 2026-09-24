// src/autoplayFilter — 자동재생 후보를 걸러내는 규칙.
//
// 문턱은 짐작이 아니라 후보 840개를 세어 정했다(notes/research-autoplay-quality.md).
// 그래서 여기 적는 것은 "왜 이 값인가"가 아니라 "이 성질이 깨지면 안 된다"이다.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as filter from "../../src/autoplay/filter.ts";

const limits = (over = {}) => filter.prepare({ minDurationSec: 60, maxDurationSec: 3600, blockedKeywords: ["mix", "playlist", "메들리"], ...over });
const judge = (title: string, duration = 240, over?: filter.FilterConfig) => filter.judge({ title, duration }, limits(over));

// ── 길이 ──────────────────────────────────────────────────────────────────

test("길이를 모르면 떨어진다 — 대개 라이브다", () => {
  assert.equal(filter.judge({ title: "노래", duration: null }, limits()).reason, "길이 없음");
});

test("길이 범위 밖은 떨어진다", () => {
  assert.equal(judge("노래", 30).reason, "너무 짧음");
  assert.equal(judge("노래", 7200).reason, "너무 긺");
  assert.equal(judge("노래", 240).ok, true);
});

// ── 차단어 ────────────────────────────────────────────────────────────────

// 회귀 대상: 판정이 단순 포함이라 "mix"가 "remix"를 죽였다. 리믹스는 멀쩡한 곡이고 흔하다.
// 설정에 " mix"처럼 공백을 넣어 두는 것으로는 못 고친다 — 대시보드가 앞뒤 공백을 뗀다.
test("차단어는 낱말 경계로 견준다 — mix가 remix를 죽이지 않는다", () => {
  assert.equal(judge("BTS - MIC Drop (Steve Aoki Remix) Official MV").ok, true);
  assert.equal(judge("Clarity (BUNT. Remix)").ok, true);

  assert.equal(judge("Best Rock Songs - Video Mix").detail, "mix", "진짜 믹스는 여전히 잡는다");
  assert.equal(judge("coffee & beats jazzy japan lofi mix").detail, "mix");
});

test("한국어·일본어 차단어는 낱말 경계 없이 본다", () => {
  // \b는 한글 앞뒤에서 뜻대로 동작하지 않는다 — 그때는 그냥 포함 여부를 본다
  assert.equal(judge("봄노래 메들리 모음").detail, "메들리");
  assert.equal(judge("2026 春アニメ メドレー", 240, { blockedKeywords: ["メドレー"] }).detail, "メドレー");
});

test("차단어는 대소문자를 가리지 않는다", () => {
  assert.equal(judge("Best Playlist Ever").detail, "playlist");
});

test("차단어는 곡 표식이 있어도 면제하지 않는다 — 공식 믹스도 믹스다", () => {
  assert.equal(judge("Official Summer Mix (Official Video)").detail, "mix");
});

// ── 믹스 생김새 ───────────────────────────────────────────────────────────

test("여러 곡을 이어 붙인 생김새는 떨어진다", () => {
  // 쉼표로 아티스트를 나열한 것은 컴필레이션이다(실측: 한 곡일 확률 7%)
  assert.equal(judge("Pop Hits 2021 - Ariana Grande, Maroon 5, Taylor Swift, Adele").reason, "믹스 생김새");
  // 연도가 둘이면 "몇 년도부터 몇 년도까지 모음"이다(0%)
  assert.equal(judge("Classic Rock 1980 1990 Greatest").reason, "믹스 생김새");
  // 이모지 둘이면 이미 15%다 — 옛 문턱(넷)은 너무 느슨했다
  assert.equal(judge("여름 노래 🌊🔥").reason, "믹스 생김새");
  assert.equal(judge("3 Hours of Piano").reason, "믹스 생김새");
});

test("곡 표식이 있으면 생김새 규칙을 면제한다", () => {
  // 공식 뮤직비디오 제목에는 이모지도 괄호도 흔하다(official·MV·feat.은 한 곡일 확률 97~100%)
  assert.equal(judge("아이돌 '노래' 🌊🔥 (Official Music Video)").ok, true);
  assert.equal(judge("Artist - Song 🎉🎊 M/V").ok, true);
  assert.equal(judge("A, B, C, D - Song (feat. E)").ok, true);
});

test("표식이 없는 평범한 제목은 그대로 지난다", () => {
  assert.equal(judge("Nirvana - Smells Like Teen Spirit").ok, true);
  assert.equal(judge("Take Five").ok, true);
});

// ── 설정 ──────────────────────────────────────────────────────────────────

test("상한을 비우면 길이 제한이 없다", () => {
  assert.equal(filter.judge({ title: "교향곡", duration: 9999 }, filter.prepare({ minDurationSec: 60 })).ok, true);
});

test("빈 차단어는 무시한다 — 설정에 빈 줄이 남아도 전부를 막으면 안 된다", () => {
  assert.equal(judge("아무 노래", 240, { blockedKeywords: ["", "  ", "mix"] }).ok, true);
});
