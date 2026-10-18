// src/store/audio-cache.ts · stores.ts · infra/disk.ts — 봇 상태 탭의 저장공간: 캐시 수와 상한 · 지키는 파일 · 틀지 않은 파일 · 다운로드 실패 · 마지막 정리, DB 크기와 행 수, 드라이브

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as audioCache from "../../src/store/audio-cache.ts";
import { cacheDb } from "../../src/store/cache-db.ts";
import * as stores from "../../src/store/stores.ts";
import { sessions } from "../../src/store/player-sessions.ts";
import config from "../../src/config/index.ts";
import { driveOf } from "../../src/infra/disk.ts";

const DB_DIR = path.join(os.tmpdir(), `musicbot-storage-test-${process.pid}`);

before(() => {
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  stores.open(DB_DIR);
  audioCache.initialize();
});
after(() => {
  audioCache.close();
  stores.close();
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 5 });
});

test("캐시: 수 · 크기와 상한, 지키는 파일, 한 번도 틀지 않은 파일, 다운로드 실패 행. 실제로 삭제한 정리를 기억한다", async () => {
  const ins = cacheDb.get().prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, play_count, downloaded_at) VALUES (?, ?, ?, ?, ?, ?)");
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

test("DB: 파일들(-wal 포함) 크기의 합과 행 수. 저장된 대기열은 실행 상태 DB 에서 센다", () => {
  const stats = stores.dbStats();
  assert.equal(path.resolve(stats.dir), path.resolve(DB_DIR));
  const each = ["settings.db", "state.db", "cache.db", "ai-requests.db"].map((name) => path.join(DB_DIR, name));
  const sum = each.reduce((total, file) => total + fs.statSync(file).size + (fs.existsSync(`${file}-wal`) ? fs.statSync(`${file}-wal`).size : 0), 0);
  assert.equal(stats.bytes, sum);
  assert.deepEqual([stats.lookups, stats.sponsorSegments, stats.sessions], [0, 0, 0]);
  sessions().append("g-stats", [{ title: "t", pageUrl: "https://y/stats", requestKey: "https://y/stats" }]);
  assert.equal(stores.dbStats().sessions, 1);
});

test("드라이브: Windows 는 F: 형식, 그 밖은 마운트 지점. 같은 드라이브면 이름이 같다. 쓴 양은 크기 안", () => {
  const drive = driveOf(os.tmpdir())!;
  if (process.platform === "win32") assert.match(drive.drive, /^[A-Z]:$/i);
  else assert.ok(path.isAbsolute(drive.drive) && path.resolve(os.tmpdir()).startsWith(drive.drive), drive.drive);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "drive-"));
  assert.equal(driveOf(other)!.drive, drive.drive, "같은 드라이브의 다른 폴더");
  fs.rmSync(other, { recursive: true });
  assert.ok(drive.usedBytes > 0 && drive.usedBytes <= drive.totalBytes);
  assert.equal(driveOf(path.join(os.tmpdir(), "없는-폴더-xyz")), null);
});
