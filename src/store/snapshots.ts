// settings.db 스냅샷. DB 폴더의 backups/ 에 SQLite 백업으로 뜬다(쓰는 중에도 한 시점의 사본). 비밀은 암호문 그대로라 같은 SECRETS_KEY 가 있어야 풀린다.
//   daily           하루 한 번(기동 때 오늘 것이 없으면 + 한 시간마다 살핀다). 7개
//   before-import   설정을 가져오기 전 · before-restore 복원으로 교체하기 전 · before-reset 초기화하기 전. 셋 합쳐 5개
// 복원: 선택한 스냅샷을 settings.restore.db 로 예약하면, 다음 기동이 settings.db 를 열기 전에 지금 것을 스냅샷으로 남기고 교체한다(열린 DB 를 교체하지 않는다).

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "core" });
import { codedError, messageOf } from "../rules/error-kind.ts";
import { settingsDb, VERSION } from "./settings-db.ts";
import { ownerOnly } from "../infra/owner-only.ts";
import type { Snapshot, SnapshotKind } from "../rules/snapshots.ts";

const KEEP_DAILY = 7;
const KEEP_OTHERS = 5;
const CHECK_MS = 60 * 60_000;
const NAME = /^settings-(daily|before-import|before-restore|before-reset)-[0-9-]+\.db$/;
const STAGED = "settings.restore.db";

let timer: NodeJS.Timeout | null = null;

const pad = (n: number) => String(n).padStart(2, "0");
const day = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
const stamp = (at: Date) => `${day(at)}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;

/** DB 폴더(settings.db 가 있는 곳). 열기 전이면 던진다 */
const dbDir = () => path.dirname(settingsDb.get().name);
const backupsOf = (dir: string) => path.join(dir, "backups");

/** 목록(새것부터). dir 을 주면 그 DB 폴더의 것(열기 전에 부를 때) */
function list(dir = dbDir()): Snapshot[] {
  const folder = backupsOf(dir);
  let names: string[];
  try {
    names = fs.readdirSync(folder).filter((name) => NAME.test(name));
  } catch {
    return []; // 아직 뜬 것이 없다
  }
  return names
    .map((name) => {
      const stat = fs.statSync(path.join(folder, name));
      return { name, kind: NAME.exec(name)![1] as SnapshotKind, at: stat.mtimeMs, bytes: stat.size };
    })
    .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
}

// 오래된 것을 삭제한다(매일 것 · 그 밖의 것 따로)
function prune(dir: string) {
  const all = list(dir);
  const extra = [...all.filter((one) => one.kind === "daily").slice(KEEP_DAILY), ...all.filter((one) => one.kind !== "daily").slice(KEEP_OTHERS)];
  for (const one of extra) fs.rmSync(path.join(backupsOf(dir), one.name), { force: true });
}

/** 지금 settings.db 를 뜬다. 뜬 파일 이름 */
async function take(kind: SnapshotKind, at = new Date()): Promise<string> {
  const dir = dbDir();
  fs.mkdirSync(backupsOf(dir), { recursive: true });
  const name = `settings-${kind}-${kind === "daily" ? day(at) : stamp(at)}.db`;
  const file = path.join(backupsOf(dir), name);
  await settingsDb.get().backup(file);
  ownerOnly(file);
  prune(dir);
  return name;
}

/** 오늘 것이 없으면 뜬다 */
async function ensureDaily(at = new Date()) {
  if (list().some((one) => one.name === `settings-daily-${day(at)}.db`)) return null;
  const name = await take("daily", at);
  log.info(`설정 DB 스냅샷을 남겼습니다: ${name}`);
  return name;
}

/** 기동 때. 오늘 것을 뜨고 한 시간마다 살핀다(자정을 넘겨 돌아도 하루 한 번) */
function startDaily() {
  const check = () => ensureDaily().catch((error: unknown) => log.warn(`설정 DB 스냅샷을 남기지 못했습니다: ${messageOf(error)}`));
  void check();
  timer = setInterval(() => void check(), CHECK_MS);
  timer.unref();
}

function stopDaily() {
  if (timer) clearInterval(timer);
  timer = null;
}

// 스냅샷 파일이 이 봇의 settings.db 형식인지(구조 버전 · 표). 아니면 던진다
function checkSnapshot(file: string) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const found = db.pragma("user_version", { simple: true }) as number;
    if (found !== VERSION) throw codedError("SNAPSHOT_MISMATCH", `구조 버전이 다른 스냅샷입니다(v${found}, 봇 v${VERSION}).`);
    db.prepare("SELECT COUNT(*) FROM documents").get();
  } finally {
    db.close();
  }
}

/** 선택한 스냅샷을 복원으로 예약한다(다음 기동에 교체한다). 없는 이름이면 SNAPSHOT_NOT_FOUND */
function stage(name: string) {
  const dir = dbDir();
  if (!NAME.test(name) || !list(dir).some((one) => one.name === name)) throw codedError("SNAPSHOT_NOT_FOUND", `없는 스냅샷입니다: ${name}`);
  const from = path.join(backupsOf(dir), name);
  checkSnapshot(from);
  const to = path.join(dir, STAGED);
  fs.copyFileSync(from, `${to}.tmp`);
  fs.renameSync(`${to}.tmp`, to);
  fs.writeFileSync(path.join(dir, `${STAGED}.json`), JSON.stringify({ from: name }));
  ownerOnly(to);
}

/** 복원 예약을 취소한다 */
function unstage() {
  const dir = dbDir();
  fs.rmSync(path.join(dir, STAGED), { force: true });
  fs.rmSync(path.join(dir, `${STAGED}.json`), { force: true });
}

/** 예약한 스냅샷 이름(없으면 null) */
function staged(dir = dbDir()): string | null {
  if (!fs.existsSync(path.join(dir, STAGED))) return null;
  try {
    return (JSON.parse(fs.readFileSync(path.join(dir, `${STAGED}.json`), "utf8")) as { from?: string }).from ?? STAGED;
  } catch {
    return STAGED;
  }
}

// 교체하기 전의 settings.db 를 before-restore 로 남긴다. 닫힌 파일이라 -wal 을 본체에 접어 넣은 뒤 본체만 복사하면 한 시점의 사본이다.
// 깨진 파일이라 접지 못해도(복원이 가장 필요한 때) 있는 그대로 복사한다
function keepCurrent(dir: string, current: string) {
  try {
    const db = new Database(current);
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
  } catch (error) {
    log.warn(`교체할 설정 DB 를 정리하지 못해 있는 그대로 남깁니다: ${messageOf(error)}`);
  }
  fs.mkdirSync(backupsOf(dir), { recursive: true });
  const kept = path.join(backupsOf(dir), `settings-before-restore-${stamp(new Date())}.db`);
  fs.copyFileSync(current, kept);
  ownerOnly(kept);
}

/**
 * 기동 때 settings.db 를 열기 전에. 예약한 복원이 있으면 지금 것을 before-restore 스냅샷으로 남기고 교체한다.
 * 교체한 스냅샷 이름(없었으면 null)
 */
function applyStaged(dir: string): string | null {
  const from = staged(dir);
  if (!from) return null;
  const current = path.join(dir, "settings.db");
  // 다른 버전의 봇이 만든 설정 DB 면 교체하지 않는다(교체하면 구조가 맞지 않아 어차피 열지 못한다). 예약은 남는다
  try {
    checkSnapshot(path.join(dir, STAGED));
  } catch (error) {
    throw Object.assign(codedError("RESTORE_FAILED", `예약한 ${from} 을 교체하지 않았습니다: ${messageOf(error)} 그 버전의 봇으로 시작하거나 database/${STAGED} 를 삭제하세요`), { dbFile: "settings.db" });
  }
  try {
    if (fs.existsSync(current)) keepCurrent(dir, current);
    for (const leftover of [current, `${current}-wal`, `${current}-shm`]) fs.rmSync(leftover, { force: true });
    fs.renameSync(path.join(dir, STAGED), current);
    // 구조를 보느라 열었을 때 남았을 수 있는 곁 파일
    for (const leftover of [`${STAGED}-wal`, `${STAGED}-shm`]) fs.rmSync(path.join(dir, leftover), { force: true });
  } catch (error) {
    // Windows 에서 다른 프로그램(SQLite 뷰어 등)이 settings.db 를 열어 두면 삭제하지 못한다. 예약은 남아 다음 기동에 다시 한다
    throw Object.assign(codedError("RESTORE_FAILED", `예약한 ${from} 을 교체하지 못했습니다: ${messageOf(error)}. settings.db 를 연 프로그램을 닫고 다시 시작하세요`), { dbFile: "settings.db" });
  }
  fs.rmSync(path.join(dir, `${STAGED}.json`), { force: true });
  prune(dir);
  return from;
}

export { list, take, ensureDaily, startDaily, stopDaily, stage, unstage, staged, applyStaged, KEEP_DAILY, KEEP_OTHERS };
