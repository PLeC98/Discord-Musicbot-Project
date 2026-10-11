// src/app/full-backup.ts — 명령 전체 백업(.env · 설정 DB · 파비콘). 다른 봇 폴더에 풀어 덮어쓰면 다음 기동이 설정 DB 를 바꿔 끼운다

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { openTempStore } from "../helpers/temp-store.ts";
import { makeFullBackup } from "../../src/app/full-backup.ts";
import { unzip } from "../../src/infra/zip.ts";
import * as settingsDocs from "../../src/store/settings-docs.ts";
import * as snapshots from "../../src/store/snapshots.ts";
import { createTables, VERSION } from "../../src/store/settings-db.ts";
import { codeOf } from "../../src/rules/error-kind.ts";

const store = openTempStore("full-backup-");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "full-backup-work-"));
after(() => {
  store.close();
  fs.rmSync(work, { recursive: true, force: true });
});

const envFile = path.join(work, ".env");
const faviconDir = path.join(work, "favicon");
const outDir = path.join(work, "out");
fs.writeFileSync(envFile, "DISCORD_TOKEN=token-for-test\n");
fs.mkdirSync(faviconDir);
fs.writeFileSync(path.join(faviconDir, "32.png"), Buffer.from([1, 2, 3]));

// 풀어 덮어쓸 다른 봇 폴더(그 봇의 설정 DB 가 이미 있다)
function otherBot(version = VERSION) {
  const dir = fs.mkdtempSync(path.join(work, "bot-"));
  fs.mkdirSync(path.join(dir, "database"));
  const db = new Database(path.join(dir, "database", "settings.db"));
  createTables(db);
  db.prepare("INSERT INTO documents (name, data_json, revision) VALUES ('status', ?, 1)").run(JSON.stringify({ messages: ["그 봇의 것"] }));
  db.pragma(`user_version = ${version}`);
  db.close();
  return dir;
}
const extract = (zipFile: string, dir: string) => {
  for (const entry of unzip(fs.readFileSync(zipFile))) {
    fs.mkdirSync(path.dirname(path.join(dir, entry.name)), { recursive: true });
    fs.writeFileSync(path.join(dir, entry.name), entry.data);
  }
};
const statusIn = (file: string) => {
  const db = new Database(file, { readonly: true });
  try {
    return JSON.parse((db.prepare("SELECT data_json FROM documents WHERE name = 'status'").get() as { data_json: string }).data_json) as unknown;
  } finally {
    db.close();
  }
};

test("켜져 있는 봇에서 만들고(.env · 설정 DB 를 바꿔 끼울 이름으로 · 파비콘), 한 번에 하나만 둔다", async () => {
  settingsDocs.write("status", { messages: ["옮길 것"] }, settingsDocs.read("status").revision);
  const first = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, outDir }, new Date(2026, 9, 10, 9, 0));
  assert.deepEqual(
    unzip(fs.readFileSync(first.file)).map((one) => one.name),
    [".env", "database/settings.restore.db", "database/settings.restore.db.json", "database/dashboard/favicon/32.png"],
  );
  const second = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, outDir }, new Date(2026, 9, 11, 9, 0));
  assert.deepEqual(second.replaced, [path.basename(first.file)]);
  assert.deepEqual(fs.readdirSync(outDir), [path.basename(second.file)], "평문 토큰이 든 파일을 쌓지 않는다");
  if (process.platform !== "win32") assert.equal(fs.statSync(second.file).mode & 0o777, 0o600);
});

test("다른 봇 폴더에 풀어 덮어쓰면 다음 기동이 설정 DB 를 바꿔 끼우고, 그 봇의 것은 스냅샷으로 남긴다", async () => {
  settingsDocs.write("status", { messages: ["옮길 것"] }, settingsDocs.read("status").revision);
  const made = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, outDir });
  const bot = otherBot();
  fs.writeFileSync(path.join(bot, "database", "settings.db-wal"), "그 봇의 남은 기록"); // 풀어서 settings.db 를 덮었다면 얹혔을 것
  extract(made.file, bot);
  assert.equal(fs.readFileSync(path.join(bot, ".env"), "utf8"), "DISCORD_TOKEN=token-for-test\n");

  const database = path.join(bot, "database");
  assert.match(snapshots.applyStaged(database) ?? "", /전체 백업 musicbot-full-/);
  assert.ok(!fs.existsSync(path.join(database, "settings.db-wal")), "남은 기록은 치운다(열어 보기 전에 본다. 열면 SQLite 가 새로 만든다)");
  assert.deepEqual(statusIn(path.join(database, "settings.db")), { messages: ["옮길 것"] });
  const kept = snapshots.list(database).find((one) => one.kind === "before-restore");
  assert.ok(kept);
  assert.deepEqual(statusIn(path.join(database, "backups", kept.name)), { messages: ["그 봇의 것"] });
});

test("구조 버전이 다른 봇이 만든 백업이면 바꿔 끼우지 않고 까닭을 알린다(걸어 둔 것 · 지금 것은 그대로)", async () => {
  const made = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, outDir });
  const bot = otherBot();
  extract(made.file, bot);
  const staged = path.join(bot, "database", "settings.restore.db");
  const db = new Database(staged);
  db.pragma("user_version = 99");
  db.close();

  let error: unknown;
  try {
    snapshots.applyStaged(path.join(bot, "database"));
  } catch (caught) {
    error = caught;
  }
  assert.equal(codeOf(error), "RESTORE_FAILED");
  assert.equal((error as { dbFile?: string }).dbFile, "settings.db", "기동이 되살리는 법을 함께 알린다");
  assert.ok(fs.existsSync(staged));
  assert.deepEqual(statusIn(path.join(bot, "database", "settings.db")), { messages: ["그 봇의 것"] });
});
