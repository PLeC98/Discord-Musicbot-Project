// src/store/full-reset.ts — 봇 전체 초기화. 마커가 있을 때만, DB 폴더에서 설정 스냅샷 · 이번 실행의 기록을 뺀 전부와 캐시 폴더 안을 지우고 마커를 마지막에 지운다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fullReset from "../../src/store/full-reset.ts";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "full-reset-"));
after(() => fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 }));

function layout() {
  const dirs = { database: path.join(ROOT, "database"), audioCache: path.join(ROOT, "audio_cache") };
  fs.rmSync(ROOT, { recursive: true, force: true });
  const put = (rel: string) => {
    const file = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x");
  };
  for (const rel of ["database/settings.db", "database/settings.db-wal", "database/state.db", "database/cache.db", "database/ai-requests.db", "database/sessions.db", "database/deployed-commands.json", "database/settings.restore.db", "database/dashboard/favicon/index.json", "database/tmp/upload.zip", "database/full-backups/backup.zip", "database/새로 생긴 파일.json"]) put(rel);
  for (const rel of ["database/backups/settings-daily-2026-10-18.db", "database/run-state.json", "database/child-processes.json", "audio_cache/track_a.opus", "audio_cache/track_b.tmp-1.opus", ".env", "logs/bot.log", "vendor/bin/ffmpeg"]) put(rel);
  return dirs;
}
const left = (dir: string) => fs.readdirSync(dir).sort();

test("예약하지 않았으면 아무것도 지우지 않는다", () => {
  const dirs = layout();
  const before = left(dirs.database);
  assert.equal(fullReset.applyRequested(dirs), false);
  assert.deepEqual(left(dirs.database), before);
});

test("예약했으면 스냅샷 · 이번 실행의 기록을 뺀 DB 폴더와 캐시 폴더 안을 지우고, 마커도 지운다", () => {
  const dirs = layout();
  fullReset.request(dirs);
  assert.equal(fullReset.requested(dirs), true);

  assert.equal(fullReset.applyRequested(dirs), true);

  assert.deepEqual(left(dirs.database), ["backups", "child-processes.json", "run-state.json"]);
  assert.deepEqual(left(path.join(dirs.database, "backups")), ["settings-daily-2026-10-18.db"]);
  assert.deepEqual(left(dirs.audioCache), []);
  for (const kept of [".env", "logs/bot.log", "vendor/bin/ffmpeg"]) assert.ok(fs.existsSync(path.join(ROOT, kept)), kept);
  assert.equal(fullReset.requested(dirs), false);
  assert.equal(fullReset.applyRequested(dirs), false, "한 번만");
});

test("예약 취소", () => {
  const dirs = layout();
  fullReset.request(dirs);
  assert.equal(fullReset.cancel(dirs), true);
  assert.equal(fullReset.cancel(dirs), false);
  assert.equal(fullReset.applyRequested(dirs), false);
  assert.ok(fs.existsSync(path.join(dirs.database, "settings.db")));
});

test("지우다 막히면 RESET_FAILED 로 멈추고 마커는 남는다(다음 기동이 이어서 지운다)", () => {
  const dirs = layout();
  fullReset.request(dirs);
  const locked = path.join(dirs.database, "state.db");
  const remove = (target: string) => {
    if (target === locked) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    fs.rmSync(target, { recursive: true, force: true });
  };
  assert.throws(() => fullReset.applyRequested(dirs, remove), { code: "RESET_FAILED" });
  assert.equal(fullReset.requested(dirs), true);
  assert.equal(fullReset.applyRequested(dirs), true, "막힌 것이 풀리면 이어서 지운다");
  assert.equal(fs.existsSync(locked), false);
});
