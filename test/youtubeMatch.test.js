"use strict";

// src/youtubeMatch.js — 점수제 YouTube 동등물 선택 로직 (오프라인, 네트워크 없음).
// 후보 데이터는 실제 yt-dlp 검색에서 캡처한 것(2026-07-20, Azari - Shadow Shadow 등).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rankCandidates, buildSearchQueries, mergeCandidateLists, _internal } = require("../src/youtubeMatch");

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

test("짧은 채널명('a.')은 긴 아티스트명의 부분으로 우연 일치하지 않음", () => {
  assert.equal(_internal.analyzeChannel("a.", "Survive Said The Prophet").match, false);
  assert.equal(_internal.analyzeChannel("A", "Ado").match, false); // 'a'가 'ado'에 들어가도 매칭 금지
  // 정당한 부분일치(3자 이상)는 유지
  assert.equal(_internal.analyzeChannel("AKASAKI (19)", "AKASAKI").match, true);
  assert.equal(_internal.analyzeChannel("Ado", "Ado").match, true); // 정확 일치는 길이 무관
});

// ── 쿼리 구성 + 병합 ─────────────────────────────────────────

test("buildSearchQueries: 따옴표 없이 제목+아티스트(주) / 제목(보조)", () => {
  assert.deepEqual(buildSearchQueries({ title: "Bunny Girl", artist: "AKASAKI" }), { primary: ["Bunny Girl AKASAKI"], secondary: ["Bunny Girl"] });
  assert.deepEqual(buildSearchQueries({ title: "Song", artist: "" }), { primary: [], secondary: ["Song"] });
});

test("buildSearchQueries: TV 버전 태그면 tv size/tvサイズ 동의어 확장 추가", () => {
  const q = buildSearchQueries({ title: "残響散歌 -TV ver.-", artist: "Aimer" });
  assert.ok(q.primary.includes("残響散歌 Aimer tv size"), "베이스+아티스트+tv size");
  assert.ok(q.primary.includes("残響散歌 tv size"), "베이스+tv size");
  assert.ok(q.primary.includes("残響散歌 Aimer tvサイズ"), "베이스+아티스트+tvサイズ");
  assert.equal(q.primary[0], "残響散歌 -TV ver.- Aimer", "원 제목 쿼리도 유지");
});

test("detectVersionKind / stripVersionTag", () => {
  assert.equal(_internal.detectVersionKind("残響散歌 -TV ver.-"), "tv");
  assert.equal(_internal.detectVersionKind("MUKANJYO (TV size)"), "tv");
  assert.equal(_internal.detectVersionKind("紅蓮華 -Short ver.-"), "short");
  assert.equal(_internal.detectVersionKind("Normal Song"), null);
  assert.equal(_internal.detectVersionKind("TV Girl - Song"), null, "버전 문맥 아니면 감지 안 함");
  assert.equal(_internal.stripVersionTag("残響散歌 -TV ver.-"), "残響散歌");
  assert.equal(_internal.stripVersionTag("MUKANJYO (TV size)"), "MUKANJYO");
});

test("mergeCandidateLists: 주 쿼리 순위 우선, 보조 쿼리 후보는 오프셋만큼 뒤로", () => {
  const merged = mergeCandidateLists(
    [[{ id: "a" }, { id: "b" }, { id: "c" }]], // 주 쿼리
    [[{ id: "b" }, { id: "d" }]], // 보조 쿼리: d는 여기서만
  );
  const byId = Object.fromEntries(merged.map((m) => [m.id, m.rank]));
  assert.equal(byId.a, 0);
  assert.equal(byId.b, 1, "b는 주 쿼리 #1이 보조 쿼리 #0(+오프셋)보다 앞서므로 rank 1");
  assert.equal(byId.c, 2);
  assert.equal(byId.d, 9, "d는 보조 쿼리 전용 → #1 + 오프셋8 = 9");
});

test("mergeCandidateLists: 여러 주 쿼리는 뒤로 밀지 않고 최고 순위 채택", () => {
  const merged = mergeCandidateLists([
    [{ id: "x" }, { id: "y" }], // 주 쿼리1
    [{ id: "z" }, { id: "y" }], // 주 쿼리2(확장): y는 여기서도 #1, z는 #0
  ]);
  const byId = Object.fromEntries(merged.map((m) => [m.id, m.rank]));
  assert.equal(byId.z, 0, "확장 쿼리 후보도 뒤로 밀리지 않음");
  assert.equal(byId.y, 1, "y는 두 주 쿼리 모두 #1 → rank 1");
});

// ── 실측 캡처 회귀: 따옴표 쿼리가 못 넣던 정답을 병합 검색이 넣으면 올바로 선택하는가 ──
// (2026-07-20 캡처. 병합 후보에 rank를 부여한 형태로 재구성)

test("heiakim Remix: 공식 리믹스(채널 AKASAKI, 곡명에 remix라 정크 아님) 선택", () => {
  const target = { title: "Bunny Girl - heiakim Remix", artist: "AKASAKI, Heiakim", durationSec: 191 };
  const candidates = [
    { id: "f4Yg08QcSaE", rank: 0, title: "【AKASAKI】Bunny Girl - heiakim Remix (Lyric Video)", channel: "AKASAKI (19)", durationSec: 192 },
    { id: "RCltAg_iK0E", rank: 1, title: "【AKASAKI】Bunny Girl（Lyric Video）", channel: "AKASAKI (19)", durationSec: 217 }, // 원곡
    { id: "HTw-k_jPbJA", rank: 2, title: "Pavolia Reine & Iida Pochi - Bunny Girl Heiakim-Remix [AKASAKI]", channel: "Anonymous of Suomus", durationSec: 198 },
  ];
  const { best } = rankCandidates(candidates, target);
  assert.equal(best.id, "f4Yg08QcSaE", "리믹스를 찾을 땐 원곡이 아니라 리믹스를");
});

test("Chocolate Cream: 아티스트 채널(Laysha)의 자막 영상 선택 (MMD/직캠 아님)", () => {
  const target = { title: "Chocolate Cream (feat. Nassun)", artist: "Laysha, Nassun", durationSec: 188 };
  const candidates = [
    { id: "DGIRdBEdeBY", rank: 0, title: "Chocolate Cream (feat. Nassun) (Chocolate Cream (Feat. 낯선))", channel: "Laysha", durationSec: 189 },
    { id: "M6fwRL0Tpgw", rank: 1, title: "LAYSHA feat. NASSUN - Chocolate Cream [Han/Rom/En]", channel: "klyrical", durationSec: 188 },
    { id: "g0PqOuf2390", rank: 5, title: "LAYSHA - Chocolate Cream (feat NASSUN) / Wenjing Choreography", channel: "XY STUDIO", durationSec: 28 }, // 28초 짤
  ];
  const { best } = rankCandidates(candidates, target);
  assert.equal(best.id, "DGIRdBEdeBY");
});

test("커버 링크(ヒバナ by Araki): 본인 채널의 커버 영상은 정크 감점 억제 → 원곡 대신 커버 선택", () => {
  // 커버 곡의 스포티파이 링크 → 그 아티스트가 올린 커버 영상을 골라야 함 (원곡 X)
  const target = { title: "ヒバナ", artist: "Araki", durationSec: 204 };
  const candidates = [
    { id: "araki_cover", rank: 0, title: "ヒバナ　Covered by あらき", channel: "あらき-ARAKI Official", durationSec: 203 }, // 채널일치 + cover×2
    { id: "deco_original", rank: 0, title: "DECO*27 - ヒバナ feat. 初音ミク", channel: "DECO*27", durationSec: 203 }, // 원곡(다른 아티스트)
    { id: "ado_cover", rank: 1, title: "【Ado】ヒバナ 歌いました", channel: "Ado", durationSec: 206 }, // 제3자 커버
  ];
  const { ranked, best, confidence } = rankCandidates(candidates, target);
  assert.equal(best.id, "araki_cover", "본인 채널 커버가 원곡·제3자커버를 이겨야 함");
  assert.equal(confidence, "high");
  const araki = ranked.find((r) => r.candidate.id === "araki_cover");
  assert.equal(araki.breakdown.junk, 0, "채널 일치로 cover 정크 감점 억제");
  assert.ok(araki.flags.junkSuppressed, "억제 플래그 표시");
});

test("제3자 커버는 여전히 정크 감점 (채널 불일치)", () => {
  const target = { title: "Shadow Shadow", artist: "Azari", durationSec: 141 };
  const wills = { id: "w", title: "Shadow Shadow (English Cover)【Will Stetson】", channel: "Will Stetson", durationSec: 146 };
  const { ranked } = rankCandidates([wills], target);
  assert.ok(ranked[0].breakdown.junk < 0, "타 채널 커버는 감점 유지");
  assert.equal(ranked[0].flags.junkSuppressed, false);
});

test("シャルル/Kuroneko(96猫): 흔한 이름의 우연 채널일치보다 순위#0+길이정확이 우선", () => {
  // 우타이테 96猫(=Kuroneko)의 커버가 스포티파이에 "Kuroneko"로 등재. 채널은 96NEKO-CHANNEL(로마자 불일치),
  // 정답 제목엔 歌ってみた. 반면 무관한 클립/타 채널이 우연히 "kuroneko"로 명명돼 가짜 채널일치.
  const target = { title: "シャルル", artist: "Kuroneko", durationSec: 229 };
  const candidates = [
    { id: "j_wZxkqrYoE", rank: 0, title: "【96猫】シャルルを歌ってみた", channel: "【MAIN】96NEKO-CHANNEL", durationSec: 230 }, // 정답: 순위#0 + 길이정확
    { id: "A4oNim8Hu_8", rank: 1, title: "Nekomata Okayu - シャルル / balloon | HOLOLIVE", channel: "kuroneko", durationSec: 235 }, // 우연 채널일치(클립)
    { id: "8O-dx8NGLDg", rank: 2, title: "『シャルル』歌ってみた", channel: "KURONEKO", durationSec: 233 }, // 우연 채널일치(타 채널)
    { id: "TA5OFS_xX0c", rank: 8, title: "シャルル／flower", channel: "SudaKeina Balloon", durationSec: 229 }, // 원곡(보조 쿼리 전용, 뒤로 밀림)
  ];
  const { best } = rankCandidates(candidates, target);
  assert.equal(best.id, "j_wZxkqrYoE", "길이 정확(정크 면제) + #0가 우연 채널일치를 이겨야 함");
});

test("U.N.Owen: 채널명이 다른 스크립트여도 '- Topic' 공식 아트트랙 + 길이정확이면 선택", () => {
  // artist 上海アリス幻樂団 ↔ channel "Team Shanghai Alice - Topic" (이름 불일치, 로마자 vs 일본어)
  const target = { title: "U.N.Owen WA KANOJO NANOKA?", artist: "上海アリス幻樂団", durationSec: 270 };
  const candidates = [
    { id: "zPDQu-_KZBw", rank: 0, title: "U.N.オーエンは彼女なのか？", channel: "Team Shanghai Alice - Topic", durationSec: 271 },
    { id: "ssdcX1vVBTo", rank: 1, title: "東方原曲 紅魔郷 EXTRAボス U.N.オーエンは彼女なのか？", channel: "katukunazawa", durationSec: 250 },
    { id: "JnQoKy0V4NY", rank: 3, title: "U.N.オーエンは彼女なのか？", channel: "zun", durationSec: 288 },
  ];
  const { best, confidence } = rankCandidates(candidates, target);
  assert.equal(best.id, "zPDQu-_KZBw", "Topic 아트트랙 + 271s(정확)");
  assert.equal(confidence, "high");
});
