"use strict";

// src/PlayerClients.js — 순서 유지와 "자주 헛발질하는 클라이언트" 제외 판정.
// 연속 실패가 아니라 슬라이딩 윈도우인 이유: 같은 클라이언트·같은 영상도 실행마다 결과가
// 갈려서(2026-09-11 실측) 성공이 섞이면 연속 카운터가 계속 리셋된다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PlayerClients, parseClients, KNOWN, NEEDS_POT } = require("../src/PlayerClients");

test("빈 설정이면 idle — 폴백 루프를 아예 돌지 않는다 (기존 동작 보존)", () => {
  const pc = new PlayerClients([]);
  assert.equal(pc.idle, true);
  assert.deepEqual(pc.list(), []);
});

test("지정한 순서를 그대로 지킨다", () => {
  const pc = new PlayerClients(["visionos", "web_embedded", "tv_embedded"]);
  assert.equal(pc.idle, false);
  assert.deepEqual(pc.list(), ["visionos", "web_embedded", "tv_embedded"]);
});

test("최근 N회 중 M회 실패하면 제외한다", () => {
  const pc = new PlayerClients(["a", "b"], { window: 5, fails: 3 });
  pc.order = ["visionos", "web_embedded"]; // 화이트리스트 밖 이름이라 직접 넣는다
  for (const ok of [false, true, false, true, false]) pc.record("visionos", ok);
  assert.deepEqual(pc.list(), ["web_embedded"], "5회 중 3회 실패 → 제외");
});

test("성공이 섞여도 창 안에서 기준을 넘으면 제외된다 (연속이 아니다)", () => {
  const pc = new PlayerClients(["visionos"], { window: 4, fails: 2 });
  pc.record("visionos", false);
  pc.record("visionos", true);
  pc.record("visionos", true);
  assert.deepEqual(pc.list(), ["visionos"], "아직 창이 안 찼다");
  pc.record("visionos", false);
  assert.deepEqual(pc.list(), [], "4회 중 2회 실패 → 제외");
});

test("창이 밀리면 오래된 실패는 잊는다", () => {
  const pc = new PlayerClients(["visionos"], { window: 3, fails: 3 });
  pc.record("visionos", false);
  pc.record("visionos", false);
  pc.record("visionos", true); // 창: ng,ng,ok
  pc.record("visionos", true); // 창: ng,ok,ok — 첫 실패가 밀려났다
  pc.record("visionos", true); // 창: ok,ok,ok
  assert.deepEqual(pc.list(), ["visionos"]);
});

test("전부 제외되면 빈 배열 — 호출부가 yt-dlp 기본값으로 떨어진다", () => {
  const pc = new PlayerClients(["visionos", "web_embedded"], { window: 2, fails: 2 });
  for (const c of ["visionos", "web_embedded"]) {
    pc.record(c, false);
    pc.record(c, false);
  }
  assert.deepEqual(pc.list(), []);
  assert.equal(pc.idle, false, "지정은 했으므로 idle이 아니다 — 전멸과 미설정은 다르다");
});

test("제외된 클라이언트는 더 기록하지 않는다", () => {
  const pc = new PlayerClients(["visionos"], { window: 2, fails: 2 });
  pc.record("visionos", false);
  pc.record("visionos", false);
  const before = JSON.stringify(pc.snapshot().history);
  pc.record("visionos", true);
  assert.equal(JSON.stringify(pc.snapshot().history), before);
});

// ── 이름 파싱 ────────────────────────────────────────────────────────────────

test("쉼표 목록을 파싱하고 공백·대소문자를 정리한다", () => {
  assert.deepEqual(parseClients(" VisionOS , web_embedded "), ["visionos", "web_embedded"]);
});

test("모르는 이름도 그대로 넘긴다 — 유효성은 yt-dlp가 판단한다", () => {
  // 아는 이름 목록을 우리가 들고 거르면 yt-dlp가 새로 추가한 클라이언트를 우리가 막게 된다.
  // 대신 기동 로그(YouTube.logAuthMode)와 yt-dlp 자신의 경고로 알린다.
  assert.deepEqual(parseClients("visionos,vision_os"), ["visionos", "vision_os"]);
});

test("중복은 한 번만", () => {
  assert.deepEqual(parseClients("visionos,visionos"), ["visionos"]);
});

test("빈 값은 빈 배열 — 미설정과 같다", () => {
  assert.deepEqual(parseClients(""), []);
  assert.deepEqual(parseClients(null), []);
});

test("안내용 목록끼리 어긋나지 않는다", () => {
  for (const c of NEEDS_POT) assert.ok(KNOWN.includes(c), `${c}가 KNOWN에 없다`);
  // KNOWN은 2026-09-11에 yt-dlp가 실제로 알아듣는 것만 담는다. 예전 목록에는 이 넷이
  // 들어 있었는데 전부 없는 이름이었고, yt-dlp가 조용히 기본값으로 떨어져 "된다"고 오인했다.
  for (const gone of ["android_music", "android_creator", "ios_music", "tv_embedded"]) {
    assert.ok(!KNOWN.includes(gone), `${gone}은 이 yt-dlp가 모르는 이름이다`);
  }
});
