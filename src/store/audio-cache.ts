// 오디오 캐시. 캐시 파일 · 보호 · 퇴거 · 캐시 파일 기록(audio_cache) · 기동 정리 · 통계

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "cache" });
import path from "path";
import fs from "fs";
import config from "../config/index.ts";
import { onTunablesChanged } from "../config/tunables-changed.ts";
import { md5, audioKeyOf } from "../rules/audio-key-of.ts";
import { sessions } from "./player-sessions.ts";
import { cacheDb, TABLES_OF_PART } from "./cache-db.ts";
import type { AudioCachePart } from "../rules/audio-cache-parts.ts";
import { messageOf } from "../rules/error-kind.ts";
import { bestEffort } from "../infra/best-effort.ts";
import { PROJECT } from "../infra/project-paths.ts";
import { driveOf } from "../infra/disk.ts";

const CACHE_DIR = PROJECT.audioCache;

// 퇴거 점수의 가중치(최근성 · 빈도 · 크기)
const W_RECENCY = 0.4;
const W_FREQUENCY = 0.4;
const W_SIZE = 0.2;
// 크기 점수의 기준. opus 128kbps 는 1분에 약 1MB 라 50MB 는 약 50분이다
const SIZE_REF_BYTES = 50 * 1024 * 1024;

/** audio_cache 한 행(표는 cache-db.ts) */
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
};
// 캐시 파일 기록에 적을 곡 정보. 여기서 읽는 필드만
type TrackMeta = { title?: string | null; artist?: string | null; channel?: string | null; duration?: number | null };

// 서버 → 재생 중인 곡의 audio_key. 서버마다 나눠 두어 한 서버가 곡을 끝내도 같은 곡을 트는 다른 서버의 보호는 남는다
const protectedKeys = new Map<string, string>();
const protectedFiles = new Set<string>(); // 지금 다운로드 중인 파일 경로(임시 파일 · 옮긴 뒤 기록 전의 최종 파일). 정리가 건드리면 안 된다
const queuedKeys = new Map<string, Set<string>>(); // guildId -> Set<audio_key>. 대기열 앞부분
let evictInterval: NodeJS.Timeout | null = null;
let evictEveryMs = 0;
// 캐시 파일이 놓이는 곳. 테스트가 _setCacheDir 로 교체하면 실제 폴더를 건드리지 않는다.
// 파일을 만지는 코드는 반드시 이 값을 거쳐야 한다(모듈 상수를 직접 쓰면 격리가 새어나간다).
let dir = CACHE_DIR;
// 파일 하나를 삭제할 때 기다리는 상한. 다른 프로그램(탐색기 등)이 파일을 쥐고 있으면 놓을 때까지 삭제가 멈춘다
const REMOVE_TIMEOUT_MS = 10_000;
const fsUnlink = (target: string) => fs.promises.unlink(target);
let removeTimeoutMs = REMOVE_TIMEOUT_MS;
let unlink = fsUnlink;
// 상한 안에 삭제되지 않은 파일. 그 삭제는 취소되지 않고 스레드 풀 슬롯 하나를 잡고 있으므로 이번 실행 동안 다시 부르지 않는다
const stuckFiles = new Set<string>();
// 정기 퇴거가 이미 돌고 있으면 그것을 돌려준다(겹쳐 부르면 한 번만)
let evicting: Promise<void> | null = null;
// 캐시를 삭제하는 길(퇴거 · 초기화 · 파일 하나 삭제)이 함께 쓰는 잠금. 한 번에 하나만 돈다(겹치면 같은 행을 두 번 세거나 남긴 행을 삭제한다).
// 잠금은 바깥 한 층에서만 잡는다(안에서 또 잡으면 스스로 막힌다). 잠금 안에서 다운로드를 기다리지 않는다(파일 삭제는 상한이 있다)
let cleanupTail: Promise<unknown> = Promise.resolve();
/** 봇이 시작된 뒤 마지막으로 실제로 삭제한 정리: 시각 · 삭제한 파일 수 · 비운 바이트 */
let lastCleanup: { at: number; files: number; bytes: number } | null = null;

// 열기 전에 부르면 던진다
const conn = () => cacheDb.get();

/** 캐시 파일이 놓이는 폴더 */
const cacheDir = () => dir;

// 테스트 시임. 임시 폴더로 바꾼다
function _setCacheDir(next: string) {
  dir = next;
}

// 테스트 시임. 파일 삭제를 교체한다. 인자 없이 부르면 원래대로
function _setRemoval({ unlink: nextUnlink = fsUnlink, timeoutMs = REMOVE_TIMEOUT_MS }: { unlink?: (target: string) => Promise<void>; timeoutMs?: number } = {}) {
  unlink = nextUnlink;
  removeTimeoutMs = timeoutMs;
  stuckFiles.clear();
}

/**
 * 캐시 파일을 삭제한다. 삭제했거나 이미 없으면 true, 못 삭제했으면 false.
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
      log.warn(`캐시 파일 삭제가 ${removeTimeoutMs / 1000}초 안에 끝나지 않아 이번 실행 동안 건너뜁니다(다른 프로그램이 파일을 쥐고 있을 수 있습니다): ${path.basename(target)}`);
      return false;
    }
    log.debug(`캐시 파일을 삭제하지 못했습니다: ${path.basename(target)} | ${messageOf(result)}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// 캐시 폴더를 만들고 정기 퇴거를 건다. DB 는 먼저 열어 둔다(store/stores.open)
function initialize() {
  cacheDb.get();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  startPeriodicEviction();
}

/** 오디오 키의 파일 경로. 같은 키는 늘 같은 경로다 */
function getFilePath(audioKey: string) {
  return path.join(dir, `track_${md5(audioKey)}.opus`);
}

// 퇴거 보호: 틀고 있거나 미리 다운로드한 곡

/** 이 서버가 트는 곡의 키로 표시한다(서버마다 하나, 다른 곡으로 바꾸면 앞 곡의 보호는 풀린다). 삭제하는 길이 건너뛴다 */
function protect(guildId: string, audioKey: string | null | undefined) {
  if (audioKey) protectedKeys.set(guildId, audioKey);
  else protectedKeys.delete(guildId);
}

/** 이 서버의 재생 보호를 푼다 */
function unprotect(guildId: string) {
  protectedKeys.delete(guildId);
}

/** 삭제하는 길을 하나씩 돌린다 */
function underCleanupLock<T>(run: () => Promise<T>): Promise<T> {
  const turn = cleanupTail.then(run);
  cleanupTail = turn.catch(() => undefined);
  return turn;
}

/**
 * 파일 하나를 정리 대상에서 뺀다. 다운로드 중인 임시 파일용.
 * 키가 아니라 경로로 보호하는 이유: 임시 파일은 DB에도 없고 캐시 키로도 유도되지 않는다.
 */
function protectFile(filepath: string | null | undefined) {
  if (filepath) protectedFiles.add(path.resolve(filepath));
}

function unprotectFile(filepath: string | null | undefined) {
  if (filepath) protectedFiles.delete(path.resolve(filepath));
}

/**
 * 이 이름이 임시 파일(.opus)이나 그 부스러기인가. yt-dlp 는 다운로드하는 동안 임시 파일 옆에 .part · 조각 · info.json 을 둔다.
 * 다운로드가 자기 부스러기를 치울 때와 초기화가 다운로드 중인 파일을 건너뛸 때 같은 규칙을 쓴다
 */
function isTempPiece(name: string, tempName: string) {
  return name === tempName || name.startsWith(`${tempName.replace(/\.opus$/, "")}.`);
}

// 다운로드 중인 파일(보호 파일)이거나 그 부스러기인가
function inDownload(target: string) {
  if (protectedFiles.has(target)) return true;
  const name = path.basename(target);
  for (const file of protectedFiles) if (path.dirname(file) === path.dirname(target) && isTempPiece(name, path.basename(file))) return true;
  return false;
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
  const keys = new Set(protectedKeys.values());
  for (const set of queuedKeys.values()) for (const k of set) keys.add(k);
  return keys;
}

/** 오디오 키로 캐시 파일 기록 한 행을 그대로 읽는다 */
function lookupByAudioKey(audioKey: string): AudioRow | null {
  return (conn().prepare("SELECT * FROM audio_cache WHERE audio_key = ?").get(audioKey) as AudioRow | undefined) || null;
}

/** 캐시 파일 기록 전부(캐시 DB 화면의 읽기) */
function allRows(): AudioRow[] {
  return conn().prepare("SELECT * FROM audio_cache").all() as AudioRow[];
}

// 캐시 파일 기록 쓰기(audio_cache)

function recordDownloadStart(audioKey: string, track: TrackMeta | null | undefined) {
  conn()
    .prepare(
      `
          INSERT INTO audio_cache
              (audio_key, status, duration_sec, title, channel, created_at)
          VALUES (?, 'downloading', ?, ?, ?, ?)
          ON CONFLICT(audio_key) DO UPDATE SET status = 'downloading'
      `,
    )
    .run(audioKey, track?.duration || null, track?.title || null, track?.artist || track?.channel || null, Date.now());
}

// durationSec: 다운로드한 오디오의 실제 길이. 모를 때만 track.duration(요청 쪽 메타데이터)으로 채운다
// audioVersion: 다운로드한 음원의 버전(media/audio-version). 모르면 null
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
              downloaded_at       = ?
          WHERE audio_key = ?
      `,
    )
    .run(filePath, fileSizeBytes, track?.title || null, track?.artist || track?.channel || null, durationSec || track?.duration || null, audioVersion, audioVersion ? now : null, now, audioKey);

  // 다운로드 후 제거 검사 (논블로킹). 그 사이 닫혔으면 돌지 않는다(닫힌 DB 를 부르면 던진다)
  setImmediate(() => {
    if (cacheDb.isOpen()) bestEffort(log, evictIfNeeded(), "다운로드 뒤 캐시 비우기");
  });
}

function recordError(audioKey: string) {
  conn().prepare(`UPDATE audio_cache SET status = 'error' WHERE audio_key = ?`).run(audioKey);
}

function recordPlayback(audioKey: string) {
  conn()
    .prepare(
      `
          UPDATE audio_cache SET play_count = play_count + 1, last_played_at = ?
          WHERE audio_key = ?
      `,
    )
    .run(Date.now(), audioKey);
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
  // 지난 실행이 다운로드하다 멈춘 행은 실패로 돌린다
  const resetCount = conn().prepare("UPDATE audio_cache SET status = 'error' WHERE status = 'downloading'").run().changes;
  if (resetCount > 0) log.info(`이전 실행에서 중단된 다운로드 ${resetCount}건 정리 완료`);

  // 다운로드를 마친 행의 파일이 디스크에 남아 있는지 본다
  const cachedRows = conn().prepare("SELECT audio_key, file_path FROM audio_cache WHERE status = 'cached'").all() as Array<Pick<AudioRow, "audio_key" | "file_path">>;
  let orphanDbCount = 0;
  for (const row of cachedRows) {
    const fp = row.file_path || getFilePath(row.audio_key);
    if (!fs.existsSync(fp)) {
      conn().prepare("UPDATE audio_cache SET status = 'error', file_path = NULL WHERE audio_key = ?").run(row.audio_key);
      orphanDbCount++;
    }
  }
  if (orphanDbCount > 0) log.info(`오디오 캐시 파일이 누락된 항목 ${orphanDbCount}건 기록 완료`);

  // 3. DB에서 추적하지 않는 오디오 파일 삭제. 다운로드하다 만 조각도 삭제하므로 복원이 다운로드를 시작하기 전에 끝낸다
  await cleanOrphanFiles();

  // 4. 제한 초과 시 제거. 기다리지 않는다(복원될 곡은 저장된 세션을 보고 지킨다)
  bestEffort(log, evictIfNeeded(), "기동 캐시 비우기");
}

// 선택한 것의 표를 비운다. survivors: 남긴 파일의 키라 audio_cache 에 남길 행. 다운로드 중인 행도 남긴다(끝나면 그 행을 cached 로 고친다).
// 선택마다 비운 행 수
function wipeTables(parts: readonly AudioCachePart[], survivors: string[]): Partial<Record<AudioCachePart, number>> {
  const holes = survivors.map(() => "?").join(",");
  const wipe = (table: string) =>
    table === "audio_cache"
      ? conn()
          .prepare(`DELETE FROM audio_cache WHERE status <> 'downloading'${survivors.length ? ` AND audio_key NOT IN (${holes})` : ""}`)
          .run(...survivors).changes
      : conn().prepare(`DELETE FROM "${table}"`).run().changes;
  const cleared: Partial<Record<AudioCachePart, number>> = {};
  conn().transaction(() => {
    for (const part of parts) cleared[part] = TABLES_OF_PART[part].reduce((sum, table) => sum + wipe(table), 0);
  })();
  return cleared;
}

// 지우기 전의 크기(지운 크기를 센다). 못 읽으면 0
function sizeOf(target: string) {
  try {
    return fs.statSync(target).size;
  } catch {
    return 0;
  }
}

/** 오디오 캐시 초기화의 결과. removed · kept · freedBytes 는 캐시 파일을 선택했을 때의 파일 수 · 남긴 파일 수 · 실제로 지운 크기, cleared 는 선택마다 비운 행 수 */
type ResetResult = { removed: number; kept: number; freedBytes: number; cleared: Partial<Record<AudioCachePart, number>> };

/**
 * 오디오 캐시에서 선택한 것을 초기 상태로 되돌린다(rules/audio-cache-parts). 캐시 파일을 선택하면 오디오 파일까지 지운다.
 * 서버 설정(settings.db)과 저장된 대기열 · 음성 채널 상태(state.db)는 다른 파일이라 남는다.
 *
 * 재생 중 · 대기열 앞 곡과 다운로드 중인 파일은 남긴다(파일 잠금에 기대지 않는다: 리눅스는 재생 중인 파일도 삭제된다).
 * 삭제하지 못한 파일(다른 프로그램이 쥐고 있다)도 행과 함께 남기고 세어서 돌려준다.
 */
function resetCache(parts: readonly AudioCachePart[]): Promise<ResetResult> {
  return underCleanupLock(() => resetLocked(parts));
}

async function resetLocked(parts: readonly AudioCachePart[]): Promise<ResetResult> {
  const files = parts.includes("files") ? await removeAllFiles() : { removed: 0, kept: 0, freedBytes: 0, keptKeys: [] };
  const cleared = wipeTables(parts, files.keptKeys);

  try {
    conn().pragma("wal_checkpoint(TRUNCATE)");
    conn().exec("VACUUM");
  } catch {
    /* 파일 크기만 못 줄일 뿐 초기화는 끝났다 */
  }
  return { removed: files.removed, kept: files.kept, freedBytes: files.freedBytes, cleared };
}

// 캐시 파일을 모두 지운다. 남긴 것(재생 중 · 대기열 앞 · 삭제하지 못한 것)의 키는 행을 남기려고 돌려준다
async function removeAllFiles() {
  // 파일을 먼저 삭제하고, 남긴 것의 행은 남긴다. 행만 삭제하고 파일을 남기면 DB 가 모르는 파일이 된다.
  const rows = conn().prepare("SELECT audio_key, file_path, status FROM audio_cache").all() as Array<Pick<AudioRow, "audio_key" | "file_path" | "status">>;
  const pathOf = (row: Pick<AudioRow, "audio_key" | "file_path">) => path.resolve(row.file_path || getFilePath(row.audio_key));
  const guarded = guardedKeys();
  const keptKeys = new Set<string>();
  const keptPaths = new Set<string>([...protectedFiles]);
  let removed = 0;
  let kept = 0;
  let freedBytes = 0;
  const remove = async (target: string) => {
    const bytes = sizeOf(target);
    if (!(await removeFile(target))) return false;
    removed++;
    freedBytes += bytes;
    return true;
  };

  for (const row of rows) {
    const target = pathOf(row);
    // 다운로드 중인 행은 파일과 함께 남긴다(행은 wipeTables 가 남긴다)
    if (row.status === "downloading" || protectedFiles.has(target)) {
      keptPaths.add(target);
      continue;
    }
    if (!fs.existsSync(target)) continue;
    if (guarded.has(row.audio_key) || !(await remove(target))) {
      kept++; // 재생 중 · 대기열 앞이거나 삭제하지 못한 파일. 행을 남겨 둔다
      keptKeys.add(row.audio_key);
      keptPaths.add(target);
    }
  }

  // DB가 모르는 파일까지 치운다(고아). 다운로드 중인 임시 파일과 그 부스러기는 건너뛴다
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      const target = path.resolve(path.join(dir, file));
      if (keptPaths.has(target) || inDownload(target)) continue;
      if (!(await remove(target))) kept++;
    }
  }
  return { removed, kept, freedBytes, keptKeys: [...keptKeys] };
}

async function cleanOrphanFiles() {
  if (!fs.existsSync(dir)) return;

  const dbPaths = new Set(
    conn()
      .prepare("SELECT file_path FROM audio_cache WHERE status = 'cached' AND file_path IS NOT NULL")
      .all()
      .map((r) => path.resolve((r as { file_path: string }).file_path)),
  );

  // 지키는 파일: 저장된 세션의 곡 · 틀고 있거나 미리 다운로드한 곡
  const sessionFiles = getProtectedCacheFiles();
  const liveFiles = new Set([...liveKeys()].map((k) => path.resolve(getFilePath(k))));
  const allProtected = new Set([...sessionFiles, ...liveFiles, ...protectedFiles]); // 마지막은 다운로드 중인 임시 파일

  let cleaned = 0;
  let partials = 0;
  for (const file of fs.readdirSync(dir)) {
    const full = path.resolve(path.join(dir, file));

    // 중단된 다운로드의 부스러기(track_<md5>.opus.part, .part-FragN, .ytdl, 트랜스코딩 전 중간 파일).
    // 기동 시점에는 진행 중인 다운로드가 없으므로 무조건 삭제해도 안전하다.
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

// 수 하나를 내는 질의(열 이름은 n)
function countOf(sql: string): number {
  return (conn().prepare(sql).get() as { n: number }).n;
}

function evictIfNeeded() {
  evicting ??= underCleanupLock(checkAndEvict).finally(() => {
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

  await evictLocked({ totalSize, fileCount, diskFree });
}

// 삭제하지 않고 지키는 키: 재생 중인 곡과 각 길드의 대기열 앞부분(메모리 · 저장된 세션 양쪽).
// 저장된 세션을 보는 까닭: 복원된 대기열은 예열이 보호를 걸기까지(수 초 ~ 1분) 메모리의 보호 목록에 없다.
// 대기열 전부를 지키면 긴 대기열이 저장된 동안 상한이 적용되지 않는다. 앞부분만(미리 다운로드 범위)
function guardedKeys() {
  return new Set([...liveKeys(), ...sessionKeys(sessions().frontAudioUrls(config.preload.ahead))]);
}

/** 삭제 순서. 점수가 높은(삭제할 만한) 것이 앞이다 */
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

      // 한 번도 틀지 않은 파일은 더 먼저 삭제한다
      const neverPlayed = (r.play_count || 0) === 0 ? 0.15 : 0;

      // 점수가 높을수록 먼저 삭제한다
      let score = Math.min(1, (1 - recency) * W_RECENCY + (1 - freq) * W_FREQUENCY + sizeFrac * W_SIZE + neverPlayed);

      // 연령 제한 영상: 점수를 낮춰 잔존 우선순위를 높임 (재취득 비용↑). 절대 임계값이 아닌 상대 랭킹이라 영구보존은 아님.
      const vid = typeof r.audio_key === "string" && r.audio_key.startsWith("yt:") ? r.audio_key.slice(3) : null;
      if (vid && ageSet.has(vid)) score *= 0.5;

      return { ...r, _score: score };
    })
    .sort((a, b) => b._score - a._score);
}

// 다운로드 중인가. 행의 상태를 파일보다 먼저 본다(다운로드는 시작하자마자 행을 downloading 으로 고친다)
function downloadingNow(audioKey: string, filePath: string) {
  const status = conn().prepare("SELECT status FROM audio_cache WHERE audio_key = ?").pluck().get(audioKey);
  return status === "downloading" || protectedFiles.has(path.resolve(filePath));
}

// 파일을 삭제한 뒤 행을 삭제한다. 그사이 같은 곡 다운로드가 시작됐으면 새 행은 남긴다
function deleteRow(audioKey: string) {
  conn().prepare("DELETE FROM audio_cache WHERE audio_key = ? AND status <> 'downloading'").run(audioKey);
}

/** 한 곡을 삭제한다. 파일을 못 삭제했으면 행을 남긴다(행만 삭제하면 DB 가 모르는 파일이 된다) */
async function evictOne(row: AudioRow): Promise<"gone" | "protected" | "downloading" | "failed" | "closed"> {
  // 삭제하는 사이 재생 · 예열이 이 곡을 지키게 됐거나 다시 다운로드하기 시작했을 수 있다
  if (liveKeys().has(row.audio_key)) return "protected";
  const filePath = row.file_path || getFilePath(row.audio_key);
  if (downloadingNow(row.audio_key, filePath)) return "downloading";
  if (!(await removeFile(filePath))) return "failed";
  if (!cacheDb.isOpen()) return "closed"; // 끄는 중
  deleteRow(row.audio_key);
  return "gone";
}

/**
 * 넘친 만큼 삭제한다. 점수가 높은(삭제할 만한) 것부터 삭제하며, 용량과 파일 수가 목표선(상한의 CACHE_EVICT_TARGET_PERCENT)
 * 아래로 내려오고 디스크 여유가 최소치를 되찾으면 멈춘다. 지금 상태는 부르는 쪽이 넘기고, 생략하면 잰다
 */
function evict(state: { totalSize?: number; fileCount?: number; diskFree?: number } = {}) {
  return underCleanupLock(() => evictLocked(state));
}

async function evictLocked({ totalSize = cacheSize(), fileCount = cacheCount(), diskFree = freeDiskBytes() }: { totalSize?: number; fileCount?: number; diskFree?: number } = {}) {
  // 보호 중인 키 제외(guardedKeys). 대기열 곡을 빼지 않으면 방금 예열한 파일을 곧바로 도로 가져가는 일이 생긴다
  const live = guardedKeys();
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
  let freed = 0;
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
    freed += bytes;
    evicted++;
  }
  if (evicted) lastCleanup = { at: Date.now(), files: evicted, bytes: freed };
  reportEviction({ evicted, failed, guarded, files, size, reached: enough() });
}

/** 쓰는 중이라 삭제하지 않은 까닭: 재생 중 · 대기열 앞 · 저장된 대기열 앞 */
type CacheUse = "playing" | "queued" | "saved-session";
/**
 * 캐시 파일 하나 삭제의 결과. changed: 화면이 본 다운로드 시각과 지금이 다르다(current 는 지금 값) · gone: 행이 없다 ·
 * in-use: 쓰는 중 · downloading: 다운로드 중 · failed: 파일을 삭제하지 못했다(다른 프로그램이 쥐고 있다)
 */
type RemoveResult = { ok: true; bytes: number } | { ok: false; code: "changed"; current: number | null } | { ok: false; code: "gone" } | { ok: false; code: "in-use"; where: CacheUse } | { ok: false; code: "downloading" } | { ok: false; code: "failed" };

// 이 곡을 지금 쓰는 곳. 쓰지 않으면 null
function useOf(audioKey: string): CacheUse | null {
  if ([...protectedKeys.values()].includes(audioKey)) return "playing";
  for (const set of queuedKeys.values()) if (set.has(audioKey)) return "queued";
  if (sessionKeys(sessions().frontAudioUrls(config.preload.ahead)).has(audioKey)) return "saved-session";
  return null;
}

/**
 * 캐시 파일 하나를 삭제한다(캐시 DB 의 캐시 파일 삭제). 파일 없는 error 행도 행만 삭제한다.
 * @param expect  화면이 본 다운로드 시각(downloaded_at). undefined 면 보지 않는다
 */
function removeCached(audioKey: string, expect?: number | null): Promise<RemoveResult> {
  return underCleanupLock(async (): Promise<RemoveResult> => {
    const row = lookupByAudioKey(audioKey);
    if (!row) return { ok: false, code: "gone" };
    if (expect !== undefined && row.downloaded_at !== expect) return { ok: false, code: "changed", current: row.downloaded_at };
    const filePath = row.file_path || getFilePath(audioKey);
    if (downloadingNow(audioKey, filePath)) return { ok: false, code: "downloading" };
    const use = useOf(audioKey);
    if (use) return { ok: false, code: "in-use", where: use };
    if (!(await removeFile(filePath))) return { ok: false, code: "failed" };
    deleteRow(audioKey);
    return { ok: true, bytes: row.status === "cached" ? row.file_size_bytes || 0 : 0 };
  });
}

// 퇴거 결과 한 줄. 시작 줄("상한을 넘었습니다")에는 늘 이 줄이 따른다
function reportEviction({ evicted, failed, guarded, files, size, reached }: { evicted: number; failed: number; guarded: number; files: number; size: number; reached: boolean }) {
  const why = [guarded > 0 && `재생 중 · 대기열 앞 곡 ${guarded}개는 지키고`, failed > 0 && `${failed}개는 삭제하지 못해`].filter(Boolean).join(", ");
  const short = reached ? "" : ` - 목표선까지 내려가지 못했습니다${why ? ` (${why})` : ""}`;
  const unremoved = reached && failed > 0 ? ` - ${failed}개는 삭제하지 못했습니다` : "";
  log.info(`오디오 캐시 ${evicted}개를 삭제했습니다 (${files}개 남음, ${MB(size)}MB)${short}${unremoved}`);
}

/** 정기 퇴거를 건다(간격은 설정) */
function startPeriodicEviction() {
  if (evictInterval) clearInterval(evictInterval);
  evictEveryMs = config.cache.evictIntervalMs;
  evictInterval = setInterval(() => {
    evictIfNeeded().catch((err: unknown) => log.error("정기적 오디오 캐시 자동 정리 중 오류:", messageOf(err)));
  }, evictEveryMs);
  evictInterval.unref(); // 프로세스가 끝나는 것을 붙잡지 않는다
}

// 간격을 바꿔 저장하면 걸려 있던 타이머를 새 간격으로 다시 건다
onTunablesChanged(() => {
  if (evictInterval && config.cache.evictIntervalMs !== evictEveryMs) startPeriodicEviction();
});

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

/**
 * 봇 상태 탭의 저장공간. 캐시: 크기 · 파일 수와 상한, 삭제하지 않고 지키는 파일, 한 번도 틀지 않은 파일,
 * 다운로드 실패로 남은 행(다운로드 실패 · 다운로드 멈춤 · 파일이 사라짐, 다시 다운로드하면 풀린다), 마지막 정리. 드라이브: 캐시 폴더가 놓인 곳
 */
function storageStats() {
  const cfg = config.cache;
  const guarded = guardedKeys();
  const cachedKeys = conn().prepare("SELECT audio_key FROM audio_cache WHERE status='cached'").pluck().all() as string[];
  return {
    cache: {
      bytes: cacheSize(),
      maxBytes: cfg.maxSizeBytes,
      files: cachedKeys.length,
      maxFiles: cfg.maxFiles,
      protectedFiles: cachedKeys.filter((key) => guarded.has(key)).length,
      neverPlayed: countOf("SELECT COUNT(*) AS n FROM audio_cache WHERE status='cached' AND (play_count IS NULL OR play_count=0)"),
      failed: countOf("SELECT COUNT(*) AS n FROM audio_cache WHERE status='error'"),
      lastCleanup,
    },
    drive: driveOf(dir),
    minFreeBytes: cfg.minFreeDiskBytes,
  };
}

// 멈추기. DB 는 store/stores.close 가 닫는다

function close() {
  if (evictInterval) {
    clearInterval(evictInterval);
    evictInterval = null;
  }
}

export {
  storageStats,
  initialize,
  getFilePath,
  protect,
  unprotect,
  protectFile,
  unprotectFile,
  setQueuedKeys,
  lookupByAudioKey,
  allRows,
  recordDownloadStart,
  recordDownloadComplete,
  recordError,
  recordPlayback,
  getProtectedCacheFiles,
  onStartup,
  resetCache,
  removeCached,
  isTempPiece,
  evictIfNeeded,
  evict,
  getCacheStats,
  close,
  cacheDir,
  _setCacheDir,
  _setRemoval,
  liveKeys as _liveKeys,
  cleanOrphanFiles as _cleanOrphanFiles,
  cacheCount as _cacheCount,
  protectedKeys as _protectedKeys,
  protectedFiles as _protectedFiles,
};
export type { AudioRow, TrackMeta, CacheUse, RemoveResult, ResetResult };
