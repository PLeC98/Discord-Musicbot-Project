// src/store/audioCache.ts — 캐시 초기화와 재생 중인 곡.
//
// 회귀 대상: 초기화가 DB를 먼저 통째로 비우고 파일을 지웠다. 재생 중인 파일은 잠겨서 남는데
// 행은 사라지므로, 다음 재생이 "이미 캐시됨"으로 판단해 다운로더(=audio_cache 행을 만드는 곳)를
// 건너뛰고, 그 뒤의 recordTrackLookup이 부모 없는 자식을 넣으려다 FOREIGN KEY로 터졌다.
// 재생은 방금 시작한 소리가 catch에서 멈춰 "봇이 고장난" 것처럼 보였다. 장부는 이제 외래 키가 없지만,
// 파일이 남은 곡의 행을 남기는 것은 그대로 지킨다.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { createRequire } from "node:module";

// 함수 안에서 부르는 것과 글자가 아닌 경로는 그대로 require 로
const require = createRequire(import.meta.url);

const DB_PATH = path.join(os.tmpdir(), `musicbot-cachereset-test-${process.pid}.db`);
const CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-cachereset-"));

let audioCache, trackLookup;

before(() => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  audioCache = require("../../src/store/audioCache.ts");
  trackLookup = require("../../src/store/trackLookup.ts");
  audioCache._cacheDir = CACHE_DIR; // 실 캐시 폴더를 건드리지 않는다
  audioCache.initialize(DB_PATH);
});

after(() => {
  audioCache.close();
  try {
    fs.unlinkSync(DB_PATH);
  } catch {}
  fs.rmSync(CACHE_DIR, { recursive: true, force: true, maxRetries: 5 });
});

// 캐시된 곡 하나를 만든다 — 행 + 파일.
function seedTrack(key, title) {
  const track = { title, artist: "가수", duration: 100, requestKey: `https://y/${title}`, pageUrl: `https://y/${title}`, audioUrl: `https://www.youtube.com/watch?v=${key.slice(3)}`, platform: "youtube" };
  const file = audioCache.getFilePath(key);
  fs.writeFileSync(file, "오디오");
  audioCache.recordDownloadStart(key, track);
  audioCache.recordDownloadComplete(key, file, fs.statSync(file).size, track, { durationSec: 100 });
  trackLookup.recordTrackLookup(track);
  return { track, file };
}

test("초기화: 지우지 못한 파일(재생 중)의 행은 남고, 나머지는 사라진다", () => {
  const playing = seedTrack("yt:playing", "재생중인곡");
  const idle = seedTrack("yt:idle", "그냥캐시된곡");

  // 재생 중이라 잠긴 파일을 흉내 낸다 — Windows에서 실제로 unlink가 던지는 자리다.
  const realUnlink = fs.unlinkSync;
  fs.unlinkSync = (target) => {
    if (path.resolve(target) === path.resolve(playing.file)) throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    return realUnlink(target);
  };

  let result;
  try {
    result = audioCache.resetCache();
  } finally {
    fs.unlinkSync = realUnlink;
  }

  assert.equal(result.kept, 1, "잠긴 파일 하나를 남겨 뒀다고 보고한다");
  assert.ok(fs.existsSync(playing.file), "잠긴 파일은 그대로");
  assert.equal(fs.existsSync(idle.file), false, "나머지 파일은 지워진다");

  const rows = audioCache.db.prepare("SELECT audio_key FROM audio_cache").all();
  assert.deepEqual(
    rows.map((r) => r.audio_key),
    ["yt:playing"],
    "파일이 남은 곡의 행만 살아남는다",
  );
  assert.equal(audioCache._protectedKeys.has("yt:playing"), true, "살아남은 키는 다시 보호한다");
  assert.equal(audioCache.db.prepare("SELECT COUNT(*) AS n FROM track_lookup").get().n, 0, "링크 장부는 파일과 따로 살므로 통째로 비운다");
});

test("초기화 뒤에도 재생 중인 곡의 장부 기록이 터지지 않는다 (회귀)", () => {
  // 위 테스트가 남긴 상태 그대로 — 재생 경로가 곡을 계속 틀며 기록을 남기는 순간이다.
  assert.doesNotThrow(() => {
    audioCache.recordPlayback("yt:playing");
    trackLookup.recordTrackLookup({ requestKey: "https://y/재생중인곡", pageUrl: "https://y/재생중인곡", audioUrl: "https://www.youtube.com/watch?v=playing", platform: "youtube", title: "재생중인곡", artist: "가수" });
  });
});

test("남길 것이 없으면 전부 비운다", () => {
  seedTrack("yt:a", "곡A");
  seedTrack("yt:b", "곡B");

  const result = audioCache.resetCache();

  assert.equal(result.kept, 0);
  assert.equal(audioCache.db.prepare("SELECT COUNT(*) AS n FROM audio_cache").get().n, 0);
  assert.equal(audioCache.db.prepare("SELECT COUNT(*) AS n FROM track_lookup").get().n, 0);
});
