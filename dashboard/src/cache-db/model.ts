// 캐시 DB 격자의 모양: 셀 값을 그리는 글 · 바뀐 것(쓰기 전) · 바뀐 것에서 조작 목록. 화면 부품(components/CacheDb.vue)이 쓴다

import type { TrackCacheOp, TrackCacheRow, TrackCacheTable, TrackFileRow, TrackRequestRow, TrackAgeRow } from "../../../src/dashboard/contract/track-cache.ts";
import { formatBytes, formatDuration } from "../../../src/ui/format.ts";
import { text } from "../text/index.ts";
const T = text.cacheDb;

type AnyRow = TrackCacheRow;

const pad = (n: number) => String(n).padStart(2, "0");
/** 격자의 때: 2026-10-17 21:04(DB 프로그램처럼 짧게) */
function stamp(at: number | null): string {
  if (at === null) return T.values.none;
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 편집할 수 있는 열: 요청 테이블의 재생 음원 하나(새 행은 요청도) */
const editable = (table: TrackCacheTable, column: string) => table === "requests" && column === "audioUrl";

const checkText = (check: TrackRequestRow["check"]) => (check === null ? "" : check.ok ? T.values.checkOk : check.code === "live" ? T.values.checkLive : T.values.checkFail);

// 요청 테이블에만 있는 열의 글. 그 밖의 열이면 null
function requestCellText(r: TrackRequestRow, column: string): string | null {
  if (column === "pinnedAt") return r.pinnedAt === null ? "" : stamp(r.pinnedAt);
  if (column === "file") return T.values.file[r.file];
  if (column === "check") return checkText(r.check);
  if (column === "ageMarkedAt") return r.ageMarkedAt === null ? "" : stamp(r.ageMarkedAt);
  return null;
}

// 수로 된 열의 글(크기 · 길이 · 수)
const NUMBER_TEXT: Record<string, (value: number) => string> = { size: formatBytes, duration: formatDuration, plays: String, requests: String };

/** 셀 값의 글(그리는 것). 원시 값은 rawText */
function cellText(table: TrackCacheTable, row: AnyRow, column: string): string {
  const own = table === "requests" ? requestCellText(row as TrackRequestRow, column) : null;
  if (own !== null) return own;
  if (table === "files" && column === "status") return T.values.status[(row as TrackFileRow).status];
  const value = (row as Record<string, unknown>)[column];
  const asNumber = NUMBER_TEXT[column];
  if (asNumber) return value === null ? T.values.none : asNumber(value as number);
  if (/At$/.test(column)) return stamp(value as number | null);
  return value === null || value === undefined ? T.values.none : String(value);
}

/** 원시 값(복사 · 이 값으로 필터) */
function rawText(row: AnyRow, column: string): string {
  if (column === "check") {
    const check = (row as TrackRequestRow).check;
    return check ? (check.ok ? "ok" : check.code) : "";
  }
  const value = (row as Record<string, unknown>)[column];
  return value === null || value === undefined ? "" : String(value);
}

/** 행의 키(바뀐 것 · 선택한 것을 행 번호가 아니라 이것으로 든다) */
function keyOf(table: TrackCacheTable, row: AnyRow): string {
  if (table === "requests") return (row as TrackRequestRow).requestKey;
  if (table === "files") return (row as TrackFileRow).audioKey;
  return (row as TrackAgeRow).videoId;
}

// ── 바뀐 것(쓰기 전) ──────────────────────────────────────────────────────

type NewRow = { id: number; requestKey: string; audioUrl: string };
type Changes = {
  /** 요청의 음원 주소를 직접 지정한 음원으로: 요청 키 → 새 주소 · 본 지정 음원 */
  pins: Map<string, { audioUrl: string; expect: string | null }>;
  unpins: Map<string, string>;
  clears: Map<string, string>;
  deleteRequests: Map<string, { ledgerAudioUrl: string | null; pinned: string | null }>;
  deleteFiles: Map<string, number | null>;
  clearAges: Map<string, number>;
  newRows: NewRow[];
};

const emptyChanges = (): Changes => ({ pins: new Map(), unpins: new Map(), clears: new Map(), deleteRequests: new Map(), deleteFiles: new Map(), clearAges: new Map(), newRows: [] });
const changeCount = (c: Changes) => c.pins.size + c.unpins.size + c.clears.size + c.deleteRequests.size + c.deleteFiles.size + c.clearAges.size + c.newRows.length;

/** 바뀐 것 → 조작 목록. 순서를 함께 돌려줘 결과를 셀에 다시 붙인다(where: 테이블 · 행 키 · 열) */
function opsOf(c: Changes): Array<{ op: TrackCacheOp; where: { table: TrackCacheTable; key: string; column: string | null } }> {
  const out: Array<{ op: TrackCacheOp; where: { table: TrackCacheTable; key: string; column: string | null } }> = [];
  for (const row of c.newRows) out.push({ op: { op: "pin", requestKey: row.requestKey.trim(), audioUrl: row.audioUrl.trim(), expect: null }, where: { table: "requests", key: `new:${row.id}`, column: "audioUrl" } });
  for (const [requestKey, one] of c.pins) out.push({ op: { op: "pin", requestKey, audioUrl: one.audioUrl, expect: one.expect }, where: { table: "requests", key: requestKey, column: "audioUrl" } });
  for (const [requestKey, expect] of c.unpins) out.push({ op: { op: "unpin", requestKey, expect }, where: { table: "requests", key: requestKey, column: "audioUrl" } });
  for (const [requestKey, expect] of c.clears) out.push({ op: { op: "clearResult", requestKey, expect }, where: { table: "requests", key: requestKey, column: "audioUrl" } });
  for (const [requestKey, expect] of c.deleteRequests) out.push({ op: { op: "deleteRequest", requestKey, expect }, where: { table: "requests", key: requestKey, column: null } });
  for (const [audioKey, expect] of c.deleteFiles) out.push({ op: { op: "deleteFile", audioKey, expect }, where: { table: "files", key: audioKey, column: "file" } });
  for (const [videoId, expect] of c.clearAges) out.push({ op: { op: "clearAge", videoId, expect }, where: { table: "age", key: videoId, column: "ageMarkedAt" } });
  return out;
}

/** 쓰기 전에 밝히는 개수 */
function summaryOf(c: Changes): string[] {
  const parts: string[] = [];
  if (c.pins.size) parts.push(T.changes.pins(c.pins.size));
  if (c.newRows.length) parts.push(T.changes.newRows(c.newRows.length));
  if (c.unpins.size) parts.push(T.changes.unpins(c.unpins.size));
  if (c.clears.size) parts.push(T.changes.clears(c.clears.size));
  if (c.deleteRequests.size) parts.push(T.changes.rows(c.deleteRequests.size));
  if (c.deleteFiles.size) parts.push(T.changes.files(c.deleteFiles.size));
  if (c.clearAges.size) parts.push(T.changes.ages(c.clearAges.size));
  return parts;
}

export { stamp, editable, cellText, rawText, keyOf, emptyChanges, changeCount, opsOf, summaryOf };
export type { AnyRow, NewRow, Changes };
