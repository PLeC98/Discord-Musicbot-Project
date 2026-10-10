// src/store/audio-cache.ts · db.ts · infra/disk.ts — 봇 상태 탭의 저장공간: 캐시 수와 상한 · 지키는 파일 · 틀지 않은 파일 · 받기 실패 · 마지막 정리, DB 크기와 줄 수, 드라이브

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as audioCache from "../../src/store/audio-cache.ts";
import * as storeDb from "../../src/store/db.ts";
import config from "../../src/config/index.ts";
import { driveOf } from "../../src/infra/disk.ts";

const DB_PATH = path.join(os.tmpdir(), `musicbot-storage-test-${process.pid}.db`);

before(() => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  audioCache.initialize(DB_PATH);
});
after(() => {
  audioCache.close();
  for (const file of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) fs.rmSync(file, { force: true });
});

test("캐시: 수 · 크기와 상한, 지키는 파일, 한 번도 틀지 않은 파일, 받기 실패 줄. 실제로 지운 정리를 기억한다", async () => {
  const ins = storeDb.get().prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, play_count, downloaded_at) VALUES (?, ?, ?, ?, ?, ?)");
  const old = Date.now() - 90 * 86_400_000;
  ins.run("played", "cached", "/nx/played.opus", 3_000_000, 4, Date.now());
  ins.run("guarded", "cached", "/nx/guarded.opus", 2_000_000, 0, old);
  ins.run("fresh", "cached", "/nx/fresh.opus", 1_000_000, 0, old);
  ins.run("broken", "error", null, null, 0, null);
  audioCache.protect("guarded");

  const before = audioCache.storageStats();
  assert.deepEqual({ ...before.cache, maxBytes: undefined, maxFiles: undefined }, { bytes: 6_000_000, maxBytes: undefined, files: 3, maxFiles: undefined, protectedFiles: 1, neverPlayed: 2, failed: 1, lastCleanup: null });
  assert.equal(before.cache.maxFiles, config.cache.maxFiles);
  assert.equal(before.minFreeBytes, config.cache.minFreeDiskBytes);
  assert.ok(before.drive && before.drive.totalBytes > 0);

  const saved = { ...config.cache };
  Object.assign(config.cache, { maxSizeBytes: 1e15, minFreeDiskBytes: 0, evictTargetPercent: 90, maxFiles: 2 });
  try {
    await audioCache.evict();
  } finally {
    Object.assign(config.cache, saved);
    audioCache.unprotect("guarded");
  }
  const { lastCleanup, files } = audioCache.storageStats().cache;
  assert.equal(files, 1, "지키는 파일은 남기고 지운다");
  assert.deepEqual({ ...lastCleanup, at: undefined }, { at: undefined, files: 2, bytes: 4_000_000 });
});

test("DB: 파일(-wal 포함) 크기와 줄 수", () => {
  const stats = storeDb.dbStats();
  assert.equal(path.resolve(stats.file), path.resolve(DB_PATH));
  assert.ok(stats.bytes > 0);
  assert.deepEqual([stats.lookups, stats.sponsorSegments, stats.sessions], [0, 0, 0]);
});

test("드라이브: Windows 는 F: 꼴, 그 밖은 뿌리. 쓴 양은 크기 안", () => {
  const drive = driveOf(os.tmpdir())!;
  assert.match(drive.drive, process.platform === "win32" ? /^[A-Z]:$/i : /^\/$/);
  assert.ok(drive.usedBytes > 0 && drive.usedBytes <= drive.totalBytes);
  assert.equal(driveOf(path.join(os.tmpdir(), "없는-폴더-xyz")), null);
});
