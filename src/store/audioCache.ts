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
import { bestEffort } from "../infra/bestEffort.ts";
import { PROJECT } from "../infra/projectPaths.ts";

const CACHE_DIR = PROJECT.audioCache;

// 퇴거 점수의 가중치(최근성 · 빈도 · 크기)
const W_RECENCY = 0.4;
const W_FREQUENCY = 0.4;
const W_SIZE = 0.2;
// 크기 점수의 기준. opus 128kbps 는 1분에 약 1MB 라 50MB 는 약 50분이다
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
// 파일 하나를 지울 때 기다리는 상한. 다른 프로그램(탐색기 등)이 파일을 쥐고 있으면 지우기가 풀릴 때까지 멈춘다
const REMOVE_TIMEOUT_MS = 10_000;
const fsUnlink = (target: string) => fs.promises.unlink(target);
let removeTimeoutMs = REMOVE_TIMEOUT_MS;
let unlink = fsUnlink;
// 상한 안에 지워지지 않은 파일. 그 지우기는 취소되지 않고 스레드 풀 한 칸을 잡고 있으므로 이번 실행 동안 다시 부르지 않는다
const stuckFiles = new Set<string>();
// 퇴거는 한 번에 하나. 겹치면 같은 행을 두 번 세어 지운다
let evicting: Promise<void> | null = null;

// 열기 전에 부르면 던진다
const conn = () => db.get();

/** 캐시 파일이 놓이는 폴더 */
const cacheDir = () => dir;

// 테스트 시임. 임시 폴더로 바꾼다
function _setCacheDir(next: string) {
  dir = next;
}

// 테스트 시임. 파일 지우기를 갈아끼운다. 인자 없이 부르면 원래대로
function _setRemoval({ unlink: nextUnlink = fsUnlink, timeoutMs = REMOVE_TIMEOUT_MS }: { unlink?: (target: string) => Promise<void>; timeoutMs?: number } = {}) {
  unlink = nextUnlink;
  removeTimeoutMs = timeoutMs;
  stuckFiles.clear();
}

/**
 * 캐시 파일을 지운다. 지웠거나 이미 없으면 true, 못 지웠으면 false.
 * 상한 시간 안에 끝나지 않으면 기다리지 않고 false 이고, 그 파일은 이번 실행 동안 건너뛴다
 */
async function removeFile(fp: string): Promise<boolean> {
  const target = path.resolve(fp);
  if (stuckFiles.has(target)) return false;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), removeTimeoutMs);
    timer.unref();
  });
  const done = unlink(target).then(
    () => "ok" as const,
    (error: NodeJS.ErrnoException) => (error?.code === "ENOENT" ? ("ok" as const) : error),
  );
  try {
    const result = await Promise.race([done, late]);
    if (result === "ok") return true;
    if (result === "late") {
      stuckFiles.add(target);
      log.warn(`캐시 파일 지우기가 ${removeTimeoutMs / 1000}초 안에 끝나지 않아 이번 실행 동안 건너뜁니다(다른 프로그램이 파일을 쥐고 있을 수 있습니다): ${path.basename(target)}`);
      return false;
    }
    log.debug(`캐시 파일을 지우지 못했습니다: ${path.basename(target)} | ${messageOf(result)}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// DB 를 열고 정기 퇴거를 건다. dbPath 는 시험이 임시 DB 를 넘기는 자리이고 운영은 기본 경로다
function initialize(dbPath = db.DB_PATH) {
  if (db.isOpen()) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db.open(dbPath, { cacheDir: dir });
  startPeriodicEviction();
  log.info({ tags: ["startup"] }, "SQLite 캐시 DB 준비 완료");
}

/** 오디오 열쇠의 파일 경로. 같은 열쇠는 늘 같은 경로다 */
function getFilePath(audioKey: string) {
  return path.join(dir, `track_${md5(audioKey)}.opus`);
}

// 퇴거 보호: 틀고 있거나 미리 받아 둔 곡

/** 쓰는 중인 열쇠로 표시한다. 퇴거가 건너뛴다 */
function protect(audioKey: string | null | undefined) {
  if (audioKey) protectedKeys.add(audioKey);
}

/** 다 쓴 열쇠의 보호를 푼다 */
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

/** 오디오 열쇠로 장부 한 줄을 그대로 읽는다 */
function lookupByAudioKey(audioKey: string): AudioRow | null {
  return (conn().prepare("SELECT * FROM audio_cache WHERE audio_key = ?").get(audioKey) as AudioRow | undefined) || null;
}

// 장부 쓰기(audio_cache)

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
// audioVersion: 받은 음원의 버전(media/audioVersion). 모르면 null
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

  // 다운로드 후 제거 검사 (논블로킹). 그 사이 닫혔으면 돌지 않는다(닫힌 DB 를 부르면 던진다)
  setImmediate(() => {
    if (db.isOpen()) bestEffort(log, evictIfNeeded(), "다운로드 뒤 캐시 비우기");
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
  return new Set([...sessionKeys()].map((key) => path.resolve(getFilePath(key))));
}

// 저장된 세션이 쓰는 캐시 키. 고아 청소는 지금 곡 · 대기열 전부를, 퇴거는 지금 곡 · 대기열 앞부분을 지킨다
function sessionKeys(audioUrls = sessions().liveAudioUrls()) {
  const keys = new Set<string>();
  for (const audioUrl of audioUrls) {
    const key = audioKeyOf(audioUrl);
    if (key) keys.add(key);
  }
  return keys;
}

// 기동 정리

async function onStartup() {
  // 지난 실행이 받다가 멈춘 줄은 실패로 돌린다
  const resetCount = conn().prepare("UPDATE audio_cache SET status = 'error', updated_at = ? WHERE status = 'downloading'").run(Date.now()).changes;
  if (resetCount > 0) log.info(`이전 실행에서 중단된 다운로드 ${resetCount}건 정리 완료`);

  // 받아 둔 줄의 파일이 디스크에 남아 있는지 본다
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

  // 3. DB에서 추적하지 않는 오디오 파일 삭제. 받다 만 조각도 지우므로 복원이 받기를 시작하기 전에 끝낸다
  await cleanOrphanFiles();

  // 4. 제한 초과 시 제거. 기다리지 않는다(복원될 곡은 저장된 세션을 보고 지킨다)
  bestEffort(log, evictIfNeeded(), "기동 캐시 비우기");
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
async function resetCache() {
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
    if (await removeFile(target)) {
      removed++;
    } else {
      kept++; // 재생 중이라 잠겼거나 응답하지 않는 파일. 행을 남겨 둔다
      keptKeys.add(row.audio_key);
      keptPaths.add(target);
    }
  }

  // DB가 모르는 파일까지 치운다(고아)
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      const target = path.resolve(path.join(dir, file));
      if (keptPaths.has(target)) continue;
      if (await removeFile(target)) removed++;
      else kept++;
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

  log.warn(`오디오 캐시 초기화: ${removed}개 삭제(${Math.round(before.bytes / 1024 / 1024)}MB)${kept > 0 ? `, ${kept}개는 잠겨 있어(재생 중 등) 남겨둠` : ""}`);
  return { removed, kept, freedBytes: before.bytes, fileCountBefore: before.files };
}

async function cleanOrphanFiles() {
  if (!fs.existsSync(dir)) return;

  const dbPaths = new Set(
    conn()
      .prepare("SELECT file_path FROM audio_cache WHERE status = 'cached' AND file_path IS NOT NULL")
      .all()
      .map((r) => path.resolve((r as { file_path: string }).file_path)),
  );

  // 지키는 파일: 저장된 세션의 곡 · 틀고 있거나 미리 받아 둔 곡
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
      if (await removeFile(full)) partials++;
      continue;
    }

    if (!file.endsWith(".opus")) continue;
    if (!dbPaths.has(full) && !allProtected.has(full) && (await removeFile(full))) cleaned++;
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

function evictIfNeeded() {
  evicting ??= checkAndEvict().finally(() => {
    evicting = null;
  });
  return evicting;
}

const MB = (bytes: number) => Math.round(bytes / 1024 / 1024);

async function checkAndEvict() {
  const cfg = config.cache;

  const totalSize = cacheSize();
  const fileCount = cacheCount();
  const diskFree = freeDiskBytes();

  const overSize = totalSize > cfg.maxSizeBytes;
  const overFiles = fileCount > cfg.maxFiles;
  const lowDisk = diskFree < cfg.minFreeDiskBytes;

  if (!overSize && !overFiles && !lowDisk) return;

  if (lowDisk) {
    log.warn(`디스크 여유 공간 부족 (${MB(diskFree)}MB 남음, 최소 ${MB(cfg.minFreeDiskBytes)}MB). 오디오 캐시를 정리합니다.`);
  } else {
    const over = [overSize && `용량 ${MB(totalSize)}MB / ${MB(cfg.maxSizeBytes)}MB`, overFiles && `파일 ${fileCount}개 / ${cfg.maxFiles}개`].filter(Boolean).join(" · ");
    log.info(`오디오 캐시가 상한을 넘었습니다 (${over}) - 상한의 ${cfg.evictTargetPercent}%까지 정리합니다.`);
  }

  await evict({ totalSize, fileCount, diskFree });
}

/** 지울 차례. 점수가 높은(지울 만한) 것이 앞이다 */
function rankForEviction(rows: AudioRow[]) {
  const now = Date.now();

  // 연령 제한 영상은 재취득이 느리고 쿠키가 필요하므로 퇴거에서 더 오래 잔존시킨다(점수↓).
  const ageSet = new Set(
    conn()
      .prepare("SELECT video_id FROM age_restricted")
      .all()
      .map((r) => (r as { video_id: string }).video_id),
  );

  return rows
    .map((r) => {
      const ageDays = (now - (r.last_played_at || r.downloaded_at || r.created_at || now)) / 86_400_000;

      // 최근성: 7일을 특성 시간으로 지수 감쇠
      const recency = Math.exp(-ageDays / 7);

      // 빈도: 재생 횟수를 나이에 따라 감쇠(60일). 오래전 재생은 덜 친다
      const freq = Math.min(1, ((r.play_count || 0) * Math.exp(-ageDays / 60)) / 10);

      // 크기: 50MB 를 1 로 본다
      const sizeFrac = Math.min(1, (r.file_size_bytes || 0) / SIZE_REF_BYTES);

      // 한 번도 틀지 않은 파일은 더 먼저 지운다
      const neverPlayed = (r.play_count || 0) === 0 ? 0.15 : 0;

      // 점수가 높을수록 먼저 지운다
      let score = Math.min(1, (1 - recency) * W_RECENCY + (1 - freq) * W_FREQUENCY + sizeFrac * W_SIZE + neverPlayed);

      // 연령 제한 영상: 점수를 낮춰 잔존 우선순위를 높임 (재취득 비용↑). 절대 임계값이 아닌 상대 랭킹이라 영구보존은 아님.
      const vid = typeof r.audio_key === "string" && r.audio_key.startsWith("yt:") ? r.audio_key.slice(3) : null;
      if (vid && ageSet.has(vid)) score *= 0.5;

      return { ...r, _score: score };
    })
    .sort((a, b) => b._score - a._score);
}

/** 한 곡을 지운다. 파일을 못 지웠으면 행을 남긴다(행만 지우면 DB 가 모르는 파일이 된다) */
async function evictOne(row: AudioRow): Promise<"gone" | "protected" | "failed" | "closed"> {
  // 지우는 사이 재생 · 예열이 이 곡을 지키게 됐을 수 있다
  if (liveKeys().has(row.audio_key)) return "protected";
  if (!(await removeFile(row.file_path || getFilePath(row.audio_key)))) return "failed";
  if (!db.isOpen()) return "closed"; // 끄는 중
  conn().prepare("DELETE FROM audio_cache WHERE audio_key = ?").run(row.audio_key);
  return "gone";
}

/**
 * 넘친 만큼 지운다. 점수가 높은(지울 만한) 것부터 지우며, 용량과 파일 수가 목표선(상한의 CACHE_EVICT_TARGET_PERCENT)
 * 아래로 내려오고 디스크 여유가 최소치를 되찾으면 멈춘다. 지금 상태는 부르는 쪽이 넘기고, 생략하면 잰다
 */
async function evict({ totalSize = cacheSize(), fileCount = cacheCount(), diskFree = freeDiskBytes() }: { totalSize?: number; fileCount?: number; diskFree?: number } = {}) {
  // 보호 중인 키 제외. 재생 중인 곡과 각 길드의 대기열 앞부분(메모리 · 저장된 세션 양쪽).
  // 대기열 곡을 빼지 않으면 방금 예열한 파일을 곧바로 도로 가져가는 일이 생긴다.
  // 저장된 세션을 보는 까닭: 복원된 대기열은 예열이 보호를 걸기까지(수 초 ~ 1분) 메모리의 보호 목록에 없다.
  // 대기열 전부를 지키면 긴 대기열이 저장된 동안 상한이 먹지 않는다. 앞부분만(미리 받기 범위)
  const live = new Set([...liveKeys(), ...sessionKeys(sessions().frontAudioUrls(config.preload.ahead))]);
  const all = conn().prepare("SELECT * FROM audio_cache WHERE status = 'cached'").all() as AudioRow[];
  const scored = rankForEviction(all.filter((r) => !live.has(r.audio_key)));
  const guarded = all.length - scored.length;

  const cfg = config.cache;
  const goal = cfg.evictTargetPercent / 100;
  let size = totalSize;
  let files = fileCount;
  let free = diskFree;
  const enough = () => size <= cfg.maxSizeBytes * goal && files <= cfg.maxFiles * goal && free >= cfg.minFreeDiskBytes;
  let evicted = 0;
  let failed = 0;
  for (const row of scored) {
    if (enough()) break;
    const outcome = await evictOne(row);
    if (outcome === "closed") return;
    if (outcome !== "gone") {
      if (outcome === "failed") failed++;
      continue;
    }
    const bytes = row.file_size_bytes || 0;
    size -= bytes;
    files -= 1;
    free += bytes;
    evicted++;
  }
  reportEviction({ evicted, failed, guarded, files, size, reached: enough() });
}

// 퇴거 결과 한 줄. 시작 줄("상한을 넘었습니다")에는 늘 이 줄이 따른다
function reportEviction({ evicted, failed, guarded, files, size, reached }: { evicted: number; failed: number; guarded: number; files: number; size: number; reached: boolean }) {
  const why = [guarded > 0 && `재생 중 · 대기열 앞 곡 ${guarded}개는 지키고`, failed > 0 && `${failed}개는 지우지 못해`].filter(Boolean).join(", ");
  const short = reached ? "" : ` - 목표선까지 내려가지 못했습니다${why ? ` (${why})` : ""}`;
  const unremoved = reached && failed > 0 ? ` - ${failed}개는 지우지 못했습니다` : "";
  log.info(`오디오 캐시 ${evicted}개를 지웠습니다 (${files}개 남음, ${MB(size)}MB)${short}${unremoved}`);
}

/** 정기 퇴거를 건다(간격은 설정) */
function startPeriodicEviction() {
  const cfg = config.cache;
  if (evictInterval) clearInterval(evictInterval);
  evictInterval = setInterval(() => {
    evictIfNeeded().catch((err: unknown) => log.error("정기적 오디오 캐시 자동 정리 중 오류:", messageOf(err)));
  }, cfg.evictIntervalMs);
  evictInterval.unref(); // 프로세스가 끝나는 것을 붙잡지 않는다
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

// 닫기

function close() {
  if (evictInterval) {
    clearInterval(evictInterval);
    evictInterval = null;
  }
  if (db.isOpen()) {
    db.close();
  }
}

export { initialize, getFilePath, protect, unprotect, protectFile, unprotectFile, setQueuedKeys, lookupByAudioKey, recordDownloadStart, recordDownloadComplete, recordError, recordPlayback, getProtectedCacheFiles, onStartup, resetCache, evictIfNeeded, evict, getCacheStats, close, cacheDir, _setCacheDir, _setRemoval, liveKeys as _liveKeys, cleanOrphanFiles as _cleanOrphanFiles, cacheCount as _cacheCount, protectedKeys as _protectedKeys, protectedFiles as _protectedFiles };
export type { AudioRow, TrackMeta };
