"use strict";

// src/CacheManager.js — 임시 DB로 실 SQLite 경로 검증 (guild_settings 마이그레이션/라운드트립, 퇴거 스코어링)
// initialize(dbPath) 테스트 시임 사용 — 운영 DB(database/cache.db)는 건드리지 않는다.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const DB_PATH = path.join(os.tmpdir(), `musicbot-cachemanager-test-${process.pid}.db`);

let CacheManager;

before(() => {
  // 구(단일 DJ 역할) 스키마 DB를 미리 만들어 레거시 마이그레이션까지 함께 검증
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const pre = new Database(DB_PATH);
  pre.exec(`
    CREATE TABLE guild_settings (
      guild_id        TEXT PRIMARY KEY,
      bot_channel_id  TEXT,
      dj_role_id      TEXT,
      updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
    INSERT INTO guild_settings (guild_id, bot_channel_id, dj_role_id) VALUES
      ('legacy1', 'ch1', 'role111'),
      ('legacy2', 'ch2', NULL);
  `);
  pre.close();

  CacheManager = require("../src/CacheManager");
  CacheManager.initialize(DB_PATH);
});

after(() => {
  CacheManager.close();
  try {
    fs.unlinkSync(DB_PATH);
  } catch {}
});

// ── guild_settings: 레거시 마이그레이션 ──────────────────────

test("마이그레이션: 구 dj_role_id 단일 값 → dj_role_ids JSON 배열", () => {
  assert.deepEqual(CacheManager.getDjRoles("legacy1"), ["role111"]);
});

test("마이그레이션: 미설정 행은 그대로 미설정", () => {
  assert.deepEqual(CacheManager.getDjRoles("legacy2"), []);
});

test("마이그레이션: bot_channel_id 무손상", () => {
  assert.equal(CacheManager.getBotChannel("legacy1"), "ch1");
  assert.equal(CacheManager.getBotChannel("legacy2"), "ch2");
});

// ── guild_settings: DJ 역할 라운드트립 ───────────────────────

test("DJ 역할: 복수 저장/조회/해제", () => {
  CacheManager.setDjRoles("g1", ["a", "b", "c"]);
  assert.deepEqual(CacheManager.getDjRoles("g1"), ["a", "b", "c"]);

  CacheManager.setDjRoles("g1", ["a"]);
  assert.deepEqual(CacheManager.getDjRoles("g1"), ["a"], "덮어쓰기");

  CacheManager.clearDjRoles("g1");
  assert.deepEqual(CacheManager.getDjRoles("g1"), []);
});

test("DJ 역할: 빈 배열 저장 = 미설정(NULL)과 동일", () => {
  CacheManager.setDjRoles("g2", []);
  assert.deepEqual(CacheManager.getDjRoles("g2"), []);
  const raw = CacheManager.db.prepare("SELECT dj_role_ids FROM guild_settings WHERE guild_id = 'g2'").get();
  assert.equal(raw.dj_role_ids, null);
});

test("DJ 역할: 손상된 JSON은 빈 배열로 폴백 (기동 불능 방지)", () => {
  CacheManager.db.prepare("INSERT INTO guild_settings (guild_id, dj_role_ids, updated_at) VALUES ('g3', 'not-json', 0)").run();
  assert.deepEqual(CacheManager.getDjRoles("g3"), []);
});

test("DJ 역할: 미지정 서버는 빈 배열", () => {
  assert.deepEqual(CacheManager.getDjRoles("no-such-guild"), []);
});

// ── guild_settings: 봇 채널 ──────────────────────────────────

test("봇 채널: 저장/조회/해제 — DJ 설정과 같은 행에서 서로 무손상", () => {
  CacheManager.setDjRoles("g4", ["r1"]);
  CacheManager.setBotChannel("g4", "ch4");
  assert.equal(CacheManager.getBotChannel("g4"), "ch4");
  assert.deepEqual(CacheManager.getDjRoles("g4"), ["r1"]);

  CacheManager.clearBotChannel("g4");
  assert.equal(CacheManager.getBotChannel("g4"), null);
  assert.deepEqual(CacheManager.getDjRoles("g4"), ["r1"], "채널 해제가 DJ 설정을 지우지 않음");
});

// ── 파일 경로 ────────────────────────────────────────────────

test("getFilePath: 같은 키 → 같은 경로 (결정적), 다른 키 → 다른 경로", () => {
  const a1 = CacheManager.getFilePath("key-a");
  const a2 = CacheManager.getFilePath("key-a");
  const b = CacheManager.getFilePath("key-b");
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.ok(a1.endsWith(".opus"));
});

// ── 퇴거 스코어링 ────────────────────────────────────────────

test("evict: 오래되고 안 듣는 큰 파일부터 제거, 보호 키·최근 재생은 생존", async () => {
  const now = Date.now();
  const OLD = now - 90 * 86_400_000; // 90일 전
  const ins = CacheManager.db.prepare("INSERT INTO audio_cache (audio_source_key, status, file_path, file_size_bytes, play_count, last_played_at, downloaded_at) VALUES (?, 'cached', ?, ?, ?, ?, ?)");

  // 생존해야 할 것들: 최근에 자주 재생
  for (let i = 0; i < 8; i++) {
    ins.run(`keep${i}`, `/nx/keep${i}.opus`, 3_000_000, 9, now, now);
  }
  // 퇴거 1순위 후보: 90일 전 다운로드, 재생 0회, 60MB
  ins.run("bad1", "/nx/bad1.opus", 60_000_000, 0, null, OLD);
  ins.run("bad2", "/nx/bad2.opus", 55_000_000, 0, null, OLD);
  // 조건은 나쁘지만 보호(재생 중/사전 캐시) 중인 키
  ins.run("protected1", "/nx/prot.opus", 60_000_000, 0, null, OLD);
  CacheManager.protect("protected1");

  try {
    await CacheManager.evict(); // 비보호 10개 중 상위 20% = 2개 제거

    const remaining = new Set(
      CacheManager.db
        .prepare("SELECT audio_source_key FROM audio_cache")
        .all()
        .map((r) => r.audio_source_key),
    );
    assert.ok(!remaining.has("bad1"), "미재생·고령·대용량이 최우선 퇴거");
    assert.ok(!remaining.has("bad2"), "미재생·고령·대용량이 최우선 퇴거");
    assert.ok(remaining.has("protected1"), "보호 키는 조건이 나빠도 생존");
    for (let i = 0; i < 8; i++) assert.ok(remaining.has(`keep${i}`), `최근 재생 keep${i} 생존`);
  } finally {
    CacheManager.unprotect("protected1");
  }
});

// ── 중단된 다운로드 잔해 정리 ──────────────────────────────────────
// 회귀 대상: 라이브 매칭 등으로 다운로드가 중단되면 yt-dlp가 track_<md5>.opus.part 등을 남기는데,
// _cleanOrphanFiles가 .opus만 훑어서 이 부스러기들이 영구 잔류하고 용량만 먹던 문제.

const crypto = require("node:crypto");

function makeCacheDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-partials-"));
  const md5 = crypto.createHash("md5").update("k").digest("hex");
  return { dir, opus: path.join(dir, `track_${md5}.opus`), stem: `track_${md5}` };
}

test("cleanPartials: 같은 트랙의 부스러기만 지우고 완성본·남의 파일은 남긴다", () => {
  const { dir, opus, stem } = makeCacheDir();
  const other = `track_${"a".repeat(32)}`;
  const files = [`${stem}.opus`, `${stem}.opus.part`, `${stem}.opus.part-Frag0`, `${stem}.opus.ytdl`, `${stem}.webm`, `${other}.opus`, `${other}.opus.part`, "unrelated.txt"];
  for (const f of files) fs.writeFileSync(path.join(dir, f), "x");

  const removed = CacheManager.cleanPartials(opus);
  assert.equal(removed, 4, "부스러기 4개(.part/.part-Frag0/.ytdl/.webm)만 삭제");

  const left = new Set(fs.readdirSync(dir));
  assert.ok(left.has(`${stem}.opus`), "완성본은 남긴다 — 퇴거/고아정리가 따로 관리");
  assert.ok(left.has(`${other}.opus`) && left.has(`${other}.opus.part`), "다른 트랙은 건드리지 않는다");
  assert.ok(left.has("unrelated.txt"), "캐시 명명 규칙 밖의 파일은 건드리지 않는다");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("cleanPartials: 캐시 명명 규칙에 맞지 않는 경로는 무시 (오삭제 방지)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-partials-"));
  fs.writeFileSync(path.join(dir, "important.db"), "x");
  fs.writeFileSync(path.join(dir, "important.db.part"), "x");

  assert.equal(CacheManager.cleanPartials(path.join(dir, "important.db")), 0);
  assert.equal(CacheManager.cleanPartials(""), 0);
  assert.equal(CacheManager.cleanPartials(null), 0);
  assert.equal(fs.readdirSync(dir).length, 2, "아무것도 지우면 안 된다");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("_cleanOrphanFiles: 부팅 스윕이 중단된 다운로드 잔해를 치운다", () => {
  const { dir, stem } = makeCacheDir();
  for (const f of [`${stem}.opus.part`, `${stem}.opus.ytdl`, `${stem}.opus`]) {
    fs.writeFileSync(path.join(dir, f), "x");
  }

  const prevDir = CacheManager._cacheDir;
  CacheManager._cacheDir = dir;
  try {
    CacheManager._cleanOrphanFiles();
  } finally {
    CacheManager._cacheDir = prevDir;
  }

  const left = fs.readdirSync(dir);
  assert.deepEqual(left, [], "DB에 없는 .opus 고아 + 잔해가 모두 정리되어야 함");

  fs.rmSync(dir, { recursive: true, force: true });
});
