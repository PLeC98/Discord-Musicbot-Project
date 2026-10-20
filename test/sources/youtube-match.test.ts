// src/sources/youtube/match.ts — 후보 채점의 순수 로직 계약.
//
// 유튜브 검색 결과로 실제 선택을 검증하는 회귀 코퍼스는 여기 두지 않는다.
// 그건 외부 서비스의 현재 순위를 얼린 데이터라 CI가 매번 확인할 성질이 아니다
// (로컬에서 따로 잰다).
//
// 여기 남은 것은 네트워크도 외부 데이터도 타지 않는, 코드 자체의 계약이다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rankCandidates, scoreCandidate, W, _internal as I } from "../../src/sources/youtube/match.ts";

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
const cand = (over: Record<string, unknown>) => ({ id: "x", url: "u", title: "곡", channel: "남의채널", durationSec: 200, rank: 0, ...over });

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

test("아티스트 쪼개기: feat · ft · with 는 단어일 때만 나눈다", () => {
  assert.deepEqual(I.splitArtists("Daft Punk"), ["daft punk"]);
  assert.deepEqual(I.splitArtists("Drift"), ["drift"]);
  assert.deepEqual(I.splitArtists("Within Temptation"), ["within temptation"]);
  assert.deepEqual(I.splitArtists("Taylor Swift"), ["taylor swift"]);
  assert.deepEqual(I.splitArtists("YOASOBI feat. Ayase"), ["yoasobi", "ayase"]);
  assert.deepEqual(I.splitArtists("Artist ft Other with Third"), ["artist", "other", "third"]);
  assert.deepEqual(I.splitArtists("Madeon & Porter Robinson"), ["madeon", "porter robinson"]);
});

test("버전 표기: 붙여 쓴 TVサイズ 를 떼고, 닫는 표시 없이 끝나는 - TV Size 도 알아본다", () => {
  assert.equal(I.stripVersionTag("紅蓮華 TVサイズ"), "紅蓮華");
  assert.equal(I.detectVersionKind("Idol - TV Size"), "tv");
  assert.equal(I.stripVersionTag("Idol - TV Size"), "Idol");
  assert.equal(I.detectVersionKind("Song - Short Ver"), "short");
  assert.equal(I.detectVersionKind("Video Killed the Radio Star on TV"), null, "끝의 TV 만으로는 버전이 아니다");
});

// 회귀 대상: 공백 뒤의 맨 단어도 받아 "Love on TV - Live" 를 TV 버전으로 봤다
test("버전 표기: 공백 뒤의 단어은 수식어가 붙어야 버전이다. 괄호 · 대시로 연 표시는 단어만으로도", () => {
  assert.equal(I.detectVersionKind("Love on TV - Live"), null);
  assert.equal(I.detectVersionKind("Life is Short - Live"), null);
  assert.equal(I.detectVersionKind("Idol TV size - Anime"), "tv");
  assert.equal(I.detectVersionKind("Idol (TV)"), "tv");
  assert.equal(I.detectVersionKind("Idol【TV】"), "tv");
  assert.equal(I.detectVersionKind("Song - Short -"), "short");
});

// ── 아티스트 채널(아티스트만 검색해 알아본 채널) ─────────────────

const ZWNJ = "‌"; // 보이지 않는 문자뿐인 채널 이름(실제 사례)

test("길이 4초 안은 1초마다 덜 준다(같은 채널의 1초 차 · 3초 차를 가른다)", () => {
  assert.equal(I.durationScore(200, 200).score, W.durNear);
  assert.equal(I.durationScore(203, 200).score, W.durNear - 3 * W.durNearPerSec);
  assert.ok(I.durationScore(201, 200).score > I.durationScore(203, 200).score);
});

test("채널 추정: 아티스트 검색의 앞 6개에서 3개 넘게 · 절반 넘게 나온 채널. 이름이 없는 결과는 세지 않는다", () => {
  const ch = (...names: Array<string | null>) => names.map((channel) => ({ channel }));
  assert.equal(I.dominantChannel(ch("A", "B", "C", "D", "E", "F", "G", "G", "G", "G", "G", "G", "G")), null, "뒤쪽은 세지 않는다(전부 세면 G 가 절반을 넘는다)");
  assert.equal(I.dominantChannel(ch("A", "A", "A", "A", "B", "C")), "A");
  assert.equal(I.dominantChannel(ch("A", "A", "B")), null, "3개가 안 된다");
  assert.equal(I.dominantChannel(ch(ZWNJ, ZWNJ, ZWNJ, ZWNJ, "B")), ZWNJ);
  assert.equal(I.dominantChannel(ch(null, null, null, null, "B")), null);
});

test("아티스트 채널의 영상 중 이 곡일 수 있는 것: 그 채널이고 제목이 곡 제목을 품거나 글자가 없다", () => {
  const list = [
    { id: "1", channel: "A", title: "곡 (Official)" },
    { id: "2", channel: "A", title: "다른 노래" },
    { id: "3", channel: "A", title: ZWNJ },
    { id: "4", channel: "B", title: "곡" },
  ];
  assert.deepEqual(
    I.ownUploads(list, "A", target).map((c) => c.id),
    ["1", "3"],
  );
  assert.deepEqual(
    I.ownUploads(list, "A", { ...target, title: "......" }).map((c) => c.id),
    ["3"],
    "곡 제목에 글자가 없으면 글자 없는 영상만",
  );
});

test("알아본 채널은 이름 그대로 견준다: 보이지 않는 이름끼리는 맞고, 빈 이름 · 없는 이름은 맞지 않는다", () => {
  const known = { ...target, artist: "x0o0x_", artistChannels: [ZWNJ] };
  assert.equal(I.artistChannelOf(ZWNJ, known).match, true);
  assert.equal(I.artistChannelOf("", { ...known, artistChannels: [""] }).match, false);
  assert.equal(I.artistChannelOf(null, known).match, false);
  assert.equal(I.artistChannelOf("남의채널", known).match, false);
  assert.equal(I.artistChannelOf("x0o0x_", { ...known, artistChannels: [] }).match, true, "이름이 맞으면 알아본 채널과 상관없이");
});

test("아티스트 채널의 영상이 5 ~ 60초 길면 MV 인트로로 보고 길이를 '가까움'으로 친다. 남의 채널 · 짧은 쪽 · 60초 넘게는 아니다", () => {
  const own = { channel: "아티스트" };
  assert.equal(scoreCandidate(cand({ ...own, durationSec: 240 }), target).breakdown.duration, W.durClose);
  assert.equal(scoreCandidate(cand({ ...own, durationSec: 261 }), target).breakdown.duration, W.durFarLong);
  assert.equal(scoreCandidate(cand({ ...own, durationSec: 170 }), target).breakdown.duration, W.durLoose);
  assert.equal(scoreCandidate(cand({ durationSec: 240 }), target).breakdown.duration, W.durFarLong);
  assert.equal(scoreCandidate(cand({ channel: ZWNJ, durationSec: 240 }), { ...target, artistChannels: [ZWNJ] }).breakdown.duration, W.durClose, "알아본 채널도");
});

test("제목이 기호뿐인 곡은 아티스트 채널 후보끼리 순위를 같게 두어 길이로 가른다. 글자가 있는 곡은 순위 그대로", () => {
  const symbol = { title: "......", artist: "x0o0x_", durationSec: 147, artistChannels: [ZWNJ] };
  const near = cand({ id: "near", title: ZWNJ, channel: ZWNJ, durationSec: 149, rank: 3 });
  const far = cand({ id: "far", title: ZWNJ, channel: ZWNJ, durationSec: 134, rank: 0 });
  const stranger = cand({ id: "stranger", title: "......", channel: "남의채널", durationSec: 147, rank: 1 });
  assert.equal(rankCandidates([far, near, stranger], symbol).best?.id, "near");
  const worded = { ...symbol, title: "곡" };
  assert.equal(rankCandidates([far, { ...near, title: "곡" }], worded).ranked.find((r) => r.candidate.id === "near")?.rank, 3);
});
