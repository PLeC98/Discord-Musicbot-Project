// SQLite 파일 하나를 여는 래퍼. DB 파일마다(설정, 실행 상태, 캐시, AI 리퀘스트 로그, 로그인 세션) 이것으로 자기 파일을 정한다(stores.ts 가 함께 연다).
// 불러와도 열리지 않는다. 열기 전에 get() 을 부르면 던진다(테스트, 스크립트가 실제 DB 를 건드리지 않게).

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { ownerOnly } from "../infra/owner-only.ts";
import logger from "../infra/log/logger.ts";
import { messageOf } from "../rules/error-kind.ts";
const log = logger.child({ category: "core" });

type Db = Database.Database;

/** PRAGMA auto_vacuum이 돌려주는 수 */
const AUTO_VACUUM = { INCREMENTAL: 2 } as const;

/**
 * 구조 버전이 맞지 않을 때의 안내. 어느 파일이든 열지 않고 멈춘다(저절로 삭제하고 새로 만들지 않는다).
 * lost: 삭제해도 되는 파일. 삭제하면 무엇을 잃는지(안내는 "이 파일을 삭제하고 다시 시작하라")
 * hint: 삭제하면 안 되는 파일의 안내(설정 DB)
 */
type OnMismatch = { lost: string } | { hint: (found: number, file: string) => string };

type DbSpec = {
  /** 로그, 오류에 쓰는 이름 */
  label: string;
  /** 기본 파일 이름(stores 가 폴더와 잇는다) */
  fileName: string;
  /** 구조를 맞지 않게 바꿀 때마다 올린다. 표를 더하기만 하면 올리지 않는다(CREATE TABLE IF NOT EXISTS) */
  version: number;
  /** 쓰기마다 디스크까지 기다리나. 잃으면 안 되는 파일은 FULL */
  synchronous: "NORMAL" | "FULL";
  onMismatch: OnMismatch;
  /** 삭제한 공간을 파일에서 돌려주는지(auto_vacuum). 테이블을 만들기 전, WAL을 켜기 전에만 적용되므로 테이블 만들기에 두지 않는다 */
  autoVacuum?: "INCREMENTAL";
  /** 테이블 만들기. 이미 있으면 그대로 둔다. 구조 버전과 한 트랜잭션에서 돈다 */
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
      // -wal, -shm 은 SQLite 가 본체와 같은 권한으로 만든다
      ownerOnly(file);
      if (this.spec.autoVacuum) next.pragma(`auto_vacuum = ${this.spec.autoVacuum}`);
      next.pragma("journal_mode = WAL");
      next.pragma(`synchronous = ${this.spec.synchronous}`);
      next.pragma("foreign_keys = ON");
      next.pragma("busy_timeout = 5000");
      this.settle(next, file);
      // 만드는 도중 멈춰 테이블만 있고 버전이 없는 파일이 남지 않게
      next.transaction(() => {
        this.spec.createTables(next);
        next.pragma(`user_version = ${this.spec.version}`);
      })();
      if (this.spec.autoVacuum && next.pragma("auto_vacuum", { simple: true }) !== AUTO_VACUUM[this.spec.autoVacuum]) this.vacuum(next, file);
      this.conn = next;
    } catch (error) {
      next.close();
      throw error;
    }
  }

  // 이 설정 없이 만든 파일을 VACUUM으로 바꾼다(한 번). 파일 크기만큼의 여유 공간이 더 든다. 못 바꿔도 파일은 그대로 쓴다(다음 기동에 다시 해 본다)
  vacuum(db: Db, file: string) {
    const bytes = fs.statSync(file).size;
    log.info(`${this.spec.label}를 한 번 다시 씀(삭제한 공간을 돌려주는 설정, ${Math.ceil(bytes / 1024 / 1024)}MB)`);
    try {
      db.exec("VACUUM");
    } catch (error) {
      log.warn(`${this.spec.label} 다시 쓰기 실패(그대로 열고 다음 기동 시 다시 시도): ${messageOf(error)}. 그때까지 기록을 삭제해도 파일이 줄지 않음`);
    }
    // VACUUM이 쓴 만큼 커진 -wal을 체크포인트해 줄인다. 실패했어도 한다(롤백된 쓰기도 -wal에 남는다).
    // 다른 연결이 읽는 중이면 던지지 않고 결과의 busy로 알린다
    try {
      const [result] = db.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
      if (result?.busy) log.warn(`${this.spec.label}의 -wal 줄이기 실패(다른 프로그램이 읽는 중). 봇이 쓰는 동안 차차 줄어듦`);
    } catch (error) {
      log.warn(`${this.spec.label}의 -wal 줄이기 실패: ${messageOf(error)}`);
    }
  }

  // 표가 있는데 버전이 다르면 멈춘다(파일은 손대지 않는다). 표가 없으면 새 파일이다
  settle(db: Db, file: string) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all() as string[];
    const found = db.pragma("user_version", { simple: true }) as number;
    if (!tables.length || found === this.spec.version) return;
    const rule = this.spec.onMismatch;
    const message = "hint" in rule ? rule.hint(found, file) : `${this.spec.label} 구조가 이 봇과 맞지 않아 열지 않습니다 (DB v${found}, 봇 v${this.spec.version}): ${file}. 봇을 종료하고 이 파일(같은 이름의 -wal, -shm 포함)을 삭제한 뒤 다시 시작하면 새로 만듭니다. 삭제하면 ${rule.lost}`;
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
