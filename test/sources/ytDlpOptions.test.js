"use strict";

// src/sources/youtube/index.js getYtDlpOptions — 쿠키 미설정 환경의 옵션 구성 계약.
// 회귀 대상: 쿠키가 없으면 player_client=ios를 강제하던 폴백
// dotenv는 기설정 process.env를 덮지 않으므로 require 전에 세팅한 빈 값이 .env보다 우선.

process.env.COOKIES_SOURCE = "";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const YouTube = require("../../src/sources/youtube/index");

test("쿠키 미설정이어도 player_client를 강제하지 않음 (우분투 재생 불능 회귀)", () => {
  const opts = YouTube.getYtDlpOptions();
  assert.equal(opts.extractorArgs, undefined, "ios 강제 폴백 금지 — 기본 클라이언트 + bgutil POT에 맡김");
  assert.equal(opts.cookiesFromBrowser, undefined);
  assert.equal(opts.cookies, undefined);
});

test("기본 옵션 유지 + 추가 옵션 병합", () => {
  const opts = YouTube.getYtDlpOptions({ dumpSingleJson: true });
  assert.equal(opts.dumpSingleJson, true);
  // noWarnings는 켜지 않는다 — yt-dlp 경고에 "이 클라이언트는 POToken이 필요하다"가 섞여 온다
  assert.equal(opts.noWarnings, undefined);
  assert.match(opts.jsRuntimes, /^node:/, "JS 런타임은 자기 node 실행 파일 (deno 불필요)");
  // User-Agent를 덮지 않는다. yt-dlp가 클라이언트마다 고른 값이 http_headers로 실려 와
  // 재생 요청 헤더가 되므로, 우리가 끼어들면 낡은 단일 값으로 뭉개진다.
  assert.equal(opts.addHeader, undefined);
});

test("호출자가 extractorArgs를 명시하면 그대로 존중 (병합 계약)", () => {
  const opts = YouTube.getYtDlpOptions({ extractorArgs: "youtube:player_client=web" });
  assert.equal(opts.extractorArgs, "youtube:player_client=web");
});

// ── bgutil 플러그인 탐지 ─────────────────────────────────────────────────────
// yt-dlp의 --plugin-dirs는 `<지정 경로>/<아무 이름>/yt_dlp_plugins` 를 찾는다.
// yt_dlp_plugins를 직접 담은 디렉터리를 넘기면 아무것도 못 찾고 조용히 넘어가므로,
// 규칙 자체를 테스트로 박아 둔다 (2026-09-10: 도입 후 3개월간 이 상태였다).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function fixture(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugroot-"));
  fs.mkdirSync(path.join(root, layout), { recursive: true });
  return root;
}

test("플러그인 루트는 하위 디렉터리 안의 yt_dlp_plugins를 찾는다", () => {
  const { findPluginRoot } = YouTube._internals;
  const root = fixture(path.join("plugin", "yt_dlp_plugins", "extractor"));
  assert.equal(findPluginRoot(root), path.join(root, "plugin", "yt_dlp_plugins"));
});

test("yt_dlp_plugins를 직접 담은 디렉터리는 루트가 아니다 (POToken 미로딩 회귀)", () => {
  const { findPluginRoot } = YouTube._internals;
  const root = fixture(path.join("plugin", "yt_dlp_plugins", "extractor"));
  assert.equal(findPluginRoot(path.join(root, "plugin")), null, "한 단계 안쪽을 넘기면 yt-dlp가 못 찾는다");
});

test("설치되지 않은 경로는 조용히 null", () => {
  const { findPluginRoot } = YouTube._internals;
  assert.equal(findPluginRoot(path.join(os.tmpdir(), "존재하지-않는-경로-plugroot")), null);
});

test("bgutil 탐지 경로는 yt-dlp가 실제로 읽는 곳을 가리킨다", (t) => {
  const { BGUTIL_AVAILABLE, BGUTIL_PLUGIN_ROOT } = YouTube._internals;
  if (!BGUTIL_AVAILABLE) return t.skip("bgutil 미설치 (gitignore 대상)");
  assert.ok(fs.existsSync(BGUTIL_PLUGIN_ROOT), "탐지된 yt_dlp_plugins가 실제로 존재해야 한다");
  assert.equal(path.basename(BGUTIL_PLUGIN_ROOT), "yt_dlp_plugins");
});

// 스위치 값을 주변 환경에서 읽어 오면 안 된다. 개발자의 .env가 BGUTIL_ENABLED=true면
// "끄면 안 넘긴다"가 확인되지 않은 채 실패로만 떴다. 두 방향을 직접 세워서 본다.
// potEnabled()는 부를 때마다 config를 보므로 값을 갈아 끼우면 그대로 듣는다.
test("BGUTIL_ENABLED가 pluginDirs 전달을 가른다", (t) => {
  const { BGUTIL_AVAILABLE } = YouTube._internals;
  const config = require("../../config");
  const restore = config.bgutil.enabled;
  t.after(() => {
    config.bgutil.enabled = restore;
  });

  // 끄기로 했으면 설치 여부와 무관하게 안 쓴다
  config.bgutil.enabled = false;
  assert.equal(YouTube.potEnabled(), false);
  assert.equal(YouTube.getYtDlpOptions().pluginDirs, undefined);

  // 켜고 설치돼 있을 때만 넘어간다. 미설치 환경에서는 켜도 안 넘어가는 것이 맞다
  config.bgutil.enabled = true;
  assert.equal(YouTube.potEnabled(), BGUTIL_AVAILABLE);
  assert.equal(YouTube.getYtDlpOptions().pluginDirs === undefined, !BGUTIL_AVAILABLE);
});

// ── 실패 분류 ────────────────────────────────────────────────────────────────
// 클라이언트를 바꿔서 나아질 실패와, 바꿔봐야 소용없는 실패를 가른다.
// 잘못 가르면 멀쩡한 클라이언트가 제외되거나(영상 문제를 클라 탓으로), 헛돈다.

const clientFaults = ["ERROR: [youtube] abc: Requested format is not available. Use --list-formats", "WARNING: Only images are available for download", "mweb client https formats require a GVS PO Token which was not provided", "ERROR: [youtube] abc: No video formats found!"];

const notClientFaults = ["ERROR: [youtube] abc: Video unavailable", "ERROR: [youtube] abc: Private video. Sign in if you've been granted access", "ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users", "ERROR: unable to download video data: <urlopen error timed out>", "ERROR: [youtube] abc: This video is not available"];

test("클라이언트를 바꿔볼 만한 실패를 알아본다", () => {
  for (const msg of clientFaults) {
    assert.equal(YouTube.isClientFault(new Error(msg)), true, msg.slice(0, 50));
  }
});

test("영상 문제·네트워크는 클라이언트 탓이 아니다", () => {
  for (const msg of notClientFaults) {
    assert.equal(YouTube.isClientFault(new Error(msg)), false, msg.slice(0, 50));
  }
});

test("연령 제한은 포맷 오류 문구가 섞여 있어도 클라이언트 탓이 아니다", () => {
  const e = new Error("Sign in to confirm your age. Requested format is not available");
  assert.equal(YouTube.isClientFault(e), false, "영상 문제 판정이 먼저다");
});

// ── 대시보드 계약 ────────────────────────────────────────────────────────────

test("statusSnapshot은 대시보드가 기대하는 모양을 낸다", () => {
  const s = YouTube.statusSnapshot();
  assert.deepEqual(Object.keys(s).sort(), ["clients", "configured", "cookies", "pot"]);
  assert.ok(["on", "off", "missing"].includes(s.pot));
  assert.ok(["browser", "file", "none"].includes(s.cookies));
  assert.equal(typeof s.configured, "boolean");
  assert.ok(Array.isArray(s.clients));
  assert.equal(s.configured, s.clients.length > 0);
});

test("statusSnapshot은 쿠키 파일 경로를 노출하지 않는다 — 종류만 알린다", () => {
  // 대시보드는 운영자 전용이지만, 파일 경로는 알려야 할 이유가 없다.
  const raw = JSON.stringify(YouTube.statusSnapshot());
  const cookiePath = require("../../src/config/loader").cookiesPath();
  assert.ok(!raw.includes(cookiePath), "쿠키 파일 경로가 응답에 실리면 안 된다");
});

// ── 미디어 주소가 어긋난 실패 ─────────────────────────────────────────────

// 회귀 대상: 자동재생이 고른 곡이 `HTTP Error 403: Forbidden`으로 실패했는데, 같은 영상을
// 몇 분 뒤 직접 틀면 멀쩡히 재생됐다. 영상 문제가 아니라 서명된 미디어 주소의 문제라
// 다시 받으면 풀린다. 그런데 이 오류가 어디에도 걸리지 않아 한 번에 실패로 끝났다.
test("내려받다 막힌 것과 영상이 없어진 것을 가른다", () => {
  const YouTube = require("../../src/sources/youtube/index");
  const err = (msg) => ({ stderr: msg });

  for (const msg of ["ERROR: unable to download video data: HTTP Error 403: Forbidden", "ERROR: unable to download video data: HTTP Error 429: Too Many Requests", "ERROR: fragment 1 not found, unable to continue", "ERROR: unable to download fragment 3"]) {
    assert.equal(YouTube.isStaleMediaError(err(msg)), true, msg);
    assert.equal(YouTube.isClientFault(err(msg)), true, `${msg} — 클라이언트 목록이 있으면 다음으로 넘어가야 한다`);
  }

  // 영상이 없어진 것은 다시 받아도 소용없다 — 다른 길로 가야 한다
  for (const msg of ["ERROR: [youtube] abc: Video unavailable", "ERROR: This video has been removed by the uploader"]) {
    assert.equal(YouTube.isStaleMediaError(err(msg)), false, msg);
    assert.equal(YouTube.isVideoUnavailableError(err(msg)), true, msg);
  }

  // 연령 제한도 아니다 — 쿠키 폴백이 따로 있다
  assert.equal(YouTube.isStaleMediaError(err("ERROR: Sign in to confirm your age")), false);

  // 네트워크 타임아웃은 같은 "unable to download video data" 문구로 오지만 다른 일이다 —
  // 유튜브가 거절한 게 아니라 우리가 못 닿은 것이라, 주소를 다시 받아도 소용이 없다.
  assert.equal(YouTube.isStaleMediaError(err("ERROR: unable to download video data: <urlopen error timed out>")), false);
});
