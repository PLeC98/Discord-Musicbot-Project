// src/store/stores.ts, sqlite.ts: DB 파일마다 구조 버전이 맞지 않을 때의 방침. 저절로 새로 만들거나 그 자리에서 올리지 않는다.
// 어느 파일이든 열지 않고 멈춘다. 캐시, 실행 상태는 삭제하고 다시 시작하라고 안내하고, 설정은 그 DB 를 만든 봇으로 실행하라고 안내한다.

import { sessions } from "../../src/store/player-sessions.ts";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { codeOf, messageOf } from "../../src/rules/error-kind.ts";
import * as stores from "../../src/store/stores.ts";
import { cacheDb } from "../../src/store/cache-db.ts";
import { stateDb, forgetGuild } from "../../src/store/state-db.ts";
import { settingsDb } from "../../src/store/settings-db.ts";
import * as guildSettings from "../../src/store/guild-settings.ts";
import * as panelRecords from "../../src/store/panel-records.ts";
import * as voiceStatus from "../../src/store/voice-status.ts";
import sink from "../../src/infra/log/sink.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-schema-"));
let serial = 0;
let dir = root;

beforeEach(() => {
  stores.close();
  guildSettings.forgetCache();
  panelRecords._reset();
  dir = path.join(root, String(serial++));
});

after(() => {
  stores.close();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});

// 미리 만들어 둔 옛 파일. 표 하나와 버전 표시만
function prepare(name: string, version: number, sql: string) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, name));
  db.exec(sql);
  db.pragma(`user_version = ${version}`);
  db.close();
}

const versionOf = (db: { get(): Database.Database }) => db.get().pragma("user_version", { simple: true });

test("새 폴더: 세 파일을 각자의 버전으로 만들고 쓴다", () => {
  stores.open(dir);
  assert.deepEqual([versionOf(settingsDb), versionOf(stateDb), versionOf(cacheDb)], [settingsDb.spec.version, stateDb.spec.version, cacheDb.spec.version]);
  for (const name of ["settings.db", "state.db", "cache.db"]) assert.ok(fs.existsSync(path.join(dir, name)), name);

  sessions().append("g", [{ title: "a", pageUrl: "https://y/a", requestKey: "https://y/a" }]);
  stores.close();
  stores.open(dir);
  assert.equal(sessions().load("g")?.queue[0].title, "a", "같은 버전이면 다시 열고 내용이 남아 있다");
});

// 삭제하고 다시 시작하는 것(운영자가 할 일)
const remove = (name: string) => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(path.join(dir, name + suffix), { force: true });
};

test("캐시 DB 버전이 다르면(옛 한 파일 구조 포함) 열지 않고 멈춘다. 파일은 손대지 않고, 삭제한 뒤 다시 시작하면 새로 만든다", () => {
  prepare("cache.db", 5, "CREATE TABLE guild_settings (guild_id TEXT PRIMARY KEY); CREATE TABLE audio_cache (audio_key TEXT PRIMARY KEY); INSERT INTO audio_cache VALUES ('yt:old');");
  assert.throws(
    () => stores.open(dir),
    (error) => codeOf(error) === "SCHEMA_MISMATCH" && messageOf(error).includes("삭제한 뒤 다시 시작하면") && messageOf(error).includes("링크 데이터"),
  );
  assert.equal(settingsDb.isOpen() || stateDb.isOpen() || cacheDb.isOpen(), false, "하나라도 못 열면 연 것을 닫는다");
  const check = new Database(path.join(dir, "cache.db"));
  assert.equal(check.prepare("SELECT COUNT(*) FROM audio_cache").pluck().get(), 1, "옛 표를 삭제하지 않는다");
  assert.equal(check.pragma("user_version", { simple: true }), 5);
  check.close();

  remove("cache.db");
  stores.open(dir);
  assert.equal(versionOf(cacheDb), cacheDb.spec.version);
  assert.equal(cacheDb.get().prepare("SELECT COUNT(*) FROM audio_cache").pluck().get(), 0);
});

test("실행 상태 DB 버전이 다르면 멈추고, 삭제한 뒤 다시 시작하면 새로 만든다. 설정은 그대로", () => {
  stores.open(dir);
  guildSettings.table.setBotChannel("g", "c");
  stores.close();
  const file = new Database(path.join(dir, "state.db"));
  file.pragma(`user_version = ${stateDb.spec.version + 1}`);
  file.close();

  assert.throws(
    () => stores.open(dir),
    (error) => codeOf(error) === "SCHEMA_MISMATCH" && messageOf(error).includes("저장된 대기열"),
  );
  remove("state.db");
  stores.open(dir);
  assert.equal(versionOf(stateDb), stateDb.spec.version);
  assert.equal(guildSettings.table.getBotChannel("g"), "c");
});

test("설정 DB 버전이 다르면 열지 않고 멈춘다. 파일은 손대지 않고 아무 DB 도 열린 채로 남지 않는다", () => {
  prepare("settings.db", 99, "CREATE TABLE guild_settings (guild_id TEXT PRIMARY KEY, data_json TEXT NOT NULL); INSERT INTO guild_settings VALUES ('g', '{}');");
  assert.throws(
    () => stores.open(dir),
    (error) => codeOf(error) === "SCHEMA_MISMATCH" && messageOf(error).includes("열지 않습니다"),
  );
  assert.equal(settingsDb.isOpen() || stateDb.isOpen() || cacheDb.isOpen(), false);
  assert.throws(() => settingsDb.get(), { code: "DB_NOT_OPEN" }, "열지 못했으면 쓰려는 순간 던진다");
  assert.equal(fs.existsSync(path.join(dir, "cache.db")), false, "설정이 막히면 다른 파일을 만들지 않는다");

  const check = new Database(path.join(dir, "settings.db"));
  assert.equal(check.prepare("SELECT COUNT(*) FROM guild_settings").pluck().get(), 1);
  assert.equal(check.pragma("user_version", { simple: true }), 99);
  check.close();
});

test("현재 재생 패널 위치: 쓰고 읽고 비운다. 서버 설정과 다른 파일이다", async () => {
  stores.open(dir);
  assert.equal(await panelRecords.getPanel("g"), null);

  guildSettings.table.setBotChannel("g", "c-bot");
  await panelRecords.setPanel("g", "c-bot", "m1");
  assert.deepEqual(await panelRecords.getPanel("g"), { channelId: "c-bot", messageId: "m1" });

  await panelRecords.setPanel("g", "c-other", "m2");
  panelRecords._reset();
  assert.deepEqual(await panelRecords.getPanel("g"), { channelId: "c-other", messageId: "m2" }, "서버당 한 줄을 덮어쓴다");
  assert.equal(guildSettings.table.getBotChannel("g"), "c-bot");

  await panelRecords.setPanel("g", "c-other", null);
  panelRecords._reset();
  assert.equal(await panelRecords.getPanel("g"), null);
});

test("서버에서 나가면 그 서버의 실행 상태만 삭제한다. 서버 설정, 다른 서버는 남는다", async () => {
  stores.open(dir);
  for (const g of ["gone", "stay"]) {
    sessions().append(g, [{ title: "a", pageUrl: "https://y/a", requestKey: "https://y/a" }]);
    await panelRecords.setPanel(g, `${g}-text`, `${g}-msg`);
    voiceStatus.save(`${g}-voice`, "▶️ 곡");
  }
  guildSettings.table.setDjRoles("gone", ["r"]);

  forgetGuild("gone", ["gone-text", "gone-voice"]);
  panelRecords._reset();

  assert.equal(sessions().load("gone"), null);
  assert.equal(await panelRecords.getPanel("gone"), null);
  assert.deepEqual(voiceStatus.load(), [["stay-voice", "▶️ 곡"]]);
  assert.notEqual(sessions().load("stay"), null);
  assert.deepEqual(guildSettings.table.getDjRoles("gone"), ["r"], "다시 초대하면 그대로 쓴다");
});

test("표 만들기와 구조 버전은 한 번에: 만드는 도중 멈춘 파일은 표가 없어 다음에 새로 만든다", async () => {
  const { DbFile } = await import("../../src/store/sqlite.ts");
  const file = path.join(dir, "half.db");
  let stop = true;
  const spec = {
    label: "시험 DB",
    fileName: "half.db",
    version: 3,
    synchronous: "NORMAL" as const,
    onMismatch: { lost: "없음" },
    createTables(db: Database.Database) {
      db.exec("CREATE TABLE IF NOT EXISTS one (id INTEGER PRIMARY KEY)");
      if (stop) throw new Error("만드는 도중 멈춤");
      db.exec("CREATE TABLE IF NOT EXISTS two (id INTEGER PRIMARY KEY)");
    },
  };
  assert.throws(() => new DbFile(spec).open(file), /만드는 도중 멈춤/);
  stop = false;
  const again = new DbFile(spec);
  again.open(file);
  assert.deepEqual([again.get().pragma("user_version", { simple: true }), again.get().prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'").pluck().get()], [3, 2]);
  again.close();
});

test("지운 공간 돌려주기(auto_vacuum): 새 파일에 걸리고, 이 설정 없이 만든 파일은 열 때 바꾼다", async () => {
  const { DbFile } = await import("../../src/store/sqlite.ts");
  const spec = (autoVacuum?: "INCREMENTAL") => ({ label: "시험 DB", fileName: "v.db", version: 1, synchronous: "NORMAL" as const, onMismatch: { lost: "없음" }, autoVacuum, createTables: (db: Database.Database) => void db.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)") });
  const modeOf = (file: string, autoVacuum?: "INCREMENTAL") => {
    const one = new DbFile(spec(autoVacuum));
    one.open(file);
    const mode = one.get().pragma("auto_vacuum", { simple: true });
    one.close();
    return mode;
  };
  assert.equal(modeOf(path.join(dir, "new.db"), "INCREMENTAL"), 2, "새 파일");
  const old = path.join(dir, "old.db");
  assert.equal(modeOf(old), 0, "설정 없이 만든 파일");
  assert.equal(modeOf(old, "INCREMENTAL"), 2, "열 때 바꾼다");
});

test("지운 공간 돌려주기로 바꾸는 VACUUM 이 실패해도(디스크가 모자람 등) 그대로 열고 warn 을 남긴다. 다음에 다시 해 본다", async () => {
  const { DbFile } = await import("../../src/store/sqlite.ts");
  const spec = (autoVacuum?: "INCREMENTAL") => ({ label: "시험 DB", fileName: "v.db", version: 1, synchronous: "NORMAL" as const, onMismatch: { lost: "없음" }, autoVacuum, createTables: (db: Database.Database) => void db.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)") });
  const file = path.join(dir, "full.db");
  const plain = new DbFile(spec());
  plain.open(file);
  plain.close();

  const exec = Database.prototype.exec;
  Database.prototype.exec = function (this: Database.Database, sql: string) {
    if (sql === "VACUUM") throw Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });
    return exec.call(this, sql);
  };
  const from = sink.buffer.length;
  const one = new DbFile(spec("INCREMENTAL"));
  try {
    one.open(file);
  } finally {
    Database.prototype.exec = exec;
  }
  assert.equal(one.get().prepare("SELECT COUNT(*) FROM t").pluck().get(), 0, "열렸다");
  assert.equal(one.get().pragma("auto_vacuum", { simple: true }), 0);
  assert.ok(sink.buffer.slice(from).some((e) => e.level === "warn" && e.text.includes("database or disk is full")));
  one.close();

  const again = new DbFile(spec("INCREMENTAL"));
  again.open(file);
  assert.equal(again.get().pragma("auto_vacuum", { simple: true }), 2, "다음에 열 때 바꾼다");
  again.close();
});
