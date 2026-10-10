// DB 파일들을 함께 열고 닫는다. 무엇을 어느 파일에 두나:
//   settings.db  사람이 정한 값(서버별 설정). 지우지 않는다. 구조가 맞지 않으면 멈춘다
//   state.db     다시 켰을 때 이어 갈 실행 상태(저장된 대기열 · 음성 채널 상태 · 재생 패널 자리). 구조가 바뀌면 새로
//   cache.db     다시 받으면 되는 것(받은 곡 색인 · 링크 장부 · 바깥 서비스의 답). 구조가 바뀌면 새로, 초기화는 표를 모두 비운다
// 로그인 세션(sessions.db)은 대시보드가 따로 연다(dashboard/session-store).

import path from "path";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "core" });
import { PROJECT } from "../infra/project-paths.ts";
import { fileBytes } from "./sqlite.ts";
import type { DbFile } from "./sqlite.ts";
import { settingsDb } from "./settings-db.ts";
import { stateDb } from "./state-db.ts";
import { cacheDb } from "./cache-db.ts";

// 여는 차례. 설정이 깨졌으면 다른 파일을 건드리기 전에 멈춘다
const FILES: DbFile[] = [settingsDb, stateDb, cacheDb];

// 새로 만들었을 때 잃은 것
const LOST: Map<DbFile, string> = new Map([
  [stateDb, "저장된 대기열 · 음성 채널 상태 · 재생 패널 자리를 비웠습니다. 이번 기동은 대기열을 이어 틀지 못합니다"],
  [cacheDb, "받은 곡 색인 · 링크 장부를 비웠습니다. 색인을 잃은 곡 파일은 기동 정리가 지우고 다음 재생부터 다시 받습니다"],
]);

/** dir: DB 를 둘 폴더. 운영은 database/, 시험은 임시 폴더. 하나라도 못 열면 연 것을 닫고 던진다 */
function open(dir = PROJECT.database) {
  try {
    for (const file of FILES) {
      const opened = file.open(path.join(dir, file.spec.fileName));
      if (opened.recreated) log.warn(`${file.spec.label} 구조가 바뀌어 새로 만들었습니다 (v${opened.found} → v${file.spec.version}). ${LOST.get(file) ?? ""}`.trim());
    }
  } catch (error) {
    close();
    throw error;
  }
  log.info({ tags: ["startup"] }, "SQLite DB 준비 완료");
}

function close() {
  for (const file of FILES) file.close();
}

/** 봇 상태 탭: DB 파일 크기 합(-wal 포함) · 그 폴더 · 줄 수(곡 찾기 기억 · SponsorBlock 구간 기억 · 저장된 대기열) */
function dbStats() {
  const count = (file: DbFile, table: string) => (file.get().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const files = FILES.map((file) => file.get().name);
  return {
    dir: path.dirname(cacheDb.get().name),
    bytes: files.reduce((sum, file) => sum + fileBytes(file), 0),
    lookups: count(cacheDb, "track_lookup"),
    sponsorSegments: count(cacheDb, "sponsorblock_cache"),
    sessions: count(stateDb, "player_sessions"),
  };
}

export { open, close, dbStats };
