// 오디오 캐시. 받아 둔 파일 · 보호 · 퇴거 · 오디오 장부(audio_cache) · 기동 정리 · 통계

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "cache" });
import path from "path";
import fs from "fs";
import config from "../../config.ts";
import { md5, audioKeyOf } from "../rules/audioKeyOf.ts";
import { sessions } from "./playerSessions.ts";
import * as db from "./db.ts";
import { messageOf } from "../rules/errorKind.ts";

const CACHE_DIR = path.join(import.meta.dirname, "..", "..", "audio_cache");

// 제거 점수 가중치
const W_RECENCY = 0.4;
const W_FREQUENCY = 0.4;
const W_SIZE = 0.2;
// 고정 크기 기준: opus 128kbps ≈ 1 MB/분 → 50 MB ≈ 50분
const SIZE_REF_BYTES = 50 * 1024 * 1024;

/** audio_cache 한 줄(표는 db.ts) */
type AudioRow = {
  audio_key: string;
  status: "downloading" | "cached" | "error";
  file_path: string | null;
  file_size_bytes: number | null;
  duration_sec: number | null;
  title: string | null;
  channel: string | null;
  audio_version: string | null;
  version_checked_at: number | null;
  play_count: number;
  last_played_at: number | null;
  downloaded_at: number | null;
  created_at: number;
  updated_at: number;
};
// 장부에 적을 곡 정보. 여기서 읽는 칸만
type TrackMeta = { title?: string | null; artist?: string | null; channel?: string | null; duration?: number | null };

const protectedKeys = new Set<string>(); // 현재 재생 중인 audio_key
const protectedFiles = new Set<string>(); // 지금 받고 있는 임시 파일 경로. 기동 스윕이 건드리면 안 된다
const queuedKeys = new Map<string, Set<string>>(); // guildId -> Set<audio_key>. 대기열 앞부분
let evictInterval: NodeJS.Timeout | null = null;
// 캐시 파일이 놓이는 곳. 테스트가 _setCacheDir 로 갈아끼우면 실제 폴더를 건드리지 않는다.
// 파일을 만지는 코드는 반드시 이 값을 거쳐야 한다(모듈 상수를 직접 쓰면 격리가 새어나간다).
let dir = CACHE_DIR;

// 열기 전에 부르면 던진다
const conn = () => db.get();

/** 캐시 파일이 놓이는 폴더 */
const cacheDir = () => dir;

// 테스트 시임. 임시 폴더로 바꾼다
function _setCacheDir(next: string) {
  dir = next;
}

// 초기화. dbPath는 테스트 주입용(임시 DB), 운영은 항상 기본 경로
function initialize(dbPath = db.DB_PATH) {
  if (db.isOpen()) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db.open(dbPath, { cacheDir: dir });
  startPeriodicEviction();
  log.info({ tags: ["startup"] }, "SQLite 캐시 DB 준비 완료");
}

/** audio_key에 대한 결정적 파일 경로 */
function getFilePath(audioKey: string) {
  return path.join(dir, `track_${md5(audioKey)}.opus`);
}

// 라이브 보호 (재생 중/사전 캐시된 트랙)

/** 키를 사용 중으로 표시. 제거 대상에서 건너뜀 */
function protect(audioKey: string | null | undefined) {
  if (audioKey) protectedKeys.add(audioKey);
}

/** 더 이상 필요하지 않은 키 해제 */
function unprotect(audioKey: string | null | undefined) {
  if (audioKey) protectedKeys.delete(audioKey);
}

/**
 * 파일 하나를 정리 대상에서 뺀다. 받는 중인 임시 파일용.
 * 키가 아니라 경로로 보호하는 이유: 임시 파일은 DB에도 없고 캐시 키로도 유도되지 않는다.
 */
function protectFile(filepath: string | null | undefined) {
  if (filepath) protectedFiles.add(path.resolve(filepath));
}

function unprotectFile(filepath: string | null | undefined) {
  if (filepath) protectedFiles.delete(path.resolve(filepath));
}

/**
 * 길드의 대기열 보호 집합을 통째로 교체한다.
 *
 * 추가·삭제를 개별로 추적하지 않는 것이 요점이다. 대기열이 바뀔 때마다 전체를 다시 계산해
 * 넘기므로 해제를 빠뜨려 보호가 남는 누수가 생기지 않는다.
 *
 * 길드별로 나누는 이유: 두 길드가 같은 곡을 대기열에 두었을 때 한쪽이 비운다고
 * 다른 쪽 보호까지 풀리면 안 된다.
 */
function setQueuedKeys(guildId: string | null | undefined, keys: Array<string | null | undefined> | null | undefined) {
  if (!guildId) return;
  const set = new Set((keys || []).filter((k): k is string => Boolean(k)));
  if (set.size === 0) queuedKeys.delete(guildId);
  else queuedKeys.set(guildId, set);
}

/** 재생 중 + 모든 길드의 대기열. 퇴거에서 제외할 키 전부 */
function liveKeys() {
  const keys = new Set(protectedKeys);
  for (const set of queuedKeys.values()) for (const k of set) keys.add(k);
  return keys;
}

/** audio_key로 원시 조회 */
function lookupByAudioKey(audioKey: string): AudioRow | null {
  return (conn().prepare("SELECT * FROM audio_cache WHERE audio_key = ?").get(audioKey) as AudioRow | undefined) || null;
}

// 쓰기. audio_cache

function recordDownloadStart(audioKey: string, track: TrackMeta | null | undefined) {
  const now = Date.now();
  conn()
    .prepare(
      `
          INSERT INTO audio_cache
              (audio_key, status, duration_sec, title, channel, created_at, updated_at)
          VALUES (?, 'downloading', ?, ?, ?, ?, ?)
          ON CONFLICT(audio_key) DO UPDATE SET
              status     = 'downloading',
              updated_at = excluded.updated_at
      `,
    )
    .run(audioKey, track?.duration || null, track?.title || null, track?.artist || track?.channel || null, now, now);
}

// durationSec: 받은 오디오의 실제 길이. 모를 때만 track.duration(요청 쪽 메타데이터)으로 채운다
// audioVersion: 받은 음원의 판(media/audioVersion). 모르면 null
function recordDownloadComplete(audioKey: string, filePath: string, fileSizeBytes: number, track: TrackMeta | null | undefined, { durationSec = null, audioVersion = null }: { durationSec?: number | null; audioVersion?: string | null } = {}) {
  const now = Date.now();
  conn()
    .prepare(
      `
          UPDATE audio_cache SET
              status              = 'cached',
              file_path           = ?,
              file_size_bytes     = ?,
              title               = COALESCE(?, title),
              channel             = COALESCE(?, channel),
              duration_sec        = COALESCE(?, duration_sec),
              audio_version       = ?,
              version_checked_at  = ?,
              downloaded_at       = ?,
              updated_at          = ?
          WHERE audio_key = ?
      `,
    )
    .run(filePath, fileSizeBytes, track?.title || null, track?.artist || track?.channel || null, durationSec || track?.duration || null, audioVersion, audioVersion ? now : null, now, now, audioKey);

  // 다운로드 후 제거 검사 (논블로킹). 그 사이 닫혔으면 돌지 않는다. evictIfNeeded는 닫힌 DB를 기본 경로로 다시 연다
  setImmediate(() => {
    if (db.isOpen()) evictIfNeeded().catch(() => {});
  });
}

function recordError(audioKey: string) {
  conn().prepare(`UPDATE audio_cache SET status = 'error', updated_at = ? WHERE audio_key = ?`).run(Date.now(), audioKey);
}

function recordPlayback(audioKey: string) {
  const now = Date.now();
  conn()
    .prepare(
      `
          UPDATE audio_cache SET play_count = play_count + 1, last_played_at = ?, updated_at = ?
          WHERE audio_key = ?
      `,
    )
    .run(now, now, audioKey);
}

/**
 * 저장된 세션에서 지켜야 할 캐시 파일. 기동 시 고아 파일 청소가 쓴다.
 * 그 시점엔 플레이어가 아직 없으므로 저장된 현재곡·대기열이 유일한 근거다.
 */
function getProtectedCacheFiles() {
  const files = new Set<string>();
  for (const audioUrl of sessions().liveAudioUrls()) {
    const key = audioKeyOf(audioUrl);
    if (key) files.add(path.resolve(getFilePath(key)));
  }
  return files;
}

// 시작 시 정리

async function onStartup() {
  // 1. 다운로드 중 중단된 행 재설정
  const resetCount = conn().prepare("UPDATE audio_cache SET status = 'error', updated_at = ? WHERE status = 'downloading'").run(Date.now()).changes;
  if (resetCount > 0) log.info(`이전 실행에서 중단된 다운로드 ${resetCount}건 정리 완료`);

  // 2. 캐시된 행의 파일이 디스크에 아직 있는지 확인
  const cachedRows = conn().prepare("SELECT audio_key, file_path FROM audio_cache WHERE status = 'cached'").all() as Array<Pick<AudioRow, "audio_key" | "file_path">>;
  let orphanDbCount = 0;
  for (const row of cachedRows) {
    const fp = row.file_path || getFilePath(row.audio_key);
    if (!fs.existsSync(fp)) {
      conn().prepare("UPDATE audio_cache SET status = 'error', file_path = NULL, updated_at = ? WHERE audio_key = ?").run(Date.now(), row.audio_key);
      orphanDbCount++;
    }
  }
  if (orphanDbCount > 0) log.info(`오디오 캐시 파일이 누락된 항목 ${orphanDbCount}건 기록 완료`);

  // 3. DB에서 추적하지 않는 오디오 파일 삭제
  cleanOrphanFiles();

  // 4. 제한 초과 시 제거
  await evictIfNeeded();
}

/**
 * 캐시를 초기 상태로 되돌린다. 오디오 파일 전부와 파생 데이터 테이블.
 *
 * `guild_settings`(전용 채널·DJ 역할·SponsorBlock 설정)는 남긴다. 사용자가 손으로 넣은
 * 유일한 값이라 다시 만들 수 없고, 나머지는 전부 다시 받거나 다시 계산할 수 있다.
 *
 * 재생 중인 파일은 열려 있어 지워지지 않을 수 있다(윈도우). 실패해도 멈추지 않고 세어서
 * 돌려준다. 재생은 이미 연 핸들로 계속되므로 끊기지 않는다.
 */
function resetCache() {
  const before = { files: cacheCount(), bytes: cacheSize() };

  // 파일을 먼저 지우고, 잠겨서 못 지운 것의 행은 남긴다. 행만 지우고 파일을 남기면 DB 가 모르는 파일이 된다.
  const rows = conn().prepare("SELECT audio_key, file_path FROM audio_cache").all() as Array<Pick<AudioRow, "audio_key" | "file_path">>;
  const pathOf = (row: Pick<AudioRow, "audio_key" | "file_path">) => path.resolve(row.file_path || getFilePath(row.audio_key));
  const keptKeys = new Set<string>();
  const keptPaths = new Set<string>();
  let removed = 0;
  let kept = 0;

  for (const row of rows) {
    const target = pathOf(row);
    if (!fs.existsSync(target)) continue;
    try {
      fs.unlinkSync(target);
      removed++;
    } catch {
      kept++; // 재생 중이라 잠긴 파일. 행을 남겨 둔다
      keptKeys.add(row.audio_key);
      keptPaths.add(target);
    }
  }

  // DB가 모르는 파일까지 치운다(고아)
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      const target = path.resolve(path.join(dir, file));
      if (keptPaths.has(target)) continue;
      try {
        fs.unlinkSync(target);
        removed++;
      } catch {
        kept++;
      }
    }
  }

  const survivors = [...keptKeys];
  const holes = survivors.map(() => "?").join(",");
  const wipe = conn().transaction(() => {
    if (survivors.length)
      conn()
        .prepare(`DELETE FROM audio_cache WHERE audio_key NOT IN (${holes})`)
        .run(...survivors);
    else conn().prepare("DELETE FROM audio_cache").run();
    for (const t of ["track_lookup", "sponsorblock_cache", "age_restricted", "spotify_anon", "session_tracks", "player_sessions"]) {
      conn().prepare(`DELETE FROM ${t}`).run();
    }
  });
  wipe();

  // 보호 집합은 사라진 행을 가리키게 되므로 비우고, 살아남은 것(재생 중)만 다시 건다.
  protectedKeys.clear();
  queuedKeys.clear();
  protectedFiles.clear(); // 받는 중인 임시 파일 보호도 함께. 파일은 위에서 지웠다
  for (const key of keptKeys) protectedKeys.add(key);

  try {
    conn().pragma("wal_checkpoint(TRUNCATE)");
    conn().exec("VACUUM");
  } catch {
    /* 파일 크기만 못 줄일 뿐 초기화는 끝났다 */
  }

  log.warn(`오디오 캐시 초기화: ${removed}개 삭제(${Math.round(before.bytes / 1024 / 1024)}MB)${kept > 0 ? `, ${kept}개는 재생 중이라 남겨둠` : ""}`);
  return { removed, kept, freedBytes: before.bytes, fileCountBefore: before.files };
}

function cleanOrphanFiles() {
  if (!fs.existsSync(dir)) return;

  const dbPaths = new Set(
    conn()
      .prepare("SELECT file_path FROM audio_cache WHERE status = 'cached' AND file_path IS NOT NULL")
      .all()
      .map((r) => path.resolve((r as { file_path: string }).file_path)),
  );

  // 보호 대상: 저장된 세션 + 실시간 재생/사전 캐시 키
  const sessionFiles = getProtectedCacheFiles();
  const liveFiles = new Set([...liveKeys()].map((k) => path.resolve(getFilePath(k))));
  const allProtected = new Set([...sessionFiles, ...liveFiles, ...protectedFiles]); // 마지막은 받는 중인 임시 파일

  let cleaned = 0;
  let partials = 0;
  for (const file of fs.readdirSync(dir)) {
    const full = path.resolve(path.join(dir, file));

    // 중단된 다운로드의 부스러기(track_<md5>.opus.part, .part-FragN, .ytdl, 트랜스코딩 전 중간 파일).
    // 부팅 시점에는 진행 중인 다운로드가 없으므로 무조건 지워도 안전하다.
    // (봇을 강제 종료하면 ffmpeg가 파일 핸들을 물고 남는데, 프로세스를 정리한 뒤 남는 잔해가 이것들이다.)
    if (/^track_[0-9a-f]{32}\./.test(file) && !file.endsWith(".opus")) {
      try {
        fs.unlinkSync(full);
        partials++;
      } catch {
        /* 무시 */
      }
      continue;
    }

    if (!file.endsWith(".opus")) continue;
    if (!dbPaths.has(full) && !allProtected.has(full)) {
      try {
        fs.unlinkSync(full);
        cleaned++;
      } catch {
        /* 무시 */
      }
    }
  }
  if (cleaned > 0) log.info(`고아 오디오 캐시 파일 ${cleaned}개 삭제 완료`);
  if (partials > 0) log.info(`캐시 다운로드 중단으로 생성된 조각 파일 ${partials}개 삭제 완료`);
}

// 제거

/** CACHE_DIR 파일시스템의 디스크 여유 공간(바이트). 오류 시 Infinity 반환. */
function freeDiskBytes() {
  try {
    const stat = fs.statfsSync(dir);
    return stat.bavail * stat.bsize;
  } catch {
    return Infinity;
  }
}

function cacheSize(): number {
  return countOf("SELECT COALESCE(SUM(file_size_bytes),0) AS n FROM audio_cache WHERE status='cached'");
}

function cacheCount(): number {
  return countOf("SELECT COUNT(*) AS n FROM audio_cache WHERE status='cached'");
}

// 수 하나를 내는 질의(칸 이름은 n)
function countOf(sql: string): number {
  return (conn().prepare(sql).get() as { n: number }).n;
}

async function evictIfNeeded() {
  const cfg = config.cache;

  const totalSize = cacheSize();
  const fileCount = cacheCount();
  const diskFree = freeDiskBytes();

  const overSize = totalSize > cfg.maxSizeBytes;
  const overFiles = fileCount > cfg.maxFiles;
  const lowDisk = diskFree < cfg.minFreeDiskBytes;

  if (!overSize && !overFiles && !lowDisk) return;

  if (lowDisk) {
    log.warn(`디스크 여유 공간 부족 (${Math.round(diskFree / 1024 / 1024)}MB 남음). 오디오 캐시를 즉시 정리합니다.`);
  } else {
    log.info(`오디오 캐시 용량 제한 도달 (${Math.round(totalSize / 1024 / 1024)}MB / ${cfg.maxSizeBytes / 1024 / 1024}MB, ${fileCount}개). 오래된 파일부터 정리합니다.`);
  }

  await evict();
}

async function evict() {
  // 보호 중인 키 제외. 재생 중인 곡과 각 길드의 대기열 앞부분.
  // 대기열 곡을 빼지 않으면 방금 예열한 파일을 곧바로 도로 가져가는 일이 생긴다.
  const live = liveKeys();
  const rows = (conn().prepare("SELECT * FROM audio_cache WHERE status = 'cached'").all() as AudioRow[]).filter((r) => !live.has(r.audio_key));

  if (rows.length === 0) return;

  const now = Date.now();

  // 연령 제한 영상은 재취득이 느리고 쿠키가 필요하므로 퇴거에서 더 오래 잔존시킨다(점수↓).
  const ageSet = new Set(
    conn()
      .prepare("SELECT video_id FROM age_restricted")
      .all()
      .map((r) => (r as { video_id: string }).video_id),
  );

  const scored = rows
    .map((r) => {
      const ageDays = (now - (r.last_played_at || r.downloaded_at || r.created_at || now)) / 86_400_000;

      // 최근성: 지수 감쇠, 특성 시간 7일
      const recency = Math.exp(-ageDays / 7);

      // 빈도: 재생 횟수 합계를 나이에 따라 감쇠 (반감기 60일)
      // 오래된 재생은 최근 재생보다 낮게 계산
      const freq = Math.min(1, ((r.play_count || 0) * Math.exp(-ageDays / 60)) / 10);

      // 크기: 고정 50 MB 기준
      const sizeFrac = Math.min(1, (r.file_size_bytes || 0) / SIZE_REF_BYTES);

      // 한 번도 재생되지 않은 파일에 추가 페널티
      const neverPlayed = (r.play_count || 0) === 0 ? 0.15 : 0;

      // 점수가 높을수록 더 먼저 제거
      let score = Math.min(1, (1 - recency) * W_RECENCY + (1 - freq) * W_FREQUENCY + sizeFrac * W_SIZE + neverPlayed);

      // 연령 제한 영상: 점수를 낮춰 잔존 우선순위를 높임 (재취득 비용↑). 절대 임계값이 아닌 상대 랭킹이라 영구보존은 아님.
      const vid = typeof r.audio_key === "string" && r.audio_key.startsWith("yt:") ? r.audio_key.slice(3) : null;
      if (vid && ageSet.has(vid)) score *= 0.5;

      return { ...r, _score: score };
    })
    .sort((a, b) => b._score - a._score);

  // 하위 20% 제거, 실행당 최대 50개
  const target = Math.min(Math.ceil(rows.length * 0.2), 50);
  let evicted = 0;
  for (const row of scored.slice(0, target)) {
    const fp = row.file_path || getFilePath(row.audio_key);
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      /* 무시 */
    }
    conn().prepare("DELETE FROM audio_cache WHERE audio_key = ?").run(row.audio_key);
    evicted++;
  }
  if (evicted > 0) log.info(`${evicted}개의 오디오 캐시 파일 삭제 완료`);
}

/** 백그라운드 주기적 제거 타이머 시작 */
function startPeriodicEviction() {
  const cfg = config.cache;
  if (evictInterval) clearInterval(evictInterval);
  evictInterval = setInterval(() => {
    evictIfNeeded().catch((err: unknown) => log.error("정기적 오디오 캐시 자동 정리 중 오류:", messageOf(err)));
  }, cfg.evictIntervalMs);
  evictInterval.unref(); // 프로세스 종료를 막지 않음
}

// 통계

function getCacheStats() {
  const cfg = config.cache;

  const totalSize = cacheSize();
  const fileCount = cacheCount();
  const diskFree = freeDiskBytes();

  const totalPlays = countOf("SELECT COALESCE(SUM(play_count),0) AS n FROM audio_cache WHERE status='cached'");
  const totalDuration = countOf("SELECT COALESCE(SUM(duration_sec),0) AS n FROM audio_cache WHERE status='cached'");
  const downloading = countOf("SELECT COUNT(*) AS n FROM audio_cache WHERE status='downloading'");
  const lookupCount = countOf("SELECT COUNT(*) AS n FROM track_lookup");
  const neverPlayed = countOf("SELECT COUNT(*) AS n FROM audio_cache WHERE status='cached' AND (play_count IS NULL OR play_count=0)");

  const ytCount = countOf("SELECT COUNT(*) AS n FROM audio_cache WHERE status='cached' AND audio_key LIKE 'yt:%'");
  const scCount = countOf("SELECT COUNT(*) AS n FROM audio_cache WHERE status='cached' AND audio_key LIKE 'sc:%'");
  const dlCount = countOf("SELECT COUNT(*) AS n FROM audio_cache WHERE status='cached' AND audio_key LIKE 'dl:%'");

  const topTracks = conn().prepare("SELECT title, channel, play_count, duration_sec FROM audio_cache WHERE status='cached' AND play_count > 0 ORDER BY play_count DESC LIMIT 5").all() as Array<Pick<AudioRow, "title" | "channel" | "play_count" | "duration_sec">>;

  const recentTracks = conn().prepare("SELECT title, channel, downloaded_at FROM audio_cache WHERE status='cached' AND downloaded_at IS NOT NULL ORDER BY downloaded_at DESC LIMIT 3").all() as Array<Pick<AudioRow, "title" | "channel" | "downloaded_at">>;

  return {
    fileCount,
    maxFiles: cfg.maxFiles,
    totalSize,
    maxSize: cfg.maxSizeBytes,
    diskFree,
    minFreeDisk: cfg.minFreeDiskBytes,
    totalPlays,
    totalDuration,
    downloading,
    lookupCount,
    neverPlayed,
    platforms: { youtube: ytCount, soundcloud: scCount, direct: dlCount },
    protectedCount: liveKeys().size,
    topTracks,
    recentTracks,
  };
}

// 생명주기

function close() {
  if (evictInterval) {
    clearInterval(evictInterval);
    evictInterval = null;
  }
  if (db.isOpen()) {
    db.close();
  }
}

export { initialize, getFilePath, protect, unprotect, protectFile, unprotectFile, setQueuedKeys, lookupByAudioKey, recordDownloadStart, recordDownloadComplete, recordError, recordPlayback, getProtectedCacheFiles, onStartup, resetCache, evictIfNeeded, evict, getCacheStats, close, cacheDir, _setCacheDir, liveKeys as _liveKeys, cleanOrphanFiles as _cleanOrphanFiles, cacheCount as _cacheCount, protectedKeys as _protectedKeys, protectedFiles as _protectedFiles };
export type { AudioRow, TrackMeta };
