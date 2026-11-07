// src/app/full-backup.ts: 명령 전체 백업(.env, 설정 DB, 파비콘, 로그인 배경). 다른 봇 폴더에 풀어 덮어쓰면 다음 기동이 설정 DB 를 교체하고 배경 기록을 바꾼다

import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
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
import * as audioCache from "../../src/store/audio-cache.ts";
import * as trackLookup from "../../src/store/track-lookup.ts";
import { AUDIO_CACHE_PARTS } from "../../src/rules/audio-cache-parts.ts";
import { applyStagedAudio } from "../../src/dashboard/settings-archive.ts";

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

test("켜져 있는 봇에서 만들고(.env, 설정 DB 를 교체할 이름으로, 파비콘), 한 번에 하나만 둔다", async () => {
  settingsDocs.write("status", { messages: ["옮길 것"] }, settingsDocs.read("status").revision);
  const first = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir }, new Date(2026, 9, 10, 9, 0));
  assert.deepEqual(
    unzip(fs.readFileSync(first.file)).map((one) => one.name),
    ["database/settings.restore.db", "database/settings.restore.db.json", "database/audio-cache.restore.zip", "database/dashboard/favicon/index.json", "database/dashboard/favicon/lz0abc12ff.reserve.png", ".env"],
  );
  const second = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir }, new Date(2026, 9, 11, 9, 0));
  assert.deepEqual(second.replaced, [path.basename(first.file)]);
  assert.deepEqual(fs.readdirSync(outDir), [path.basename(second.file)], "평문 토큰이 든 파일을 쌓지 않는다");
  if (process.platform !== "win32") assert.equal(fs.statSync(second.file).mode & 0o777, 0o600);
});

test("이전 백업을 삭제하지 못해도 새 백업은 남기고 성공한다. 삭제하지 못한 것을 알린다", async () => {
  const stuckOut = path.join(work, "stuck-out");
  // 삭제하지 못하는 이전 백업이다(이름만 같은 폴더는 rmSync가 삭제하지 못한다)
  const stuck = path.join(stuckOut, "musicbot-full-20261001-0900.zip");
  fs.mkdirSync(path.join(stuck, "안"), { recursive: true });
  const made = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir: stuckOut }, new Date(2026, 9, 13, 9, 0));
  assert.ok(fs.existsSync(made.file));
  assert.deepEqual(made.left, ["musicbot-full-20261001-0900.zip"]);
  assert.deepEqual(made.replaced, []);
});

test("같은 초에 이미 그 이름이 있으면 번호를 붙여 올린다. 이름을 끝내 잡지 못하면 비밀값이 든 .part를 삭제하고 실패한다", async () => {
  const sameOut = path.join(work, "same-out");
  // 같은 이름의 폴더(삭제하지 못하는 이전 백업)
  fs.mkdirSync(path.join(sameOut, "musicbot-full-20261014-090000.zip", "안"), { recursive: true });
  const made = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir: sameOut }, new Date(2026, 9, 14, 9, 0));
  assert.equal(path.basename(made.file), "musicbot-full-20261014-090000-2.zip");

  const fullOut = path.join(work, "full-out");
  for (let n = 1; n <= 20; n++) fs.mkdirSync(path.join(fullOut, `musicbot-full-20261014-090000${n > 1 ? `-${n}` : ""}.zip`, "안"), { recursive: true });
  await assert.rejects(makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir: fullOut }, new Date(2026, 9, 14, 9, 0)), /이름 잡기 실패/);
  assert.deepEqual(
    fs.readdirSync(fullOut).filter((one) => one.endsWith(".part")),
    [],
  );
});

// root 는 읽기 전용 파일도 쓸 수 있다
test("ZIP 을 쓰지 못하면 그 까닭으로 실패한다(잡히지 않은 예외로 새지 않는다). 같은 .part 가 이미 있으면(다른 백업의 것) 삭제하지 않는다", async (t) => {
  const blockedOut = path.join(work, "blocked-out");
  t.mock.method(crypto, "randomBytes", () => Buffer.from("0badc0de", "hex"));
  const part = path.join(blockedOut, `musicbot-full-20261012-090000.zip.${process.pid}.0badc0de.part`);
  fs.mkdirSync(blockedOut);
  fs.writeFileSync(part, "다른 백업");
  await assert.rejects(makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir: blockedOut }, new Date(2026, 9, 12, 9, 0)), (error) => codeOf(error) === "EEXIST");
  assert.equal(fs.readFileSync(part, "utf8"), "다른 백업");
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

test("구조 버전이 다른 봇이 만든 백업이면 교체하지 않고 까닭을 알린다(예약된 것, 지금 것은 그대로)", async () => {
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

test("로그인 배경: 다 만든 배경과 기록을 저장 경로 그대로 담고, 켜진 봇의 기록, 폴더는 건드리지 않는다. 풀어 덮어쓰면 그 봇에 있던 배경은 다음 기동이 치운다", async () => {
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

test("오디오 캐시 번들: 기본은 캐시 파일 없이, withAudio 면 캐시 파일까지. 풀어 둔 번들은 다음 기동이 합치고 삭제한다", async () => {
  await audioCache.resetCache(AUDIO_CACHE_PARTS);
  fs.mkdirSync(audioCache.cacheDir(), { recursive: true });
  const cached = audioCache.getFilePath("yt:fullbackup1");
  fs.writeFileSync(cached, Buffer.alloc(200, 1));
  audioCache.recordDownloadStart("yt:fullbackup1", { title: "곡" });
  audioCache.recordDownloadComplete("yt:fullbackup1", cached, 200, { title: "곡" });
  trackLookup.recordTrackLookup({ requestKey: "https://y/full", pageUrl: "https://y/full", audioUrl: "https://www.youtube.com/watch?v=fullbackup1", platform: "youtube", title: "곡" });

  const bare = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir });
  assert.equal(bare.audioFiles, 0);
  const made = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir }, new Date(), { withAudio: true });
  assert.equal(made.audioFiles, 1);

  // 풀어 둔 번들을 다음 기동이 합친다(비운 캐시에)
  const bundle = unzip(fs.readFileSync(made.file), { maxBytes: 10_000_000 }).find((one) => one.name === "database/audio-cache.restore.zip")!;
  await audioCache.resetCache(AUDIO_CACHE_PARTS);
  // 새로 설치한 봇, 옮긴 직후: 캐시 폴더가 아직 없다(기동 시의 합치기는 캐시를 켜기 전이다)
  fs.rmSync(audioCache.cacheDir(), { recursive: true, force: true });
  fs.writeFileSync(path.join(store.dir, "audio-cache.restore.zip"), bundle.data);
  const done = await applyStagedAudio(store.dir);
  assert.deepEqual([done?.added?.["audio-files"], done?.added?.["audio-ledger"]], [1, 1]);
  assert.equal(audioCache.lookupByAudioKey("yt:fullbackup1")?.status, "cached");
  assert.equal(fs.existsSync(path.join(store.dir, "audio-cache.restore.zip")), false, "합친 뒤 삭제한다");
  assert.equal(await applyStagedAudio(store.dir), null, "없으면 null");

  // 읽을 수 없는 번들은 삭제하고 던진다(매번 다시 하지 않게)
  fs.writeFileSync(path.join(store.dir, "audio-cache.restore.zip"), "깨진 것");
  await assert.rejects(applyStagedAudio(store.dir), { code: "BAD_ZIP" });
  assert.equal(fs.existsSync(path.join(store.dir, "audio-cache.restore.zip")), false);
});

// 명령(pnpm run backup)은 봇과 다른 프로세스라 캐시 DB 를 열지 않은 채 부른다: cache.db 의 한 시점 사본을 열어 읽는다
test("다른 프로세스에서 만들면 cache.db 사본을 열어 번들을 만든다", async () => {
  const folder = fs.mkdtempSync(path.join(work, "cli-"));
  for (const name of ["settings.db", "cache.db"]) {
    const db = new Database(path.join(store.dir, name), { readonly: true });
    await db.backup(path.join(folder, name));
    db.close();
  }
  const out = path.join(folder, "out");
  const result = path.join(folder, "result.json");
  const code = `import fs from "node:fs";
import { makeFullBackup } from ${JSON.stringify(pathToFileURL(path.resolve("src/app/full-backup.ts")).href)};
fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify(await makeFullBackup(${JSON.stringify({ envFile, databaseDir: folder, faviconDir, backgroundDir, outDir: out })})));`;
  execFileSync(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, LOG_FILE: path.join(folder, "bot.log") } });
  const made = JSON.parse(fs.readFileSync(result, "utf8")) as { file: string; audioFiles: number | null };
  assert.equal(made.audioFiles, 0);
  assert.ok(unzip(fs.readFileSync(made.file), { maxBytes: 10_000_000 }).some((one) => one.name === "database/audio-cache.restore.zip"));
});

// 끝난 프로세스의 pid(곧바로 끝나는 자식)
function deadPid() {
  const child = spawnSync(process.execPath, ["-e", ""]);
  assert.ok(child.pid);
  return child.pid;
}

test("끝난 프로세스가 남긴 .part 만 삭제한다. 살아 있거나 확인할 수 없는(EPERM) 프로세스의 것, 잘못된 이름은 두고, 옛 형식은 남긴 채 알린다", async () => {
  const sweptOut = path.join(work, "swept-out");
  fs.mkdirSync(sweptOut);
  const dead = `musicbot-full-20261001-090000.zip.${deadPid()}.abcd1234.part`;
  const alive = `musicbot-full-20261001-090000.zip.${process.pid}.abcd1234.part`;
  const legacy = "musicbot-full-20261001-0900.zip.part";
  // 잘못된 이름(pid 가 십진수가 아님. 0x7ffffffe 는 숫자로 읽으면 끝난 pid 다)
  const odd = ["musicbot-full-20261001-090000.zip.12x.abcd1234.part", "musicbot-full-20261001-090000.zip.0x7ffffffe.abcd1234.part"];
  const names = [dead, alive, legacy, ...odd];
  // 권한이 없어 확인할 수 없는 프로세스(Windows 의 System, POSIX 의 init)
  const system = process.platform === "win32" ? 4 : 1;
  const denied = `musicbot-full-20261001-090000.zip.${system}.abcd1234.part`;
  if (process.getuid?.() !== 0) names.push(denied);
  for (const name of names) fs.writeFileSync(path.join(sweptOut, name), "평문");
  const made = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir: sweptOut }, new Date(2026, 9, 15, 9, 0));
  const left = fs.readdirSync(sweptOut);
  assert.ok(!left.includes(dead), "끝난 프로세스의 것");
  assert.ok(left.includes(alive) && left.includes(legacy) && odd.every((one) => left.includes(one)));
  if (process.getuid?.() !== 0) assert.ok(left.includes(denied), "EPERM 은 모른다");
  assert.deepEqual(made.legacyParts, [legacy]);
});

test("겹쳐 도는 두 백업은 서로의 .part 를 덮지 않고 둘 다 끝난다(같은 초면 번호를 붙인다)", async () => {
  const bothOut = path.join(work, "both-out");
  const at = new Date(2026, 9, 16, 9, 0);
  const [a, b] = await Promise.all([makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir: bothOut }, at), makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir: bothOut }, at)]);
  assert.notEqual(a.file, b.file);
  const left = fs.readdirSync(bothOut);
  assert.deepEqual(
    left.filter((one) => one.endsWith(".part")),
    [],
  );
  for (const zip of left) assert.equal(unzip(fs.readFileSync(path.join(bothOut, zip))).at(-1)?.name, ".env", "남은 것은 온전한 ZIP 이다");
});

test("담은 설정 DB 사본은 WAL 표시가 없다(풀어 둔 것을 읽기 전용으로 열어도 -wal, -shm 이 생기지 않는다)", async () => {
  const walOut = path.join(work, "wal-out");
  const made = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir: walOut }, new Date(2026, 9, 17, 9, 0));
  const db = unzip(fs.readFileSync(made.file)).find((one) => one.name === "database/settings.restore.db")!.data;
  // SQLite 헤더 18, 19 바이트: 쓰기, 읽기 형식(1 은 롤백 저널, 2 는 WAL)
  assert.deepEqual([db[18], db[19]], [1, 1]);
});

test("하드링크를 쓸 수 없는 파일 시스템(FAT32, exFAT)이면 이름을 바꿔 올린다. 이름이 있으면 번호를 붙인다", async (t) => {
  t.mock.method(fs, "linkSync", () => {
    throw Object.assign(new Error("operation not permitted, link"), { code: "EPERM" });
  });
  const fatOut = path.join(work, "fat-out");
  fs.mkdirSync(path.join(fatOut, "musicbot-full-20261018-090000.zip", "안"), { recursive: true });
  const made = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir: fatOut }, new Date(2026, 9, 18, 9, 0));
  assert.equal(path.basename(made.file), "musicbot-full-20261018-090000-2.zip");
  assert.equal(unzip(fs.readFileSync(made.file)).at(-1)?.name, ".env");
  assert.deepEqual(
    fs.readdirSync(fatOut).filter((one) => one.endsWith(".part")),
    [],
  );
});

test("목록을 읽은 뒤 겹쳐 도는 백업이 이전 백업을 삭제해 이 백업이 그 이름에 올라가도 자기 백업을 삭제하지 않는다", async (t) => {
  const raceOut = path.join(work, "race-out");
  fs.mkdirSync(raceOut);
  const old = path.join(raceOut, "musicbot-full-20261019-090000.zip");
  fs.writeFileSync(old, "이전 백업");
  const link = fs.linkSync;
  let first = true;
  t.mock.method(fs, "linkSync", (from: fs.PathLike, to: fs.PathLike) => {
    // 올리기 직전에 다른 백업이 이전 백업을 삭제한다
    if (first) fs.rmSync(old);
    first = false;
    return link(from, to);
  });
  const made = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir: raceOut }, new Date(2026, 9, 19, 9, 0));
  assert.equal(made.file, old);
  assert.ok(fs.existsSync(made.file), "자기가 올린 백업은 남는다");
  assert.deepEqual(made.replaced, []);
});

test("ZIP 을 다 쓴 뒤 올리기 전에 실패하면 평문 .env 가 든 .part 를 삭제한다. 임시 사본을 삭제하지 못해도 백업은 끝내고 알린다", async (t) => {
  const failOut = path.join(work, "fail-out");
  fs.mkdirSync(failOut);
  const readdir = fs.readdirSync;
  let reads = 0;
  t.mock.method(fs, "readdirSync", ((dir: fs.PathLike, ...rest: unknown[]) => {
    // 처음(남은 .part 정리)은 그대로, 두 번째(이전 백업 목록)에 실패한다
    if (String(dir) === failOut && ++reads === 2) throw Object.assign(new Error("읽기 실패"), { code: "EIO" });
    return (readdir as (...args: unknown[]) => unknown)(dir, ...rest);
  }) as typeof fs.readdirSync);
  await assert.rejects(makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir: failOut }, new Date(2026, 9, 20, 9, 0)), /읽기 실패/);
  t.mock.restoreAll();
  assert.deepEqual(fs.readdirSync(failOut), []);

  const tempOut = path.join(work, "temp-out");
  const rm = fs.rmSync;
  const kept: string[] = [];
  t.mock.method(fs, "rmSync", ((target: fs.PathLike, opts?: fs.RmOptions) => {
    if (path.basename(String(target)).startsWith("musicbot-backup-")) {
      kept.push(String(target));
      throw Object.assign(new Error("다른 프로그램이 열어 둠"), { code: "EBUSY" });
    }
    return rm(target, opts);
  }) as typeof fs.rmSync);
  const made = await makeFullBackup({ envFile, databaseDir: store.dir, faviconDir, backgroundDir, outDir: tempOut }, new Date(2026, 9, 21, 9, 0));
  t.mock.restoreAll();
  assert.ok(fs.existsSync(made.file));
  assert.ok(made.tempLeft.length > 0);
  for (const dir of kept) fs.rmSync(dir, { recursive: true, force: true });
});
