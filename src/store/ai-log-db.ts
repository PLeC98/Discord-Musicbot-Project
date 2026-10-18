// AI 리퀘스트 로그 DB(ai-requests.db). AI 보조가 모델과 주고받은 것(requests)과 그 가벼운 통계(usage)를 둔다.
// requests 는 원문까지 담아 무겁다. 저장 용량(AI_LOG_MAX_MB)을 넘으면 오래된 것부터 삭제한다(store/ai-requests).
// usage 는 한 행 백 바이트 남짓이고 삭제하지 않는다(로그를 삭제해도 통계는 남는다). 백업 · 내보내기에는 싣지 않는다(설정이 아니다).
// 구조 버전이 맞지 않으면 열지 않고 멈춘다(삭제하고 다시 시작하라고 안내한다). 표를 더하기만 하면 버전을 올리지 않는다.

import { DbFile } from "./sqlite.ts";
import { koMatch } from "../rules/ko-search.ts";
import type { Db } from "./sqlite.ts";

const aiLogDb = new DbFile({
  label: "AI 리퀘스트 로그 DB",
  fileName: "ai-requests.db",
  version: 1,
  synchronous: "NORMAL",
  onMismatch: { lost: "AI 리퀘스트 로그 · 사용량 통계가 사라집니다." },
  createTables,
});

function createTables(db: Db) {
  // 목록 찾기: 한국어 찾기(조합 중인 글자 · 초성)를 SQL 에서 부른다(화면의 실시간 필터 aiLogMatches 와 같은 규칙). 연결마다 단다
  db.function("ko_match", { deterministic: true }, (text: unknown, q: unknown) => (koMatch(String(text ?? ""), String(q ?? "")) ? 1 : 0));
  // 삭제한 공간을 파일에서 돌려준다(로그는 계속 순환 삭제하므로 그대로 두면 파일이 늘기만 한다). 표가 없을 때만 적용된다
  db.pragma("auto_vacuum = INCREMENTAL");
  db.exec(`
            -- 주고받은 것 하나. 키는 쓰기 전에 가렸다. 토큰 열이 NULL 이면 못 읽었다. cost_usd 가 NULL 이면 가격 모름
            CREATE TABLE IF NOT EXISTS requests (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                at                INTEGER NOT NULL,
                source            TEXT NOT NULL,
                provider          TEXT NOT NULL,
                model             TEXT NOT NULL DEFAULT '',
                name              TEXT NOT NULL DEFAULT '',
                url               TEXT NOT NULL,
                method            TEXT NOT NULL,
                status            INTEGER,
                ok                INTEGER NOT NULL,
                aborted           INTEGER NOT NULL DEFAULT 0,
                took_ms           INTEGER NOT NULL,
                first_ms          INTEGER,
                attempt           INTEGER NOT NULL DEFAULT 1,
                guild_id          TEXT,
                genre             TEXT,
                candidates        INTEGER,
                input_tokens      INTEGER,
                output_tokens     INTEGER,
                cached_tokens     INTEGER,
                reasoning_tokens  INTEGER,
                cost_usd          REAL,
                error             TEXT,
                truncated         INTEGER NOT NULL DEFAULT 0,
                size_bytes        INTEGER NOT NULL,
                request_headers   TEXT NOT NULL,
                request_body      TEXT NOT NULL,
                response          TEXT NOT NULL
            );

            -- 통계 한 행(requests 와 같은 요청, 원문 없이). day 는 봇 시간대의 YYYY-MM-DD
            CREATE TABLE IF NOT EXISTS usage (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                at                INTEGER NOT NULL,
                day               TEXT NOT NULL,
                source            TEXT NOT NULL,
                provider          TEXT NOT NULL,
                model             TEXT NOT NULL DEFAULT '',
                name              TEXT NOT NULL DEFAULT '',
                guild_id          TEXT,
                ok                INTEGER NOT NULL,
                took_ms           INTEGER NOT NULL,
                input_tokens      INTEGER NOT NULL DEFAULT 0,
                output_tokens     INTEGER NOT NULL DEFAULT 0,
                cached_tokens     INTEGER NOT NULL DEFAULT 0,
                reasoning_tokens  INTEGER NOT NULL DEFAULT 0,
                cost_usd          REAL
            );
            CREATE INDEX IF NOT EXISTS idx_usage_at ON usage(at);
        `);
}

export { aiLogDb };
