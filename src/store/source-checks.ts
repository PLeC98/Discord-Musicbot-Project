// 음원 하나를 원본에서 재생할 수 있는지의 마지막 결과(source_checks). 재생 테스트 · 캐시의 다시 확인과, 직접 지정한 음원이 재생에 실패한 것이 남긴다. 키는 audioKeyOf(음원 주소).
// 캐시 DB 의 재생 테스트 열이 읽는다. 오디오 캐시 초기화의 곡 찾기 기록(ledger)에 든다.

import { cacheDb } from "./cache-db.ts";

/** 결과 하나. ok 가 아니면 code 는 문제 코드(라이브면 live). version: 그때 본 원본의 버전(audio_version 과 같은 꼴, 모르면 없다) */
type Check = ({ ok: true; at: number } | { ok: false; code: string; at: number }) & { version?: string | null };
type CheckRow = { audio_key: string; ok: number; code: string | null; checked_at: number; version: string | null };

// 열기 전에 부르면 던진다
const conn = () => cacheDb.get();
const toCheck = (row: CheckRow | undefined): Check | null => (row ? { ...(row.ok ? { ok: true as const, at: row.checked_at } : { ok: false as const, code: row.code ?? "failed", at: row.checked_at }), ...(row.version ? { version: row.version } : {}) } : null);

/** 결과를 남긴다(같은 음원의 앞 결과를 바꾼다). 원본 버전을 모르는 결과(재생 테스트 · 사라짐)는 앞서 본 버전을 지킨다 */
function recordCheck(audioKey: string, check: Check) {
  conn()
    .prepare("INSERT INTO source_checks (audio_key, ok, code, checked_at, version) VALUES (?, ?, ?, ?, ?) ON CONFLICT(audio_key) DO UPDATE SET ok = excluded.ok, code = excluded.code, checked_at = excluded.checked_at, version = COALESCE(excluded.version, source_checks.version)")
    .run(audioKey, check.ok ? 1 : 0, check.ok ? null : check.code, check.at, check.version ?? null);
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

/** 이 음원들의 결과. 결과가 없는 키는 빠진다 */
function checksOf(audioKeys: readonly string[]): Map<string, Check> {
  if (!audioKeys.length) return new Map();
  const rows = conn()
    .prepare<string[], CheckRow>(`SELECT * FROM source_checks WHERE audio_key IN (${audioKeys.map(() => "?").join(",")})`)
    .all(...audioKeys);
  return new Map(rows.map((row) => [row.audio_key, toCheck(row)!]));
}

export { recordCheck, getCheck, allChecks, checksOf };
export type { Check };
