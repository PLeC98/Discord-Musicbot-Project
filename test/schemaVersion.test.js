"use strict";

// src/CacheManager.js — DB 구조 버전이 맞지 않으면 열지 않는다. 마이그레이션은 두지 않는다.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-schema-"));
const CacheManager = require("../src/CacheManager");

after(() => {
  CacheManager.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function open(name) {
  CacheManager.close();
  CacheManager.initialize(path.join(dir, name));
}

test("새 DB는 현재 버전으로 만들어지고 세션 표를 쓴다", () => {
  open("fresh.db");
  assert.equal(CacheManager.db.pragma("user_version", { simple: true }), CacheManager.SCHEMA_VERSION);

  CacheManager.sessions.append("g", [{ title: "a" }]);
  assert.equal(CacheManager.sessions.load("g").queue.length, 1);
});

test("같은 버전의 DB는 다시 열리고 내용이 남아 있다", () => {
  open("fresh.db");
  assert.equal(CacheManager.sessions.load("g").queue[0].title, "a");
});

test("버전 표시가 없는 기존 DB는 열지 않고 지우라고 알린다", () => {
  const legacy = path.join(dir, "legacy.db");
  const pre = new Database(legacy);
  pre.exec("CREATE TABLE player_sessions (guild_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  pre.close();

  CacheManager.close();
  assert.throws(
    () => CacheManager.initialize(legacy),
    (error) => error.code === "SCHEMA_MISMATCH" && error.message.includes("지운 뒤 다시 실행"),
  );
  assert.equal(CacheManager._initialized, false, "열다 만 상태로 남지 않는다");
  assert.equal(CacheManager.db, null);

  const check = new Database(legacy);
  const made = check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'session_tracks'").get().n;
  check.close();
  assert.equal(made, 0, "맞지 않는 DB에 새 표를 만들지 않는다 — 파일은 손대지 않는다");
});

test("버전이 다른 DB도 같다", () => {
  const other = path.join(dir, "other.db");
  const pre = new Database(other);
  pre.exec("CREATE TABLE guild_settings (guild_id TEXT PRIMARY KEY)");
  pre.pragma(`user_version = ${CacheManager.SCHEMA_VERSION + 1}`);
  pre.close();

  CacheManager.close();
  assert.throws(() => CacheManager.initialize(other), { code: "SCHEMA_MISMATCH" });
});

test("현재 재생 패널 자리: 쓰고 읽고 비운다 — 같은 행의 서버 설정은 그대로", () => {
  open("panel.db");
  assert.equal(CacheManager.getPanelRecord("g"), null);

  CacheManager.setBotChannel("g", "c-bot");
  CacheManager.setPanelRecord("g", "c-bot", "m1");
  assert.deepEqual(CacheManager.getPanelRecord("g"), { channelId: "c-bot", messageId: "m1" });

  CacheManager.setPanelRecord("g", "c-other", "m2");
  assert.deepEqual(CacheManager.getPanelRecord("g"), { channelId: "c-other", messageId: "m2" }, "서버당 한 행을 덮어쓴다");
  assert.equal(CacheManager.getBotChannel("g"), "c-bot");

  CacheManager.setPanelRecord("g", "c-other", null);
  assert.equal(CacheManager.getPanelRecord("g"), null);
});
