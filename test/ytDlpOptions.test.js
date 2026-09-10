"use strict";

// src/YouTube.js getYtDlpOptions — 쿠키 미설정 환경의 옵션 구성 계약.
// 회귀 대상: 쿠키가 없으면 player_client=ios를 강제하던 폴백
// dotenv는 기설정 process.env를 덮지 않으므로 require 전에 세팅한 빈 값이 .env보다 우선.

process.env.COOKIES_FROM_BROWSER = "";
process.env.COOKIES_FILE = "";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const YouTube = require("../src/YouTube");

test("쿠키 미설정이어도 player_client를 강제하지 않음 (우분투 재생 불능 회귀)", () => {
  const opts = YouTube.getYtDlpOptions();
  assert.equal(opts.extractorArgs, undefined, "ios 강제 폴백 금지 — 기본 클라이언트 + bgutil POT에 맡김");
  assert.equal(opts.cookiesFromBrowser, undefined);
  assert.equal(opts.cookies, undefined);
});

test("기본 옵션 유지 + 추가 옵션 병합", () => {
  const opts = YouTube.getYtDlpOptions({ dumpSingleJson: true });
  assert.equal(opts.dumpSingleJson, true);
  assert.equal(opts.noWarnings, true);
  assert.match(opts.jsRuntimes, /^node:/, "JS 런타임은 자기 node 실행 파일 (deno 불필요)");
  assert.ok(Array.isArray(opts.addHeader));
});

test("호출자가 extractorArgs를 명시하면 그대로 존중 (병합 계약)", () => {
  const opts = YouTube.getYtDlpOptions({ extractorArgs: "youtube:player_client=web" });
  assert.equal(opts.extractorArgs, "youtube:player_client=web");
});

// ── bgutil 플러그인 탐지 ─────────────────────────────────────────────────────
// yt-dlp의 --plugin-dirs는 `<지정 경로>/<아무 이름>/yt_dlp_plugins` 를 찾는다.
// yt_dlp_plugins를 직접 담은 디렉터리를 넘기면 아무것도 못 찾고 **조용히** 넘어가므로,
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

test("bgutil이 설치돼 있으면 pluginDirs가 실제 탐지된 루트의 부모를 가리킨다", (t) => {
  const { BGUTIL_DIR, BGUTIL_AVAILABLE, BGUTIL_PLUGIN_ROOT } = YouTube._internals;
  if (!BGUTIL_AVAILABLE) return t.skip("bgutil 미설치 (gitignore 대상)");
  const opts = YouTube.getYtDlpOptions();
  assert.equal(opts.pluginDirs, BGUTIL_DIR);
  assert.ok(fs.existsSync(BGUTIL_PLUGIN_ROOT), "탐지된 yt_dlp_plugins가 실제로 존재해야 한다");
  assert.equal(path.basename(BGUTIL_PLUGIN_ROOT), "yt_dlp_plugins");
});
