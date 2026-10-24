// 봇 전체 초기화(휴대폰의 기기 전체 초기화). DB 연결이 열려 있어 켜진 채 지우지 않는다: 대시보드가 마커(database/reset.request)를 걸고 다시 시작하면,
// 다음 기동이 DB 를 열기 전(main 의 openSettings 첫머리, 스냅샷 복원보다 앞)에 마커를 보고 지운다. 사람이 누른 것만이고 구조 버전 멈춤과 무관하다.
// 남기는 것: .env · vendor/ · logs/(DB 폴더 밖) · 설정 스냅샷(database/backups) · 명령 전체 백업(database/full-backups, 봇이 읽지 않는 사람의 백업) ·
// 이번 실행이 이미 쓰는 실행 기록(run-state.json · child-processes.json).
// 그 밖의 DB 폴더 안과 캐시 폴더 안은 모두 지운다(새로 생기는 파일도 따로 적지 않아도 지운다). 마커는 다 지운 뒤 마지막에 지운다(막히면 다음 기동이 이어서 지운다).

import fs from "fs";
import path from "path";
import { PROJECT } from "../infra/project-paths.ts";
import { codedError, messageOf } from "../rules/error-kind.ts";
import { settingsDb } from "./settings-db.ts";

const MARKER = "reset.request";
/** DB 폴더에서 남기는 것 */
const KEEP = new Set(["backups", "full-backups", "run-state.json", "child-processes.json", MARKER]);

type Dirs = { database: string; audioCache: string };
const REAL: Dirs = { database: PROJECT.database, audioCache: PROJECT.audioCache };
/** 마커를 두는 DB 폴더(열린 settings.db 가 있는 곳. 테스트의 임시 폴더면 실제 봇 폴더를 건드리지 않는다). 열기 전이면 던진다 */
const dbDir = () => path.dirname(settingsDb.get().name);

/** 봇 전체 초기화를 예약한다(다음 기동에 지운다) */
function request(database = dbDir()) {
  fs.writeFileSync(path.join(database, MARKER), JSON.stringify({ at: Date.now() }));
}

/** 예약을 취소한다. 예약되어 있었으면 true */
function cancel(database = dbDir()): boolean {
  const marker = path.join(database, MARKER);
  if (!fs.existsSync(marker)) return false;
  fs.rmSync(marker, { force: true });
  return true;
}

/** 예약되어 있나 */
const requested = (database = dbDir()) => fs.existsSync(path.join(database, MARKER));

type Remove = (target: string) => void;
const removeTree: Remove = (target) => fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });

// 폴더 안의 것을 지운다(폴더는 둔다). keep 에 든 이름은 건너뛴다
function emptyDir(dir: string, remove: Remove, keep: ReadonlySet<string> = new Set()) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) if (!keep.has(name)) remove(path.join(dir, name));
}

/**
 * 기동 때 DB 를 열기 전에. 예약되어 있으면 지우고 true. 지우다 막히면(Windows 잠금) RESET_FAILED 로 던진다(마커가 남아 다음 기동이 이어서 지운다)
 * @param remove  하나를 지우는 함수(테스트가 막힌 파일을 흉내 낸다)
 */
function applyRequested(dirs: Dirs = REAL, remove: Remove = removeTree): boolean {
  if (!requested(dirs.database)) return false;
  try {
    emptyDir(dirs.database, remove, KEEP);
    emptyDir(dirs.audioCache, remove);
  } catch (error) {
    throw codedError("RESET_FAILED", `봇 전체 초기화를 끝내지 못했습니다: ${messageOf(error)}. 그 파일을 연 프로그램을 닫고 다시 시작하면 이어서 지웁니다`, { cause: error });
  }
  fs.rmSync(path.join(dirs.database, MARKER), { force: true });
  return true;
}

export { request, cancel, requested, applyRequested, KEEP };
