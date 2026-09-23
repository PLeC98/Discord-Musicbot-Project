"use strict";

// src/store/cacheManager.js — 임시 DB로 실 SQLite 경로 검증 (guild_settings 라운드트립, 퇴거 스코어링)
// initialize(dbPath) 테스트 시임 사용 — 운영 DB(database/cache.db)는 건드리지 않는다.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const DB_PATH = path.join(os.tmpdir(), `musicbot-cachemanager-test-${process.pid}.db`);

let CacheManager, audioCache, externalCaches, trackLookup;

before(() => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  CacheManager = require("../../src/store/cacheManager");
  audioCache = require("../../src/store/audioCache");
  externalCaches = require("../../src/store/externalCaches");
  trackLookup = require("../../src/store/trackLookup");
  audioCache.initialize(DB_PATH);
});

after(() => {
  audioCache.close();
  try {
    fs.unlinkSync(DB_PATH);
  } catch {}
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
  const raw = audioCache.db.prepare("SELECT dj_role_ids FROM guild_settings WHERE guild_id = 'g2'").get();
  assert.equal(raw.dj_role_ids, null);
});

test("DJ 역할: 손상된 JSON은 빈 배열로 폴백 (기동 불능 방지)", () => {
  audioCache.db.prepare("INSERT INTO guild_settings (guild_id, dj_role_ids, updated_at) VALUES ('g3', 'not-json', 0)").run();
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
  const a1 = audioCache.getFilePath("key-a");
  const a2 = audioCache.getFilePath("key-a");
  const b = audioCache.getFilePath("key-b");
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.ok(a1.endsWith(".opus"));
});

// ── 퇴거 스코어링 ────────────────────────────────────────────

test("evict: 오래되고 안 듣는 큰 파일부터 제거, 보호 키·최근 재생은 생존", async () => {
  const now = Date.now();
  const OLD = now - 90 * 86_400_000; // 90일 전
  const ins = audioCache.db.prepare("INSERT INTO audio_cache (audio_source_key, status, file_path, file_size_bytes, play_count, last_played_at, downloaded_at) VALUES (?, 'cached', ?, ?, ?, ?, ?)");

  // 생존해야 할 것들: 최근에 자주 재생
  for (let i = 0; i < 8; i++) {
    ins.run(`keep${i}`, `/nx/keep${i}.opus`, 3_000_000, 9, now, now);
  }
  // 퇴거 1순위 후보: 90일 전 다운로드, 재생 0회, 60MB
  ins.run("bad1", "/nx/bad1.opus", 60_000_000, 0, null, OLD);
  ins.run("bad2", "/nx/bad2.opus", 55_000_000, 0, null, OLD);
  // 조건은 나쁘지만 보호(재생 중/사전 캐시) 중인 키
  ins.run("protected1", "/nx/prot.opus", 60_000_000, 0, null, OLD);
  audioCache.protect("protected1");

  try {
    await audioCache.evict(); // 비보호 10개 중 상위 20% = 2개 제거

    const remaining = new Set(
      audioCache.db
        .prepare("SELECT audio_source_key FROM audio_cache")
        .all()
        .map((r) => r.audio_source_key),
    );
    assert.ok(!remaining.has("bad1"), "미재생·고령·대용량이 최우선 퇴거");
    assert.ok(!remaining.has("bad2"), "미재생·고령·대용량이 최우선 퇴거");
    assert.ok(remaining.has("protected1"), "보호 키는 조건이 나빠도 생존");
    for (let i = 0; i < 8; i++) assert.ok(remaining.has(`keep${i}`), `최근 재생 keep${i} 생존`);
  } finally {
    audioCache.unprotect("protected1");
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

test("_cleanOrphanFiles: 부팅 스윕이 중단된 다운로드 잔해를 치운다", () => {
  const { dir, stem } = makeCacheDir();
  for (const f of [`${stem}.opus.part`, `${stem}.opus.ytdl`, `${stem}.opus`]) {
    fs.writeFileSync(path.join(dir, f), "x");
  }

  const prevDir = audioCache._cacheDir;
  audioCache._cacheDir = dir;
  try {
    audioCache._cleanOrphanFiles();
  } finally {
    audioCache._cacheDir = prevDir;
  }

  const left = fs.readdirSync(dir);
  assert.deepEqual(left, [], "DB에 없는 .opus 고아 + 잔해가 모두 정리되어야 함");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("_cleanOrphanFiles: 지금 받고 있는 임시 파일은 건너뛴다", () => {
  const { dir, stem } = makeCacheDir();
  const temp = path.join(dir, `${stem}.tmp-1234-abcd.opus`);
  fs.writeFileSync(temp, "받는 중");

  const prevDir = audioCache._cacheDir;
  audioCache._cacheDir = dir;
  try {
    audioCache.protectFile(temp);
    audioCache._cleanOrphanFiles();
    assert.equal(fs.existsSync(temp), true, "받는 중인 파일은 고아가 아니다 — DB에도 없고 캐시 키로도 유도되지 않는다");

    audioCache.unprotectFile(temp);
    audioCache._cleanOrphanFiles();
    assert.equal(fs.existsSync(temp), false, "받기가 끝났거나 죽은 뒤 남은 것은 정리된다");
  } finally {
    audioCache._cacheDir = prevDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// 저장소 모듈은 인스턴스를 내보낸다. static 메서드는 인스턴스에 없으므로 외부 호출자에게 undefined다.
// md5가 static이라 직접 링크 재생이 "md5 is not a function"으로 통째로 죽어 있었다.
test("외부 호출자가 쓰는 메서드는 내보낸 인스턴스에서 호출 가능해야 한다", () => {
  for (const [mod, names] of [
    [audioCache, ["md5", "getFilePath"]],
    [trackLookup, ["resolveFromCache", "getResolvedKey", "removeResolution"]],
  ]) {
    for (const name of names) assert.equal(typeof mod[name], "function", name);
  }

  assert.equal(audioCache.md5("x"), "9dd4e461268c8034f5c8564e155c67a6");
  assert.match(audioCache.getFilePath("dl:abc"), /track_[0-9a-f]{32}\.opus$/);
});

// ── 캐시 초기화 ──────────────────────────────────────────────
// 핵심은 "무엇이 남는가"다. 서버 설정은 사용자가 손으로 넣은 유일한 값이라 다시 만들 수 없다.

// 실제 audio_cache/를 지우지 않도록 반드시 임시 디렉터리로 갈아끼운다.
// (resetCache는 _cacheDir 안의 파일을 전부 지우고, getFilePath는 모듈 상수 CACHE_DIR를 쓴다.)
function withTempCacheDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-reset-"));
  const prevDir = audioCache._cacheDir;
  audioCache._cacheDir = dir;
  try {
    return fn(dir);
  } finally {
    audioCache._cacheDir = prevDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("초기화는 파생 데이터를 비우고 서버 설정은 남긴다", () => {
  withTempCacheDir((dir) => {
    fs.writeFileSync(path.join(dir, "track_deadbeef.opus"), "x");
    runResetChecks();
    assert.equal(fs.readdirSync(dir).length, 0, "캐시 폴더가 비워진다");
  });
});

function runResetChecks() {
  CacheManager.setBotChannel("keepme", "ch-keep");
  CacheManager.setDjRoles("keepme", ["role-keep"]);

  audioCache.recordDownloadStart("yt:reset1", { title: "t", duration: 10 });
  audioCache.recordDownloadComplete("yt:reset1", audioCache.getFilePath("yt:reset1"), 1234, { title: "t" });
  trackLookup.recordTrackLookup("https://y/reset1", "youtube", "yt:reset1", "t", null, null);
  externalCaches.markAgeRestricted("reset1");
  audioCache.sessions.append("g-reset", [{ title: "t", url: "https://y/reset1" }]);

  const result = audioCache.resetCache();

  assert.equal(typeof result.removed, "number");
  assert.equal(audioCache._cacheCount(), 0, "audio_cache 비움");
  assert.equal(audioCache.sessions.load("g-reset"), null, "세션 비움");
  assert.equal(externalCaches.isAgeRestricted("reset1"), false, "연령제한 표시 비움");
  assert.equal(trackLookup.resolveFromCache("https://y/reset1").hit, false, "조회 기록 비움");

  assert.equal(CacheManager.getBotChannel("keepme"), "ch-keep", "전용 채널은 남는다");
  assert.deepEqual(CacheManager.getDjRoles("keepme"), ["role-keep"], "DJ 역할은 남는다");
}

test("초기화는 인메모리 보호도 비운다 (가리킬 행이 사라졌다)", () => {
  withTempCacheDir(() => {
    audioCache.protect("yt:live");
    audioCache.setQueuedKeys("g1", ["yt:queued"]);

    audioCache.resetCache();

    assert.equal(audioCache._liveKeys().size, 0);
  });
});

// ── 제목 출처 (title_verified) ───────────────────────────────
// 재생목록 페이지가 주는 제목은 같은 영상인데도 다를 수 있다. 그걸로 확인된 제목을 덮으면
// 한 번 고친 것이 도로 낡은 값으로 돌아간다 — 이 왕복이 실제 증상이었다.

const TL_URL = "https://www.youtube.com/watch?v=titletest";

// track_lookup은 audio_cache를 외래키로 참조한다 — 캐시 행이 먼저 있어야 한다.
const withCacheRow = (key) => audioCache.recordDownloadStart(key, { title: "x", duration: 1 });

test("확인되지 않은 제목은 확인된 제목을 덮지 못한다", () => {
  withCacheRow("yt:titletest");
  trackLookup.recordTrackLookup(TL_URL, "youtube", "yt:titletest", "정식 제목", "채널", null, { verified: true });
  assert.equal(trackLookup.getVerifiedTitle(TL_URL), "정식 제목");

  trackLookup.recordTrackLookup(TL_URL, "youtube", "yt:titletest", "낡은 재생목록 제목", "채널", null);
  assert.equal(trackLookup.getVerifiedTitle(TL_URL), "정식 제목", "재생목록 제목이 덮으면 안 된다");
});

test("확인된 제목은 확인된 제목으로 갱신된다 (영상 제목이 실제로 바뀐 경우)", () => {
  trackLookup.recordTrackLookup(TL_URL, "youtube", "yt:titletest", "새 정식 제목", "채널", null, { verified: true });
  assert.equal(trackLookup.getVerifiedTitle(TL_URL), "새 정식 제목");
});

test("확인된 적 없는 URL은 getVerifiedTitle이 null", () => {
  const url = "https://www.youtube.com/watch?v=unverif";
  withCacheRow("yt:unverif");
  trackLookup.recordTrackLookup(url, "youtube", "yt:unverif", "첫 제목", null, null);
  trackLookup.recordTrackLookup(url, "youtube", "yt:unverif", "둘째 제목", null, null);
  assert.equal(trackLookup.getVerifiedTitle(url), null, "미확인 제목은 여기 안 걸린다");
});

test("매핑(audio_source_key)은 출처와 무관하게 항상 갱신된다", () => {
  const url = "https://www.youtube.com/watch?v=remap";
  withCacheRow("yt:old");
  withCacheRow("yt:new");
  trackLookup.recordTrackLookup(url, "youtube", "yt:old", "제목", null, null, { verified: true });
  trackLookup.recordTrackLookup(url, "youtube", "yt:new", "낡은 제목", null, null);
  assert.equal(trackLookup.getResolvedKey(url), "yt:new", "재검색 결과가 매핑을 갱신해야 한다");
  assert.equal(trackLookup.getVerifiedTitle(url), "제목", "제목은 지켜진다");
});

test("행이 없는 URL은 getVerifiedTitle이 null", () => {
  assert.equal(trackLookup.getVerifiedTitle("https://www.youtube.com/watch?v=nosuch"), null);
});

// ── 오디오 길이 (duration_sec) ───────────────────────────────
// 이 행은 영상 하나를 여러 요청(스포티파이·유튜브 링크)이 공유한다. 요청 쪽 메타데이터가 아니라 오디오의 길이를 담는다.

test("다운로드 완료는 받은 오디오의 실제 길이를 요청 쪽 길이보다 우선 저장한다", () => {
  audioCache.recordDownloadStart("yt:dur1", { title: "곡", duration: 314 });
  audioCache.recordDownloadComplete("yt:dur1", audioCache.getFilePath("yt:dur1"), 100, { title: "곡", duration: 314 }, { durationSec: 312 });
  assert.equal(audioCache.lookupByAudioKey("yt:dur1").duration_sec, 312);
});

test("실제 길이를 모르면 요청 쪽 길이로 채운다", () => {
  audioCache.recordDownloadStart("yt:dur2", { title: "곡", duration: 200 });
  audioCache.recordDownloadComplete("yt:dur2", audioCache.getFilePath("yt:dur2"), 100, { title: "곡", duration: 200 });
  assert.equal(audioCache.lookupByAudioKey("yt:dur2").duration_sec, 200);
});

test("같은 오디오를 다시 받으면 앞선 요청이 남긴 길이를 실제 길이로 고친다", () => {
  audioCache.recordDownloadStart("yt:dur3", { title: "곡", duration: 314 });
  audioCache.recordDownloadComplete("yt:dur3", audioCache.getFilePath("yt:dur3"), 100, { title: "곡", duration: 314 });
  audioCache.recordDownloadStart("yt:dur3", { title: "곡", duration: 314 });
  audioCache.recordDownloadComplete("yt:dur3", audioCache.getFilePath("yt:dur3"), 100, { title: "곡", duration: 314 }, { durationSec: 312 });
  assert.equal(audioCache.lookupByAudioKey("yt:dur3").duration_sec, 312);
});

// 반드시 마지막 — DB를 닫는다
test("다운로드 기록 직후 닫혀도 예약된 캐시 정리가 DB를 다시 열지 않는다", async () => {
  audioCache.recordDownloadComplete("yt:closed1", audioCache.getFilePath("yt:closed1"), 100, { title: "t" });
  audioCache.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(audioCache._initialized, false, "닫힌 DB를 기본 경로(운영 DB)로 다시 열면 안 된다");
});
