// SQLite 파일 하나를 여는 틀. 설정 · 실행 상태 · 캐시가 각자 이것으로 자기 파일을 정한다(stores.ts 가 함께 연다).
// 불러와도 열리지 않는다. 열기 전에 get() 을 부르면 던진다(시험 · 스크립트가 실제 DB 를 건드리지 않게).

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { ownerOnly } from "../infra/owner-only.ts";

type Db = Database.Database;

/**
 * 구조 버전이 맞지 않을 때의 안내. 어느 파일이든 열지 않고 멈춘다(옮기기 코드도, 저절로 지우고 새로 만들기도 두지 않는다).
 * lost: 지워도 되는 파일. 지우면 무엇을 잃는지(안내는 "이 파일을 지우고 다시 켜라")
 * hint: 지우면 안 되는 파일의 안내(설정 DB)
 */
type OnMismatch = { lost: string } | { hint: (found: number, file: string) => string };

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
};

class DbFile {
  readonly spec: DbSpec;
  conn: Db | null = null;

  constructor(spec: DbSpec) {
    this.spec = spec;
  }

  /** 이미 열었으면 그대로. 버전이 맞지 않으면 spec.onMismatch 의 안내로 던진다 */
  open(file: string) {
    if (this.conn) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });

    const next = new Database(file);
    try {
      // -wal · -shm 은 SQLite 가 본체와 같은 권한으로 만든다
      ownerOnly(file);
      next.pragma("journal_mode = WAL");
      next.pragma(`synchronous = ${this.spec.synchronous}`);
      next.pragma("foreign_keys = ON");
      next.pragma("busy_timeout = 5000");
      this.settle(next, file);
      this.spec.createTables(next);
      next.pragma(`user_version = ${this.spec.version}`);
      this.conn = next;
    } catch (error) {
      next.close();
      throw error;
    }
  }

  // 표가 있는데 버전이 다르면 멈춘다(파일은 손대지 않는다). 표가 없으면 새 파일이다
  settle(db: Db, file: string) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all() as string[];
    const found = db.pragma("user_version", { simple: true }) as number;
    if (!tables.length || found === this.spec.version) return;
    const rule = this.spec.onMismatch;
    const message = "hint" in rule ? rule.hint(found, file) : `${this.spec.label} 구조가 이 봇과 맞지 않아 열지 않습니다 (DB v${found}, 봇 v${this.spec.version}): ${file}. 봇을 끄고 이 파일(같은 이름의 -wal · -shm 포함)을 지운 뒤 다시 켜면 새로 만듭니다. 지우면 ${rule.lost}`;
    throw Object.assign(new Error(message), { code: "SCHEMA_MISMATCH" });
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

/** 파일과 -wal 의 크기 합. 없으면 0 */
function fileBytes(file: string) {
  const sizeOf = (target: string) => (fs.existsSync(target) ? fs.statSync(target).size : 0);
  return sizeOf(file) + sizeOf(`${file}-wal`);
}

export { DbFile, fileBytes };
export type { Db, DbSpec };
