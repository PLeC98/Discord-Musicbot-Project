// 음원 하나를 재생할 수 있는지의 마지막 결과(source_checks). 재생 테스트와, 직접 지정한 음원이 재생에 실패한 것이 남긴다. 키는 audioKeyOf(음원 주소).
// 캐시 DB 의 재생 테스트 열이 읽는다. 캐시 초기화가 비운다.

import { cacheDb } from "./cache-db.ts";

/** 결과 하나. ok 가 아니면 code 는 문제 코드(라이브면 live) */
type Check = { ok: true; at: number } | { ok: false; code: string; at: number };
type CheckRow = { audio_key: string; ok: number; code: string | null; checked_at: number };

// 열기 전에 부르면 던진다
const conn = () => cacheDb.get();
const toCheck = (row: CheckRow | undefined): Check | null => (row ? (row.ok ? { ok: true, at: row.checked_at } : { ok: false, code: row.code ?? "failed", at: row.checked_at }) : null);

/** 결과를 남긴다(같은 음원의 앞 결과를 바꾼다) */
function recordCheck(audioKey: string, check: Check) {
  conn()
    .prepare("INSERT INTO source_checks (audio_key, ok, code, checked_at) VALUES (?, ?, ?, ?) ON CONFLICT(audio_key) DO UPDATE SET ok = excluded.ok, code = excluded.code, checked_at = excluded.checked_at")
    .run(audioKey, check.ok ? 1 : 0, check.ok ? null : check.code, check.at);
}

/** 이 음원의 마지막 결과. 없으면 null */
function getCheck(audioKey: string): Check | null {
  return toCheck(conn().prepare<[string], CheckRow>("SELECT * FROM source_checks WHERE audio_key = ?").get(audioKey));
}

/** 결과 전부. 키는 음원 키(캐시 DB 화면의 읽기) */
function allChecks(): Map<string, Check> {
  return new Map(
    conn()
      .prepare<[], CheckRow>("SELECT * FROM source_checks")
      .all()
      .map((row) => [row.audio_key, toCheck(row)!]),
  );
}

export { recordCheck, getCheck, allChecks };
export type { Check };
