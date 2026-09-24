// src/store/db.ts — DB 구조 버전이 맞지 않으면 열지 않는다. 마이그레이션은 두지 않는다.

import { sessions } from "../../src/store/playerSessions.ts";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-schema-"));
const guildTable = (await import("../../src/store/guildSettings.ts")).table;
const audioCache = await import("../../src/store/audioCache.ts");
const storeDb = await import("../../src/store/db.ts");

after(() => {
  audioCache.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

function open(name) {
  audioCache.close();
  audioCache.initialize(path.join(dir, name));
}

test("새 DB는 현재 버전으로 만들어지고 세션 표를 쓴다", () => {
  open("fresh.db");
  assert.equal(storeDb.get().pragma("user_version", { simple: true }), storeDb.SCHEMA_VERSION);

  sessions().append("g", [{ title: "a", pageUrl: "https://y/a", requestKey: "https://y/a" }]);
  assert.equal(sessions().load("g").queue.length, 1);
});

test("같은 버전의 DB는 다시 열리고 내용이 남아 있다", () => {
  open("fresh.db");
  assert.equal(sessions().load("g").queue[0].title, "a");
});

test("버전 표시가 없는 기존 DB는 열지 않고 지우라고 알린다", () => {
  const legacy = path.join(dir, "legacy.db");
  const pre = new Database(legacy);
  pre.exec("CREATE TABLE player_sessions (guild_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  pre.close();

  audioCache.close();
  assert.throws(
    () => audioCache.initialize(legacy),
    (error) => error.code === "SCHEMA_MISMATCH" && error.message.includes("지운 뒤 다시 실행"),
  );
  assert.equal(storeDb.isOpen(), false, "열다 만 상태로 남지 않는다");
  assert.throws(() => storeDb.get(), { code: "DB_NOT_OPEN" }, "열지 못했으면 쓰려는 순간 던진다");

  const check = new Database(legacy);
  const made = check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'session_tracks'").get().n;
  check.close();
  assert.equal(made, 0, "맞지 않는 DB에 새 표를 만들지 않는다 — 파일은 손대지 않는다");
});

test("버전이 다른 DB도 같다", () => {
  const other = path.join(dir, "other.db");
  const pre = new Database(other);
  pre.exec("CREATE TABLE guild_settings (guild_id TEXT PRIMARY KEY)");
  pre.pragma(`user_version = ${storeDb.SCHEMA_VERSION + 1}`);
  pre.close();

  audioCache.close();
  assert.throws(() => audioCache.initialize(other), { code: "SCHEMA_MISMATCH" });
});

test("현재 재생 패널 자리: 쓰고 읽고 비운다 — 같은 행의 서버 설정은 그대로", () => {
  open("panel.db");
  assert.equal(guildTable.getPanelRecord("g"), null);

  guildTable.setBotChannel("g", "c-bot");
  guildTable.setPanelRecord("g", "c-bot", "m1");
  assert.deepEqual(guildTable.getPanelRecord("g"), { channelId: "c-bot", messageId: "m1" });

  guildTable.setPanelRecord("g", "c-other", "m2");
  assert.deepEqual(guildTable.getPanelRecord("g"), { channelId: "c-other", messageId: "m2" }, "서버당 한 행을 덮어쓴다");
  assert.equal(guildTable.getBotChannel("g"), "c-bot");

  guildTable.setPanelRecord("g", "c-other", null);
  assert.equal(guildTable.getPanelRecord("g"), null);
});
