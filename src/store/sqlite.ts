// SQLite 파일 하나를 여는 틀. 설정 · 실행 상태 · 캐시가 각자 이것으로 자기 파일을 정한다(stores.ts 가 함께 연다).
// 불러와도 열리지 않는다. 열기 전에 get() 을 부르면 던진다(시험 · 스크립트가 실제 DB 를 건드리지 않게).

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { ownerOnly } from "../infra/owner-only.ts";

type Db = Database.Database;

/**
 * 구조 버전이 맞지 않을 때.
 * recreate: 표를 모두 지우고 새로 만든다(다시 만들 수 있는 것만 담은 파일).
 * stop: 열지 않고 던진다(사람이 정한 값을 담은 파일. 지우지 않는다)
 */
type OnMismatch = "recreate" | "stop";

type DbSpec = {
  /** 로그 · 오류에 쓰는 이름 */
  label: string;
  /** 기본 파일 이름(stores 가 폴더와 잇는다) */
  fileName: string;
  /** 구조를 맞지 않게 바꿀 때마다 올린다. 표를 더하기만 하면 올리지 않는다(CREATE TABLE IF NOT EXISTS) */
  version: number;
  /** 쓰기마다 디스크까지 기다리나. 잃으면 안 되는 파일은 FULL */
  synchronous: "NORMAL" | "FULL";
  onMismatch: OnMismatch;
  /** 표 만들기. 이미 있으면 그대로 둔다 */
  createTables(db: Db): void;
  /** 버전이 맞지 않아 열지 않을 때의 안내(stop 일 때) */
  mismatchHint?: (found: number, file: string) => string;
};

/** 열고 난 결과. recreated: 버전이 맞지 않아 표를 새로 만들었다(found 는 그때 읽은 버전) */
type Opened = { recreated: false } | { recreated: true; found: number };

class DbFile {
  readonly spec: DbSpec;
  conn: Db | null = null;

  constructor(spec: DbSpec) {
    this.spec = spec;
  }

  /** 이미 열었으면 그대로. 버전이 맞지 않으면 spec.onMismatch 대로 */
  open(file: string): Opened {
    if (this.conn) return { recreated: false };
    fs.mkdirSync(path.dirname(file), { recursive: true });

    const next = new Database(file);
    try {
      // -wal · -shm 은 SQLite 가 본체와 같은 권한으로 만든다
      ownerOnly(file);
      next.pragma("journal_mode = WAL");
      next.pragma(`synchronous = ${this.spec.synchronous}`);
      next.pragma("foreign_keys = ON");
      next.pragma("busy_timeout = 5000");
      const opened = this.settle(next, file);
      this.spec.createTables(next);
      next.pragma(`user_version = ${this.spec.version}`);
      this.conn = next;
      return opened;
    } catch (error) {
      next.close();
      throw error;
    }
  }

  // 표가 있는데 버전이 다르면 지우거나 멈춘다. 표가 없으면 새 파일이다
  settle(db: Db, file: string): Opened {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all() as string[];
    const found = db.pragma("user_version", { simple: true }) as number;
    if (!tables.length || found === this.spec.version) return { recreated: false };
    if (this.spec.onMismatch === "stop") {
      const message = this.spec.mismatchHint?.(found, file) ?? `${this.spec.label} 구조가 이 봇과 맞지 않아 열지 않습니다 (DB v${found}, 봇 v${this.spec.version}): ${file}`;
      throw Object.assign(new Error(message), { code: "SCHEMA_MISMATCH" });
    }
    dropAll(db, tables);
    return { recreated: true, found };
  }

  get(): Db {
    if (!this.conn) throw Object.assign(new Error(`${this.spec.label} 를 열기 전에 불렀다(store/stores.open 을 먼저)`), { code: "DB_NOT_OPEN" });
    return this.conn;
  }

  isOpen() {
    return this.conn !== null;
  }

  close() {
    if (!this.conn) return;
    this.conn.close();
    this.conn = null;
  }
}

// 외래 키를 잠시 끄고 모든 표를 지운다(지우는 차례에 걸리지 않게). 색인은 표와 함께 사라진다
function dropAll(db: Db, tables: string[]) {
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      for (const table of tables) db.exec(`DROP TABLE IF EXISTS "${table.replaceAll('"', '""')}"`);
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

/** 파일과 -wal 의 크기 합. 없으면 0 */
function fileBytes(file: string) {
  const sizeOf = (target: string) => (fs.existsSync(target) ? fs.statSync(target).size : 0);
  return sizeOf(file) + sizeOf(`${file}-wal`);
}

export { DbFile, fileBytes };
export type { Db, DbSpec, Opened };
