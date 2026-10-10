// src/infra/owner-only.ts — 비밀(암호문) · 로그인이 든 파일은 봇을 돌리는 사용자만(POSIX 0600). Windows 는 권한이 먹지 않아 건너뛴다

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTempStore } from "../helpers/temp-store.ts";
import * as snapshots from "../../src/store/snapshots.ts";

const posix = { skip: process.platform === "win32" ? "Windows 는 POSIX 권한이 없다" : false };
const modeOf = (file: string) => fs.statSync(file).mode & 0o777;

test("DB 파일 · 스냅샷은 0600 으로 만든다", posix, async () => {
  const before = process.umask(0o022); // 보통의 umask 로도 남이 못 읽게
  const store = openTempStore("owner-only-");
  try {
    for (const name of ["settings.db", "state.db", "cache.db"]) assert.equal(modeOf(path.join(store.dir, name)), 0o600, name);
    const name = await snapshots.take("daily", new Date(2026, 9, 11));
    assert.equal(modeOf(path.join(store.dir, "backups", name)), 0o600);
  } finally {
    store.close();
    process.umask(before);
  }
});

test("세션 DB 도 0600", posix, async () => {
  const { SqliteSessionStore } = await import("../../src/dashboard/session-store.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-only-sessions-"));
  const file = path.join(dir, "sessions.db");
  const sessions = new SqliteSessionStore({ dbPath: file });
  try {
    assert.equal(modeOf(file), 0o600);
  } finally {
    sessions.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
