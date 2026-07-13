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
