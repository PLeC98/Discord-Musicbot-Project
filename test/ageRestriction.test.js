"use strict";

// 연령 제한 폴백: CacheManager 레지스트리 라운드트립 + YouTube.isAgeRestrictedError 판별.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const DB_PATH = path.join(os.tmpdir(), `musicbot-agerestrict-test-${process.pid}.db`);

let CacheManager;
let YouTube;

before(() => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  CacheManager = require("../src/CacheManager");
  CacheManager.initialize(DB_PATH);
  YouTube = require("../src/YouTube");
});

after(() => {
  if (CacheManager) CacheManager.close();
  try {
    fs.unlinkSync(DB_PATH);
  } catch {
    /* 무시 */
  }
});

test("CacheManager: 연령 제한 videoId 기록/조회 라운드트립", () => {
  assert.equal(CacheManager.isAgeRestricted("vidAge1"), false);
  CacheManager.markAgeRestricted("vidAge1");
  assert.equal(CacheManager.isAgeRestricted("vidAge1"), true);
  // 멱등 (중복 기록 무해)
  CacheManager.markAgeRestricted("vidAge1");
  assert.equal(CacheManager.isAgeRestricted("vidAge1"), true);
  assert.equal(CacheManager.isAgeRestricted("other"), false);
});

test("CacheManager: 빈/누락 videoId는 무시", () => {
  CacheManager.markAgeRestricted("");
  CacheManager.markAgeRestricted(null);
  assert.equal(CacheManager.isAgeRestricted(""), false);
  assert.equal(CacheManager.isAgeRestricted(null), false);
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
