// src/app/full-backup.ts — 명령 전체 백업(.env · 설정 DB · 파비콘 · 로그인 배경). 다른 봇 폴더에 풀어 덮어쓰면 다음 기동이 설정 DB 를 교체하고 배경 기록을 바꾼다

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
// 로그인 배경을 쓰지 않은 봇(폴더가 없다). 배경 테스트는 따로 경로를 만든다
const backgroundDir = path.join(work, "no-background");
fs.writeFileSync(envFile, "DISCORD_TOKEN=token-for-test\n");
fs.mkdirSync(faviconDir);
fs.writeFileSync(path.join(faviconDir, "index.json"), "{}");
fs.writeFileSync(path.join(faviconDir, "lz0abc12ff.reserve.png"), Buffer.from([1, 2, 3]));
// 봇이 쓰지 않는 파일은 담지 않는다
fs.writeFileSync(path.join(faviconDir, "notes.txt"), "x");

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

test("켜져 있는 봇에서 만들고(.env · 설정 DB 를 교체할 이름으로 · 파비콘), 한 번에 하나만 둔다", async () => {
  settingsDocs.write("status", { messages: ["옮길 것"] }, settingsDocs.read("status").revision);
  const first = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir }, new Date(2026, 9, 10, 9, 0));
  assert.deepEqual(
    unzip(fs.readFileSync(first.file)).map((one) => one.name),
    [".env", "database/settings.restore.db", "database/settings.restore.db.json", "database/dashboard/favicon/index.json", "database/dashboard/favicon/lz0abc12ff.reserve.png"],
  );
  const second = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir }, new Date(2026, 9, 11, 9, 0));
  assert.deepEqual(second.replaced, [path.basename(first.file)]);
  assert.deepEqual(fs.readdirSync(outDir), [path.basename(second.file)], "평문 토큰이 든 파일을 쌓지 않는다");
  if (process.platform !== "win32") assert.equal(fs.statSync(second.file).mode & 0o777, 0o600);
});

test("다른 봇 폴더에 풀어 덮어쓰면 다음 기동이 설정 DB 를 교체하고, 그 봇의 것은 스냅샷으로 남긴다", async () => {
  settingsDocs.write("status", { messages: ["옮길 것"] }, settingsDocs.read("status").revision);
  const made = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir });
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

test("구조 버전이 다른 봇이 만든 백업이면 교체하지 않고 까닭을 알린다(예약된 것 · 지금 것은 그대로)", async () => {
  const made = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir });
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
  assert.equal((error as { dbFile?: string }).dbFile, "settings.db", "기동이 복원하는 법을 함께 알린다");
  assert.ok(fs.existsSync(staged));
  assert.deepEqual(statusIn(path.join(bot, "database", "settings.db")), { messages: ["그 봇의 것"] });
});

test("로그인 배경: 다 만든 배경과 기록을 저장 경로 그대로 담고, 켜진 봇의 기록 · 폴더는 건드리지 않는다. 풀어 덮어쓰면 그 봇에 있던 배경은 다음 기동이 치운다", async () => {
  const loginBackground = await import("../../src/dashboard/login-background/store.ts");
  const dir = path.join(work, "login-background");
  loginBackground._useDir(dir);
  const ready = loginBackground.create({ kind: "image", from: "upload", name: "그림" });
  fs.writeFileSync(path.join(loginBackground.folderOf(ready.id), "still-1280.webp"), "webp");
  fs.writeFileSync(path.join(loginBackground.folderOf(ready.id), "source"), "원본");
  Object.assign(ready, { edit: { crop: { x: 0, y: 0, w: 1, h: 1 }, range: null, thumbAt: null }, done: [...ready.stages], media: { stills: [1280], color: null, scenes: [], rungs: {} } });
  loginBackground.show(ready.id);
  const making = loginBackground.create({ kind: "video", from: "upload", name: "만드는 중" });
  loginBackground.save();
  // 켜진 봇이 업로드 중인 배경(아직 기록에 없다)
  const uploading = loginBackground.reserve();
  const indexBefore = fs.readFileSync(path.join(dir, "index.json"), "utf8");

  const made = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir: dir, outDir });
  assert.equal(made.backgrounds, 1);
  const names = unzip(fs.readFileSync(made.file)).map((one) => one.name);
  assert.deepEqual(
    names.filter((one) => one.includes("login-background")),
    ["database/dashboard/login-background/index.json", `database/dashboard/login-background/${ready.id}/still-1280.webp`],
    "만드는 중인 배경 · 원본은 담지 않는다",
  );
  assert.ok(fs.existsSync(loginBackground.folderOf(uploading)), "기록에 없는 폴더를 지우지 않는다");
  assert.ok(fs.existsSync(loginBackground.folderOf(making.id)));
  assert.equal(fs.readFileSync(path.join(dir, "index.json"), "utf8"), indexBefore, "기록을 쓰지 않는다");

  // 다른 봇 폴더(그 봇의 배경이 있다)에 풀어 덮어쓰고 켠다
  const bot = otherBot();
  const theirs = path.join(bot, "database", "dashboard", "login-background");
  loginBackground._useDir(theirs);
  const old = loginBackground.create({ kind: "image", from: "upload", name: "그 봇의 것" });
  loginBackground.save();
  extract(made.file, bot);
  loginBackground._useDir(theirs);
  assert.deepEqual(
    loginBackground.items().map((one) => [one.id, one.name]),
    [[ready.id, "그림"]],
  );
  assert.equal(loginBackground.loaded().current, ready.id);
  assert.ok(!fs.existsSync(loginBackground.folderOf(old.id)), "그 봇에 있던 배경은 치운다");
  loginBackground._useDir(path.join(work, "unused-background"));
});
