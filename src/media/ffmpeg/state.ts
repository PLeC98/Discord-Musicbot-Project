// vendor/ffmpeg의 기록(state.json): 지금 쓰는 빌드, 이전 빌드, 실행되지 않아 물린 릴리스, 고정.
// 설치 스크립트(media/ffmpeg/install)와 봇(media/ffmpeg/path, 기동 정리)이 함께 쓴다. 고치는 곳은 모두 폴더 잠금 안에서 새로 읽고 고쳐 쓴다(그사이 다른 프로세스가 바꾼 고정이나 가리킴을 덮어쓰지 않게)

import fs from "node:fs";
import path from "node:path";
import { acquireInstanceLock } from "../../infra/instance-lock.ts";

/** 받아 둔 빌드 하나. folder: vendor/ffmpeg 안의 폴더 이름, release: BtbN 릴리스 태그, asset: 에셋 이름, version: ffmpeg -version이 출력한 버전 */
type FfmpegBuild = { folder: string; release: string; asset: string; sha256: string; version: string };
/** active: 쓰는 빌드, previous: 이전 빌드(active가 실행되지 않으면 이것으로 뜬다), rejected: 이 환경에서 실행되지 않은 릴리스, pin: 고정한 릴리스(없으면 코드의 기본값) */
type FfmpegState = { active: FfmpegBuild | null; previous: FfmpegBuild | null; rejected: string[]; pin: string | null };
/** none: 기록이 없다(받은 적 없음), broken: 읽지 못했다(error는 원인) */
type ReadState = { kind: "ok"; state: FfmpegState } | { kind: "none" } | { kind: "broken"; error: string };

const STATE_FILE = "state.json";
const EMPTY: FfmpegState = { active: null, previous: null, rejected: [], pin: null };
/** 잠금을 기다리는 상한(ms). 다른 프로세스가 받는 중이면 끝날 때까지 기다린다 */
const LOCK_WAIT_MS = 15 * 60_000;
const LOCK_POLL_MS = 500;

/** BtbN autobuild 태그 형식(autobuild-YYYY-MM-DD-HH-MM). 이 형식만 받는다(latest처럼 가리키는 빌드가 바뀌는 태그는 받지 않는다) */
const isReleaseTag = (text: string) => /^autobuild-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(text);

const isBuild = (value: unknown): value is FfmpegBuild => {
  const b = value as Partial<FfmpegBuild> | null;
  return !!b && typeof b.folder === "string" && /^[\w.-]+$/.test(b.folder) && typeof b.release === "string" && isReleaseTag(b.release) && typeof b.asset === "string" && typeof b.sha256 === "string" && typeof b.version === "string";
};

/** 기록을 읽는다. 형식이 올바르지 않으면 broken(폴더 이름이 vendor/ffmpeg 밖을 가리키는 경우 포함) */
function readState(dir: string): ReadState {
  const file = path.join(dir, STATE_FILE);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" };
    return { kind: "broken", error: String((error as Error).message) };
  }
  try {
    const parsed = parseState(JSON.parse(raw) as Partial<Record<keyof FfmpegState, unknown>>);
    return typeof parsed === "string" ? { kind: "broken", error: parsed } : { kind: "ok", state: parsed };
  } catch (error) {
    return { kind: "broken", error: String((error as Error).message) };
  }
}

/** 읽은 JSON의 형식을 검사한다. 올바르지 않으면 그 사유 */
function parseState(data: Partial<Record<keyof FfmpegState, unknown>>): FfmpegState | string {
  const active = data.active ?? null;
  const previous = data.previous ?? null;
  const rejected = data.rejected ?? [];
  const pin = data.pin ?? null;
  if ((active !== null && !isBuild(active)) || (previous !== null && !isBuild(previous))) return "빌드 기록 형식이 올바르지 않음";
  if (!Array.isArray(rejected) || !rejected.every((r) => typeof r === "string" && isReleaseTag(r))) return "물린 릴리스 목록 형식이 올바르지 않음";
  if (pin !== null && !(typeof pin === "string" && isReleaseTag(pin))) return "고정 형식이 올바르지 않음";
  return { active, previous, rejected, pin };
}

/** 기록을 쓴다. 쓰다 만 파일이 남지 않게 임시 파일에 먼저 쓰고 바꿔 넣는다 */
function writeState(dir: string, state: FfmpegState) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, STATE_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, file);
}

/** 깨진 기록을 다른 이름으로 옮겨 둔다(직접 열어 볼 수 있게 지우지 않는다). 옮긴 경로를 반환한다 */
function setAsideBroken(dir: string, now: number): string {
  const aside = path.join(dir, `${STATE_FILE}.broken-${now}`);
  fs.renameSync(path.join(dir, STATE_FILE), aside);
  return aside;
}

/**
 * 폴더 잠금을 걸고 fn을 부른다. 다른 프로세스가 잠그고 있으면 상한까지 기다리고, 그래도 풀리지 않으면 { holder }를 반환한다.
 * 잠금은 인스턴스 잠금과 같은 방식(infra/instance-lock)을 vendor/ffmpeg 폴더에 쓴다
 */
async function withLock<T>(dir: string, fn: () => Promise<T> | T, waitMs = LOCK_WAIT_MS): Promise<{ ok: true; value: T } | { ok: false; holder: number | null }> {
  fs.mkdirSync(dir, { recursive: true });
  const until = Date.now() + waitMs;
  for (;;) {
    const held = await acquireInstanceLock(dir);
    if (held.ok) {
      try {
        return { ok: true, value: await fn() };
      } finally {
        await held.release();
      }
    }
    if (Date.now() >= until) return { ok: false, holder: held.holder };
    await new Promise((done) => setTimeout(done, LOCK_POLL_MS));
  }
}

export { readState, writeState, setAsideBroken, withLock, isReleaseTag, EMPTY as EMPTY_STATE, STATE_FILE };
export type { FfmpegBuild, FfmpegState, ReadState };
