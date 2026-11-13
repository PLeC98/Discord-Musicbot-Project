// 음원의 음량 값(loudness 표). 볼륨 정규화가 게인을 정할 때 쓴다. 키는 (오디오 키, 종류).
// 종류: file(캐시 파일 전체를 잰 값), heard-full(처음부터 끝까지 들으며 잰 값), heard-part(일부만 들으며 잰 값, 라이브와 라디오에서 이전에 잰 값),
// file-failed(측정에 실패한 캐시 파일. 게인에 쓰지 않고 다시 재지 않기 위한 표시).
// 캐시 파일이 정리돼도 값은 남는다. 오디오 캐시 초기화에서 캐시 파일(files)을 비울 때 함께 지워진다.

import { cacheDb } from "./cache-db.ts";

/** 측정 방식의 버전. 바꾸면 file-failed 로 표시된 파일도 다시 잰다 */
const ALGO = 1;
/** 기존 heard-part 를 교체하는 들은 양의 기준(초). 새 들은 양이 min(기존 들은 양, 이 기준) 이상이면 교체한다 */
const PART_REPLACE_SEC = 600;
/** heard-part 는 잰 지 이 기간이 지나면 들은 양을 따지지 않고 교체한다 */
const PART_STALE_MS = 30 * 24 * 3600 * 1000;
/** 마지막으로 쓴 지 이 기간이 지난 행은 지운다 */
const UNUSED_MS = 180 * 24 * 3600 * 1000;
/** file 값의 중앙값을 시작값으로 쓰는 데 필요한 최소 개수 */
const MEDIAN_MIN = 30;

type Kind = "file" | "heard-full" | "heard-part" | "file-failed";
/** 잰 값. integrated: 통합 음량(LUFS), truePeak: 피크(dBTP, heard-* 는 샘플 피크 dBFS), peakP99: 100ms 프레임 피크의 상위 1%(dB) */
type Measured = { integrated: number; truePeak: number; peakP99: number };
/** 잰 소리의 식별 정보. 모르는 것은 null */
type Identity = { sizeBytes: number | null; durationSec: number | null; audioVersion: string | null };
type Row = Measured & Identity & { kind: Kind; heardSec: number | null; algo: number; measuredAt: number; usedAt: number };
/** 한 음원의 값들. 없는 종류는 빠진다 */
type Rows = Partial<Record<Kind, Row>>;

type DbRow = { audio_key: string; kind: Kind; integrated: number | null; true_peak: number | null; peak_p99: number | null; heard_sec: number | null; size_bytes: number | null; duration_sec: number | null; audio_version: string | null; algo: number; measured_at: number; used_at: number };

// 열기 전에 부르면 예외를 던진다
const conn = () => cacheDb.get();

const toRow = (r: DbRow): Row => ({
  kind: r.kind,
  integrated: r.integrated ?? NaN,
  truePeak: r.true_peak ?? NaN,
  peakP99: r.peak_p99 ?? NaN,
  heardSec: r.heard_sec,
  sizeBytes: r.size_bytes,
  durationSec: r.duration_sec,
  audioVersion: r.audio_version,
  algo: r.algo,
  measuredAt: r.measured_at,
  usedAt: r.used_at,
});

let median: { value: number | null } | null = null;
let prunedAt = 0;

type Put = { value: Measured | null; identity: Identity; heardSec: number | null };

function put(audioKey: string, kind: Kind, { value, identity, heardSec }: Put, now: number) {
  conn()
    .prepare(
      `INSERT INTO loudness (audio_key, kind, integrated, true_peak, peak_p99, heard_sec, size_bytes, duration_sec, audio_version, algo, measured_at, used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(audio_key, kind) DO UPDATE SET integrated = excluded.integrated, true_peak = excluded.true_peak, peak_p99 = excluded.peak_p99, heard_sec = excluded.heard_sec,
         size_bytes = excluded.size_bytes, duration_sec = excluded.duration_sec, audio_version = excluded.audio_version, algo = excluded.algo, measured_at = excluded.measured_at, used_at = excluded.used_at`,
    )
    .run(audioKey, kind, value?.integrated ?? null, value?.truePeak ?? null, value?.peakP99 ?? null, heardSec, identity.sizeBytes, identity.durationSec, identity.audioVersion, ALGO, now, now);
}

/** 캐시 파일을 잰 값을 저장한다. 그 음원의 file-failed 표시는 지운다 */
function recordFile(audioKey: string, value: Measured, identity: Identity, now = Date.now()) {
  conn().transaction(() => {
    put(audioKey, "file", { value, identity, heardSec: null }, now);
    conn().prepare("DELETE FROM loudness WHERE audio_key = ? AND kind = 'file-failed'").run(audioKey);
  })();
  median = null;
}

/** 파일 탓으로 캐시 파일을 재지 못했음을 기록한다. 같은 파일, 같은 측정 방식이면 다시 재지 않는다 */
function recordFileFailed(audioKey: string, identity: Identity, now = Date.now()) {
  put(audioKey, "file-failed", { value: null, identity, heardSec: null }, now);
}

/**
 * 들으며 잰 값을 저장한다. file 값이 있으면 저장하지 않는다. heard-full 은 늘 교체하고, heard-part 는 새 들은 양이
 * min(기존 들은 양, PART_REPLACE_SEC) 이상이거나 기존 값이 PART_STALE_MS 보다 오래됐을 때만 교체한다(교체하지 않아도 마지막 사용 시각은 갱신한다).
 * 저장했으면 true
 */
function recordHeard(audioKey: string, kind: "heard-full" | "heard-part", heard: { value: Measured; identity: Identity; heardSec: number }, now = Date.now()): boolean {
  const { heardSec } = heard;
  return conn().transaction(() => {
    const rows = rowsOf(audioKey);
    if (rows.file) return false;
    const old = rows[kind];
    if (kind === "heard-part" && old && now - old.measuredAt <= PART_STALE_MS && heardSec < Math.min(old.heardSec ?? 0, PART_REPLACE_SEC)) {
      touch(audioKey, kind, now);
      return false;
    }
    put(audioKey, kind, heard, now);
    return true;
  })();
}

/** 음원의 저장된 값들 */
function rowsOf(audioKey: string): Rows {
  const rows = conn().prepare<[string], DbRow>("SELECT * FROM loudness WHERE audio_key = ?").all(audioKey);
  return Object.fromEntries(rows.map((r) => [r.kind, toRow(r)])) as Rows;
}

/** 마지막 사용 시각을 갱신한다(오래된 행 정리의 기준) */
function touch(audioKey: string, kind: Kind, now = Date.now()) {
  conn().prepare("UPDATE loudness SET used_at = ? WHERE audio_key = ? AND kind = ?").run(now, audioKey, kind);
}

/** 같은 파일(크기, 길이)과 같은 측정 방식의 file-failed 표시가 있는지 */
function failedBefore(audioKey: string, identity: Pick<Identity, "sizeBytes" | "durationSec">): boolean {
  const row = rowsOf(audioKey)["file-failed"];
  return Boolean(row && row.algo === ALGO && row.sizeBytes === identity.sizeBytes && row.durationSec === identity.durationSec);
}

/** file 값의 통합 음량 중앙값. MEDIAN_MIN 개보다 적으면 null. 메모리에 캐시하고 file 값을 저장하거나 초기화하면 다시 계산한다 */
function fileMedian(): number | null {
  if (median) return median.value;
  const count = conn().prepare("SELECT COUNT(*) FROM loudness WHERE kind = 'file'").pluck().get() as number;
  const value =
    count >= MEDIAN_MIN
      ? (conn()
          .prepare("SELECT integrated FROM loudness WHERE kind = 'file' ORDER BY integrated LIMIT 1 OFFSET ?")
          .pluck()
          .get(Math.floor(count / 2)) as number)
      : null;
  median = { value };
  return value;
}

/** 메모리 캐시를 비운다(초기화로 표를 비운 뒤 부른다) */
function forgetMemory() {
  median = null;
}

/** UNUSED_MS 동안 쓰지 않은 행을 지운다. 하루에 한 번만 지운다(정기 정리에서 부른다). 지운 행 수 */
function pruneIfDue(now = Date.now()): number {
  if (now - prunedAt < 24 * 3600 * 1000) return 0;
  prunedAt = now;
  const removed = conn()
    .prepare("DELETE FROM loudness WHERE used_at < ?")
    .run(now - UNUSED_MS).changes;
  if (removed) median = null;
  return removed;
}

export { ALGO, recordFile, recordFileFailed, recordHeard, rowsOf, touch, failedBefore, fileMedian, forgetMemory, pruneIfDue };
export type { Kind, Measured, Identity, Row, Rows };
