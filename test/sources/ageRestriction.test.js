// 연령 제한 폴백: CacheManager 레지스트리 라운드트립 + YouTube.isAgeRestrictedError 판별.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { createRequire } from "node:module";

// 함수 안에서 부르는 것과 글자가 아닌 경로는 그대로 require 로
const require = createRequire(import.meta.url);

const DB_PATH = path.join(os.tmpdir(), `musicbot-agerestrict-test-${process.pid}.db`);

let audioCache, externalCaches;
let YouTube;

before(() => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  audioCache = require("../../src/store/audioCache");
  externalCaches = require("../../src/store/externalCaches");
  audioCache.initialize(DB_PATH);
  YouTube = require("../../src/sources/youtube/index");
});

after(() => {
  if (audioCache) audioCache.close();
  try {
    fs.unlinkSync(DB_PATH);
  } catch {
    /* 무시 */
  }
});

test("CacheManager: 연령 제한 videoId 기록/조회 라운드트립", () => {
  assert.equal(externalCaches.isAgeRestricted("vidAge1"), false);
  externalCaches.markAgeRestricted("vidAge1");
  assert.equal(externalCaches.isAgeRestricted("vidAge1"), true);
  // 멱등 (중복 기록 무해)
  externalCaches.markAgeRestricted("vidAge1");
  assert.equal(externalCaches.isAgeRestricted("vidAge1"), true);
  assert.equal(externalCaches.isAgeRestricted("other"), false);
});

test("CacheManager: 빈/누락 videoId는 무시", () => {
  externalCaches.markAgeRestricted("");
  externalCaches.markAgeRestricted(null);
  assert.equal(externalCaches.isAgeRestricted(""), false);
  assert.equal(externalCaches.isAgeRestricted(null), false);
});

test("YouTube.isAgeRestrictedError: 연령 게이트 메시지 감지", () => {
  assert.equal(YouTube.isAgeRestrictedError({ stderr: "ERROR: [youtube] X: Sign in to confirm your age." }), true);
  assert.equal(YouTube.isAgeRestrictedError({ message: "This video may be inappropriate for some users." }), true);
  assert.equal(YouTube.isAgeRestrictedError(new Error("Sign in to confirm your age")), true);
});

test("YouTube.isAgeRestrictedError: 무관한 오류는 false", () => {
  assert.equal(YouTube.isAgeRestrictedError(new Error("Requested format is not available")), false);
  assert.equal(YouTube.isAgeRestrictedError({ stderr: "HTTP Error 403" }), false);
  assert.equal(YouTube.isAgeRestrictedError(null), false);
});
