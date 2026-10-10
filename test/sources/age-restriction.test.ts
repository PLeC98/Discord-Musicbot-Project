// 연령 제한 폴백: externalCaches 레지스트리 라운드트립 + YouTube.isAgeRestrictedError 판별.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import * as audioCache from "../../src/store/audio-cache.ts";
import * as stores from "../../src/store/stores.ts";
import * as externalCaches from "../../src/store/external-caches.ts";
import * as YouTube from "../../src/sources/youtube/index.ts";

const DB_DIR = path.join(os.tmpdir(), `musicbot-agerestrict-test-${process.pid}`);

before(() => {
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  stores.open(DB_DIR);
  audioCache.initialize();
});

after(() => {
  if (audioCache) audioCache.close();
  stores.close();
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 5 });
});

test("externalCaches: 연령 제한 videoId 기록/조회 라운드트립", () => {
  assert.equal(externalCaches.isAgeRestricted("vidAge1"), false);
  externalCaches.markAgeRestricted("vidAge1");
  assert.equal(externalCaches.isAgeRestricted("vidAge1"), true);
  // 멱등 (중복 기록 무해)
  externalCaches.markAgeRestricted("vidAge1");
  assert.equal(externalCaches.isAgeRestricted("vidAge1"), true);
  assert.equal(externalCaches.isAgeRestricted("other"), false);
});

test("externalCaches: 빈/누락 videoId는 무시", () => {
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
