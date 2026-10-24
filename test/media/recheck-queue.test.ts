// src/media/recheck-queue.ts — 캐시로 튼 곡의 원본을 출처마다의 간격이 지났으면 뒤에서 다시 묻고, 결과대로 남기거나 지운다

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import config from "../../src/config/index.ts";
import * as stores from "../../src/store/stores.ts";
import * as audioCache from "../../src/store/audio-cache.ts";
import * as sourceChecks from "../../src/store/source-checks.ts";
import { cacheDb } from "../../src/store/cache-db.ts";
import * as queue from "../../src/media/recheck-queue.ts";
import { audioKeyOf } from "../../src/rules/audio-key-of.ts";
import type { Recheck } from "../../src/media/source-recheck.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "recheck-queue-"));
const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const YT = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
const DL = "https://example.com/song.ogg";

before(() => {
  stores.open(path.join(TMP, "db"));
  audioCache._setCacheDir(path.join(TMP, "cache"));
});
after(() => {
  queue._reset();
  stores.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

let asked: string[] = [];
let answer: Recheck = { kind: "same", version: "lmt:1" };
beforeEach(() => {
  asked = [];
  answer = { kind: "same", version: "lmt:1" };
  queue._reset({ now: () => NOW, recheck: async (url) => (asked.push(url), answer) });
  cacheDb.get().exec("DELETE FROM audio_cache; DELETE FROM source_checks;");
  fs.rmSync(audioCache.cacheDir(), { recursive: true, force: true });
  fs.mkdirSync(audioCache.cacheDir(), { recursive: true });
});

// 캐시 파일 하나(받은 때 · 버전)
function cached(audioKey: string, downloadedAt: number, version: string) {
  const file = audioCache.getFilePath(audioKey);
  fs.writeFileSync(file, "opus");
  cacheDb.get().prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, audio_version, version_checked_at, downloaded_at, created_at) VALUES (?, 'cached', ?, 4, ?, ?, ?, ?)").run(audioKey, file, version, downloadedAt, downloadedAt, downloadedAt);
  return file;
}

test("간격이 지난 파일만 묻는다: 유튜브 90일 · 직접 링크 14일, 0 이면 묻지 않는다", async () => {
  cached("yt:aaaaaaaaaaa", NOW - 30 * DAY, "lmt:1");
  queue.notePlayedFromCache({ audioUrl: YT, title: "a" }, null);
  await queue._drain();
  assert.deepEqual(asked, [], "유튜브는 90일이 안 지났다");

  const key = audioKeyOf(DL)!;
  cached(key, NOW - 20 * DAY, 'etag="1"');
  queue.notePlayedFromCache({ audioUrl: DL, title: "b" }, null);
  await queue._drain();
  assert.deepEqual(asked, [DL], "직접 링크는 14일이 지났다");

  const saved = { ...config.cache.recheckMs };
  try {
    config.cache.recheckMs.direct = 0;
    cacheDb.get().exec("DELETE FROM source_checks; UPDATE audio_cache SET version_checked_at = 0");
    asked = [];
    queue.notePlayedFromCache({ audioUrl: DL, title: "b" }, null);
    await queue._drain();
    assert.deepEqual(asked, [], "0 이면 끔");
  } finally {
    Object.assign(config.cache.recheckMs, saved);
  }
});

test("같음: 원본 버전 · 확인 시각을 남기고(캐시 파일 행은 그대로), 다음 재생은 다시 묻지 않는다", async () => {
  cached("yt:aaaaaaaaaaa", NOW - 100 * DAY, "lmt:1");
  queue.notePlayedFromCache({ audioUrl: YT, title: "a" }, null);
  await queue._drain();
  assert.deepEqual(sourceChecks.getCheck("yt:aaaaaaaaaaa"), { ok: true, at: NOW, version: "lmt:1" });
  assert.equal(audioCache.lookupByAudioKey("yt:aaaaaaaaaaa")?.version_checked_at, NOW - 100 * DAY);
  queue.notePlayedFromCache({ audioUrl: YT, title: "a" }, null);
  await queue._drain();
  assert.equal(asked.length, 1);
});

test("견주지 못함(버전 없는 옛 캐시 등): 틀 수 있음으로 남겨 간격대로만 다시 묻는다", async () => {
  cached("yt:aaaaaaaaaaa", NOW - 100 * DAY, "lmt:1");
  answer = { kind: "uncompared", reason: "적어 둔 버전이 없다" };
  queue.notePlayedFromCache({ audioUrl: YT, title: "a" }, null);
  await queue._drain();
  assert.deepEqual(sourceChecks.getCheck("yt:aaaaaaaaaaa"), { ok: true, at: NOW });
  queue.notePlayedFromCache({ audioUrl: YT, title: "a" }, null);
  await queue._drain();
  assert.equal(asked.length, 1);
});

test("유튜브가 바뀌면 알리기만: 원본 버전은 남기고 캐시 파일은 그대로", async () => {
  const file = cached("yt:aaaaaaaaaaa", NOW - 100 * DAY, "lmt:1");
  answer = { kind: "changed", version: "lmt:2", durationChanged: false };
  queue.notePlayedFromCache({ audioUrl: YT, title: "a" }, null);
  await queue._drain();
  assert.deepEqual(sourceChecks.getCheck("yt:aaaaaaaaaaa"), { ok: true, at: NOW, version: "lmt:2" });
  assert.ok(fs.existsSync(file), "캐시를 지우지 않는다");
  assert.equal(audioCache.lookupByAudioKey("yt:aaaaaaaaaaa")?.audio_version, "lmt:1");
});

test("직접 링크가 바뀌면 캐시를 지운다(다음 재생이 새로 받는다), 쓰는 중이면 지우지 않고 기다린다", async () => {
  const key = audioKeyOf(DL)!;
  const file = cached(key, NOW - 20 * DAY, 'etag="1"');
  answer = { kind: "changed", version: 'etag="2"', durationChanged: null };
  audioCache.protect("g1", key);
  try {
    queue.notePlayedFromCache({ audioUrl: DL, title: "b" }, null);
    await queue._drain();
    assert.ok(fs.existsSync(file), "트는 중이라 아직 지우지 않는다");
  } finally {
    audioCache.unprotect("g1");
  }
  // 캐시 DB 의 재생 테스트(간격 · 줄을 보지 않는다)로 다시: 이제 지운다
  assert.equal((await queue.recheckNow(key, DL))?.kind, "changed");
  assert.equal(fs.existsSync(file), false);
  assert.equal(audioCache.lookupByAudioKey(key), null);
});

test("사라짐은 캐시를 두고 남기기만, 모름은 하루 동안 다시 넣지 않는다(손으로는 된다)", async () => {
  const file = cached("yt:aaaaaaaaaaa", NOW - 100 * DAY, "lmt:1");
  answer = { kind: "gone", code: "unavailable-contents" };
  queue.notePlayedFromCache({ audioUrl: YT, title: "a" }, null);
  await queue._drain();
  assert.deepEqual(sourceChecks.getCheck("yt:aaaaaaaaaaa"), { ok: false, code: "unavailable-contents", at: NOW });
  assert.ok(fs.existsSync(file));

  cacheDb.get().exec("DELETE FROM source_checks; UPDATE audio_cache SET version_checked_at = 0");
  answer = { kind: "unknown", reason: "timed out" };
  asked = [];
  queue.notePlayedFromCache({ audioUrl: YT, title: "a" }, null);
  await queue._drain();
  queue.notePlayedFromCache({ audioUrl: YT, title: "a" }, null);
  await queue._drain();
  assert.equal(asked.length, 1, "모름이면 하루 동안 다시 넣지 않는다");
  assert.equal((await queue.recheckNow("yt:aaaaaaaaaaa", YT))?.kind, "unknown");
  assert.equal(asked.length, 2, "손으로는 바로");
  assert.equal(await queue.recheckNow("yt:aaaaaaaaaaa", "https://open.spotify.com/track/x"), null, "키와 주소가 맞지 않으면 묻지 않는다");
  assert.equal(await queue.recheckNow("yt:bbbbbbbbbbb", "https://www.youtube.com/watch?v=bbbbbbbbbbb"), null, "캐시 파일이 없으면 묻지 않는다");
});
