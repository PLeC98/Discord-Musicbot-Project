// src/store/audio-cache.ts — 임시 DB로 실 SQLite 경로 검증 (파일 경로 · 퇴거 스코어링 · 고아 정리 · 초기화 · 오디오 길이)
// 임시 폴더에 DB 를 연다(stores.open) — 운영 DB(database/)는 건드리지 않는다.

import { sessions } from "../../src/store/player-sessions.ts";
import { table as guildTable } from "../../src/store/guild-settings.ts";
import * as audioCache from "../../src/store/audio-cache.ts";
import * as externalCaches from "../../src/store/external-caches.ts";
import * as trackLookup from "../../src/store/track-lookup.ts";

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cacheDb } from "../../src/store/cache-db.ts";
import * as stores from "../../src/store/stores.ts";
import config from "../../src/config/index.ts";
import sink from "../../src/infra/log/sink.ts";

const DB_DIR = path.join(os.tmpdir(), `musicbot-audiocache-test-${process.pid}`);

before(() => {
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  stores.open(DB_DIR);
  audioCache.initialize();
});

after(() => {
  audioCache.close();
  stores.close();
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 5 });
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
  const ins = cacheDb.get().prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, play_count, last_played_at, downloaded_at) VALUES (?, 'cached', ?, ?, ?, ?, ?)");

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
    // 파일 11개, 상한 10 → 목표선 90%(9개)까지 2개를 지운다
    await withCacheLimits({ maxFiles: 10 }, () => audioCache.evict());

    const remaining = new Set(
      cacheDb
        .get()
        .prepare<[], { audio_key: string }>("SELECT audio_key FROM audio_cache")
        .all()
        .map((r) => r.audio_key),
    );
    assert.ok(!remaining.has("bad1"), "미재생·고령·대용량이 최우선 퇴거");
    assert.ok(!remaining.has("bad2"), "미재생·고령·대용량이 최우선 퇴거");
    assert.ok(remaining.has("protected1"), "보호 키는 조건이 나빠도 생존");
    for (let i = 0; i < 8; i++) assert.ok(remaining.has(`keep${i}`), `최근 재생 keep${i} 생존`);
  } finally {
    audioCache.unprotect("protected1");
  }
});

// 넘친 정도와 상관없이 20% · 한 번에 50개를 지우면 큰 캐시는 50개 상한에 걸려 상한 바로 밑을 오갔다
test("evict: 넘친 만큼, 목표선(상한의 90%)까지 지운다. 한 번에 지우는 수의 상한은 없다", async () => {
  const conn = cacheDb.get();
  conn.prepare("DELETE FROM audio_cache").run();
  const ins = conn.prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, play_count, last_played_at, downloaded_at) VALUES (?, 'cached', ?, ?, 0, NULL, ?)");
  for (let i = 0; i < 120; i++) ins.run(`many${i}`, `/nx/many${i}.opus`, 1_000_000, Date.now() - i * 60_000);
  const count = () => (conn.prepare("SELECT COUNT(*) AS n FROM audio_cache").get() as { n: number }).n;

  await withCacheLimits({ maxFiles: 20 }, () => audioCache.evict());
  assert.equal(count(), 18, "120개에서 상한 20의 90%까지(102개)");

  await withCacheLimits({ maxFiles: 20 }, () => audioCache.evict());
  assert.equal(count(), 18, "목표선 아래면 지우지 않는다");

  await withCacheLimits({ maxSizeBytes: 10_000_000, maxFiles: 1000 }, () => audioCache.evict());
  assert.equal(count(), 9, "용량 상한 10MB 의 90%(9MB)까지");
  conn.prepare("DELETE FROM audio_cache").run();
});

// 복원된 대기열은 예열이 보호를 걸기까지(수 초 ~ 1분) 메모리의 보호 목록에 없다. 퇴거도 고아 청소처럼 저장된 세션을 본다
test("evict: 저장된 세션의 곡은 조건이 나빠도 지우지 않는다", async () => {
  const conn = cacheDb.get();
  conn.prepare("DELETE FROM audio_cache").run();
  const ins = conn.prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, play_count, last_played_at, downloaded_at) VALUES (?, 'cached', ?, ?, 0, NULL, ?)");
  const OLD = Date.now() - 90 * 86_400_000;
  ins.run("yt:sessvid0001", "/nx/sess.opus", 60_000_000, OLD); // 가장 지울 만한 곡
  for (let i = 0; i < 5; i++) ins.run(`fresh${i}`, `/nx/fresh${i}.opus`, 1_000_000, Date.now());
  sessions().append("g-evict", [{ title: "복원될 곡", pageUrl: "https://www.youtube.com/watch?v=sessvid0001", requestKey: "https://www.youtube.com/watch?v=sessvid0001", audioUrl: "https://www.youtube.com/watch?v=sessvid0001" }]);
  try {
    await withCacheLimits({ maxFiles: 3 }, () => audioCache.evict());
    const left = conn
      .prepare<[], { audio_key: string }>("SELECT audio_key FROM audio_cache")
      .all()
      .map((r) => r.audio_key);
    assert.ok(left.includes("yt:sessvid0001"), "세션이 쓰는 곡은 남는다");
    assert.equal(left.length, 2, "나머지로 목표선(3의 90%)을 맞춘다");
  } finally {
    sessions().removeSession("g-evict");
    conn.prepare("DELETE FROM audio_cache").run();
  }
});

// 대기열 전부를 지키면 긴 대기열이 저장된 동안 상한이 먹지 않는다(140곡 대기열 · 상한 100에서 하나도 못 지웠다)
test("evict: 저장된 세션은 지금 곡과 대기열 앞부분(미리 받기 범위)만 지킨다", async () => {
  const conn = cacheDb.get();
  conn.prepare("DELETE FROM audio_cache").run();
  const ins = conn.prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, play_count, last_played_at, downloaded_at) VALUES (?, 'cached', ?, ?, 0, NULL, ?)");
  const OLD = Date.now() - 90 * 86_400_000;
  const id = (i: number) => `qvid${String(i).padStart(7, "0")}`; // 11자 영상 id
  const url = (i: number) => `https://www.youtube.com/watch?v=${id(i)}`;
  for (let i = 0; i < 9; i++) ins.run(`yt:${id(i)}`, `/nx/${id(i)}.opus`, 1_000_000, OLD);
  const tracks = Array.from({ length: 9 }, (_, i) => ({ title: `곡${i}`, pageUrl: url(i), requestKey: url(i), audioUrl: url(i) }));
  sessions().append("g-front", tracks);
  const from = sink.buffer.length;
  try {
    // 대기열 9곡, 앞 5곡만 지킨다. 상한 1 → 지킬 수 있는 것을 빼고 전부 지운다
    await withCacheLimits({ maxFiles: 1 }, () => audioCache.evict());
    const left = conn
      .prepare<[], { audio_key: string }>("SELECT audio_key FROM audio_cache ORDER BY audio_key")
      .all()
      .map((r) => r.audio_key);
    assert.equal(config.preload.ahead, 5);
    assert.deepEqual(
      left,
      [0, 1, 2, 3, 4].map((i) => `yt:${id(i)}`),
    );
    const line = sink.buffer.slice(from).find((e) => e.text.startsWith("오디오 캐시 4개를 지웠습니다"));
    assert.equal(line?.text, "오디오 캐시 4개를 지웠습니다 (5개 남음, 5MB) - 목표선까지 내려가지 못했습니다 (재생 중 · 대기열 앞 곡 5개는 지키고)");
  } finally {
    sessions().removeSession("g-front");
    conn.prepare("DELETE FROM audio_cache").run();
  }
});

test("evict: 지울 수 있는 곡이 없어도 결과 줄을 남긴다", async () => {
  const conn = cacheDb.get();
  conn.prepare("DELETE FROM audio_cache").run();
  conn.prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, play_count, last_played_at, downloaded_at) VALUES ('onlylive', 'cached', '/nx/onlylive.opus', 1000000, 0, NULL, 0)").run();
  audioCache.protect("onlylive");
  const from = sink.buffer.length;
  try {
    await withCacheLimits({ maxFiles: 0 }, () => audioCache.evict());
    assert.ok(sink.buffer.slice(from).some((e) => e.text === "오디오 캐시 0개를 지웠습니다 (1개 남음, 1MB) - 목표선까지 내려가지 못했습니다 (재생 중 · 대기열 앞 곡 1개는 지키고)"));
  } finally {
    audioCache.unprotect("onlylive");
    conn.prepare("DELETE FROM audio_cache").run();
  }
});

// 다른 프로그램(탐색기 등)이 파일을 쥐고 있으면 지우기가 풀릴 때까지 멈춘다. 동기로 지우면 봇 전체가 같이 멈췄다
test("evict: 응답 없는 파일은 기다리지 않고 행을 남기며, 이번 실행 동안 다시 지우지 않는다", async () => {
  const conn = cacheDb.get();
  conn.prepare("DELETE FROM audio_cache").run();
  const ins = conn.prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, play_count, last_played_at, downloaded_at) VALUES (?, 'cached', ?, ?, 0, NULL, ?)");
  const OLD = Date.now() - 90 * 86_400_000;
  ins.run("stuck", "/nx/stuck.opus", 60_000_000, OLD); // 가장 먼저 지울 곡
  for (let i = 0; i < 5; i++) ins.run(`ok${i}`, `/nx/ok${i}.opus`, 1_000_000, Date.now() - i * 60_000);
  const calls: string[] = [];
  audioCache._setRemoval({
    timeoutMs: 50,
    unlink: (target) => {
      calls.push(path.basename(target));
      return target.endsWith("stuck.opus") ? new Promise(() => {}) : Promise.resolve();
    },
  });
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  const from = sink.buffer.length;
  const left = () =>
    conn
      .prepare<[], { audio_key: string }>("SELECT audio_key FROM audio_cache")
      .all()
      .map((r) => r.audio_key);
  try {
    await withCacheLimits({ maxFiles: 3 }, () => audioCache.evict());
    assert.ok(ticks > 0, "기다리는 동안 이벤트 루프가 돈다");
    assert.ok(left().includes("stuck"), "못 지운 파일의 행은 남는다");
    assert.equal(left().length, 2, "나머지를 지워 목표선(3의 90%) 아래로: stuck 과 하나");
    const logs = sink.buffer.slice(from).map((e) => e.text);
    assert.ok(logs.some((t) => t.startsWith("캐시 파일 지우기가 0.05초 안에 끝나지 않아 이번 실행 동안 건너뜁니다")));
    assert.ok(logs.some((t) => t.includes(" - 1개는 지우지 못했습니다")));

    calls.length = 0;
    await withCacheLimits({ maxFiles: 1 }, () => audioCache.evict());
    assert.ok(!calls.includes("stuck.opus"), "같은 실행에서 다시 부르지 않는다(지우기 하나가 스레드 풀 한 칸을 잡는다)");
    assert.deepEqual(left(), ["stuck"]);
  } finally {
    clearInterval(timer);
    audioCache._setRemoval();
    conn.prepare("DELETE FROM audio_cache").run();
  }
});

test("evictIfNeeded: 넘은 상한을 알리고, 겹쳐 불러도 한 번만 돈다", async () => {
  const conn = cacheDb.get();
  conn.prepare("DELETE FROM audio_cache").run();
  const ins = conn.prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, play_count, last_played_at, downloaded_at) VALUES (?, 'cached', ?, ?, 0, NULL, ?)");
  for (let i = 0; i < 6; i++) ins.run(`n${i}`, `/nx/n${i}.opus`, 1_000_000, Date.now() - i * 60_000);
  let unlinks = 0;
  audioCache._setRemoval({
    unlink: async () => {
      unlinks++;
    },
  });
  const from = sink.buffer.length;
  try {
    await withCacheLimits({ maxFiles: 5 }, () => Promise.all([audioCache.evictIfNeeded(), audioCache.evictIfNeeded()]));
    const lines = sink.buffer.slice(from).filter((e) => e.text.startsWith("오디오 캐시가 상한을 넘었습니다"));
    assert.deepEqual(
      lines.map((e) => e.text),
      ["오디오 캐시가 상한을 넘었습니다 (파일 6개 / 5개) - 상한의 90%까지 정리합니다."],
      "넘은 것만 적는다(용량은 넘지 않았다)",
    );
    assert.equal(unlinks, 2, "6개 → 4개(5의 90%). 겹친 부름이 같은 행을 또 지우지 않는다");
  } finally {
    audioCache._setRemoval();
    conn.prepare("DELETE FROM audio_cache").run();
  }
});

test("onStartup: 퇴거를 기다리지 않는다(복원이 막히지 않게)", async () => {
  const conn = cacheDb.get();
  conn.prepare("DELETE FROM audio_cache").run();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-startup-"));
  const prevDir = audioCache.cacheDir();
  audioCache._setCacheDir(dir);
  const ins = conn.prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, play_count, last_played_at, downloaded_at) VALUES (?, 'cached', ?, ?, 0, NULL, ?)");
  for (let i = 0; i < 3; i++) {
    const file = path.join(dir, `s${i}.opus`);
    fs.writeFileSync(file, "x");
    ins.run(`s${i}`, file, 1, Date.now());
  }
  // 첫 지우기는 풀어 줄 때까지 멈춘다
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let first = true;
  audioCache._setRemoval({
    timeoutMs: 60_000,
    unlink: () => {
      if (!first) return Promise.resolve();
      first = false;
      return held;
    },
  });
  try {
    await withCacheLimits({ maxFiles: 1 }, async () => {
      const waited = new Promise((resolve) => setTimeout(() => resolve("기다림"), 1000));
      const startup = await Promise.race([audioCache.onStartup().then(() => "끝남"), waited]);
      release();
      await audioCache.evictIfNeeded(); // 뒤에서 돌던 퇴거를 마저 기다린다
      assert.equal(startup, "끝남", "지우기가 풀리지 않았는데 끝난다");
      assert.equal(first, false, "퇴거는 뒤에서 시작했다");
    });
  } finally {
    release();
    audioCache._setRemoval();
    audioCache._setCacheDir(prevDir);
    conn.prepare("DELETE FROM audio_cache").run();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

// 상한만 잠시 바꾼다(디스크 여유 조건은 끈다)
async function withCacheLimits(limits: { maxFiles?: number; maxSizeBytes?: number }, fn: () => Promise<unknown>) {
  const saved = { ...config.cache };
  Object.assign(config.cache, { maxSizeBytes: 1e15, minFreeDiskBytes: 0, evictTargetPercent: 90, ...limits });
  try {
    await fn();
  } finally {
    Object.assign(config.cache, saved);
  }
}

// ── 중단된 다운로드 잔해 정리 ──────────────────────────────────────
// 회귀 대상: 라이브 매칭 등으로 다운로드가 중단되면 yt-dlp가 track_<md5>.opus.part 등을 남기는데,
// _cleanOrphanFiles가 .opus만 훑어서 이 부스러기들이 영구 잔류하고 용량만 먹던 문제.

import crypto from "node:crypto";

function makeCacheDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-partials-"));
  const md5 = crypto.createHash("md5").update("k").digest("hex");
  return { dir, opus: path.join(dir, `track_${md5}.opus`), stem: `track_${md5}` };
}

test("_cleanOrphanFiles: 부팅 스윕이 중단된 다운로드 잔해를 치운다", async () => {
  const { dir, stem } = makeCacheDir();
  for (const f of [`${stem}.opus.part`, `${stem}.opus.ytdl`, `${stem}.opus`]) {
    fs.writeFileSync(path.join(dir, f), "x");
  }

  const prevDir = audioCache.cacheDir();
  audioCache._setCacheDir(dir);
  try {
    await audioCache._cleanOrphanFiles();
  } finally {
    audioCache._setCacheDir(prevDir);
  }

  const left = fs.readdirSync(dir);
  assert.deepEqual(left, [], "DB에 없는 .opus 고아 + 잔해가 모두 정리되어야 함");

  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

test("_cleanOrphanFiles: 지금 받고 있는 임시 파일은 건너뛴다", async () => {
  const { dir, stem } = makeCacheDir();
  const temp = path.join(dir, `${stem}.tmp-1234-abcd.opus`);
  fs.writeFileSync(temp, "받는 중");

  const prevDir = audioCache.cacheDir();
  audioCache._setCacheDir(dir);
  try {
    audioCache.protectFile(temp);
    await audioCache._cleanOrphanFiles();
    assert.equal(fs.existsSync(temp), true, "받는 중인 파일은 고아가 아니다 — DB에도 없고 캐시 키로도 유도되지 않는다");

    audioCache.unprotectFile(temp);
    await audioCache._cleanOrphanFiles();
    assert.equal(fs.existsSync(temp), false, "받기가 끝났거나 죽은 뒤 남은 것은 정리된다");
  } finally {
    audioCache._setCacheDir(prevDir);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

// 밖에서 부르는 함수가 내보내져 있는가
test("외부 호출자가 쓰는 함수를 내보낸다", () => {
  const modules: Array<[object, string[]]> = [
    [audioCache, ["getFilePath"]],
    [trackLookup, ["resolveFromCache", "getAudioUrl", "removeResolution"]],
  ];
  for (const [mod, names] of modules) {
    for (const name of names) assert.equal(typeof Reflect.get(mod, name), "function", name);
  }

  assert.match(audioCache.getFilePath("dl:abc"), /track_[0-9a-f]{32}\.opus$/);
});

// ── 캐시 초기화 ──────────────────────────────────────────────
// 핵심은 "무엇이 남는가"다. 서버 설정은 사용자가 손으로 넣은 유일한 값이라 다시 만들 수 없다.

// 실제 audio_cache/를 지우지 않도록 반드시 임시 디렉터리로 갈아끼운다.
// (resetCache는 캐시 폴더 안의 파일을 전부 지운다.)
async function withTempCacheDir(fn: (dir: string) => unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-reset-"));
  const prevDir = audioCache.cacheDir();
  audioCache._setCacheDir(dir);
  try {
    return await fn(dir);
  } finally {
    audioCache._setCacheDir(prevDir);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

test("초기화는 파생 데이터를 비우고 서버 설정은 남긴다", async () => {
  await withTempCacheDir(async (dir: string) => {
    fs.writeFileSync(path.join(dir, "track_deadbeef.opus"), "x");
    await runResetChecks();
    assert.equal(fs.readdirSync(dir).length, 0, "캐시 폴더가 비워진다");
  });
});

async function runResetChecks() {
  guildTable.setBotChannel("keepme", "ch-keep");
  guildTable.setDjRoles("keepme", ["role-keep"]);

  audioCache.recordDownloadStart("yt:reset1", { title: "t", duration: 10 });
  audioCache.recordDownloadComplete("yt:reset1", audioCache.getFilePath("yt:reset1"), 1234, { title: "t" });
  trackLookup.recordTrackLookup({ requestKey: "https://y/reset1", pageUrl: "https://y/reset1", audioUrl: "https://www.youtube.com/watch?v=reset1", platform: "youtube", title: "t" });
  externalCaches.markAgeRestricted("reset1");
  sessions().append("g-reset", [{ title: "t", pageUrl: "https://y/reset1", requestKey: "https://y/reset1" }]);

  const result = await audioCache.resetCache();

  assert.equal(typeof result.removed, "number");
  assert.equal(audioCache._cacheCount(), 0, "audio_cache 비움");
  assert.notEqual(sessions().load("g-reset"), null, "저장된 대기열은 다른 파일(state.db)이라 남는다");
  assert.equal(externalCaches.isAgeRestricted("reset1"), false, "연령제한 표시 비움");
  assert.equal(trackLookup.resolveFromCache("https://y/reset1").hit, false, "조회 기록 비움");

  assert.equal(guildTable.getBotChannel("keepme"), "ch-keep", "전용 채널은 남는다");
  assert.deepEqual(guildTable.getDjRoles("keepme"), ["role-keep"], "DJ 역할은 남는다");
}

test("초기화는 인메모리 보호도 비운다 (가리킬 행이 사라졌다)", async () => {
  await withTempCacheDir(async () => {
    audioCache.protect("yt:live");
    audioCache.setQueuedKeys("g1", ["yt:queued"]);

    await audioCache.resetCache();

    assert.equal(audioCache._liveKeys().size, 0);
  });
});

// ── 오디오 길이 (duration_sec) ───────────────────────────────
// 이 행은 영상 하나를 여러 요청(스포티파이·유튜브 링크)이 공유한다. 요청 쪽 메타데이터가 아니라 오디오의 길이를 담는다.

test("다운로드 완료는 받은 오디오의 실제 길이를 요청 쪽 길이보다 우선 저장한다", () => {
  audioCache.recordDownloadStart("yt:dur1", { title: "곡", duration: 314 });
  audioCache.recordDownloadComplete("yt:dur1", audioCache.getFilePath("yt:dur1"), 100, { title: "곡", duration: 314 }, { durationSec: 312 });
  assert.equal(audioCache.lookupByAudioKey("yt:dur1")?.duration_sec, 312);
});

test("실제 길이를 모르면 요청 쪽 길이로 채운다", () => {
  audioCache.recordDownloadStart("yt:dur2", { title: "곡", duration: 200 });
  audioCache.recordDownloadComplete("yt:dur2", audioCache.getFilePath("yt:dur2"), 100, { title: "곡", duration: 200 });
  assert.equal(audioCache.lookupByAudioKey("yt:dur2")?.duration_sec, 200);
});

test("같은 오디오를 다시 받으면 앞선 요청이 남긴 길이를 실제 길이로 고친다", () => {
  audioCache.recordDownloadStart("yt:dur3", { title: "곡", duration: 314 });
  audioCache.recordDownloadComplete("yt:dur3", audioCache.getFilePath("yt:dur3"), 100, { title: "곡", duration: 314 });
  audioCache.recordDownloadStart("yt:dur3", { title: "곡", duration: 314 });
  audioCache.recordDownloadComplete("yt:dur3", audioCache.getFilePath("yt:dur3"), 100, { title: "곡", duration: 314 }, { durationSec: 312 });
  assert.equal(audioCache.lookupByAudioKey("yt:dur3")?.duration_sec, 312);
});

// 반드시 마지막 — DB를 닫는다
test("다운로드 기록 직후 닫혀도 예약된 캐시 정리가 DB를 다시 열지 않는다", async () => {
  audioCache.recordDownloadComplete("yt:closed1", audioCache.getFilePath("yt:closed1"), 100, { title: "t" });
  audioCache.close();
  stores.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cacheDb.isOpen(), false, "닫힌 DB를 기본 경로(운영 DB)로 다시 열면 안 된다");
});
