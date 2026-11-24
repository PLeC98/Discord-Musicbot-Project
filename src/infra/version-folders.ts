// 받아 두는 외부 프로그램의 버전 폴더 정리(vendor/ffmpeg, vendor/bgutil). 기록(state.json)의 active, previous가 가리키는 폴더를 남긴다.
// 봇이 기동 시(경로를 정하기 전) 부르고, 업데이트 탭의 외부 프로그램 이전 버전 카드가 이전 버전까지 삭제하도록 부른다. 설치 스크립트는 정리를 하지 않는다(켜진 봇이 쓰는 폴더일 수 있다).
// 삭제하는 것: 기록이 가리키지 않는 버전 폴더, 만든 프로세스가 끝난 다운로드 임시 폴더(.staging-<pid>-<시각>), 삭제하다 남은 휴지통(.trash-*).
// 봇이 지금 쓰는 실행 파일이 든 폴더와 PATH의 폴더가 든 폴더는 기록과 상관없이 남긴다. 봇은 기동 시 정한 것을 꺼질 때까지 쓰는데, 터미널의 설치 명령이 그사이 기록을 바꿀 수 있다.
// 그 밖(state.json, 옮겨 둔 깨진 기록, 모르는 이름)은 건드리지 않는다. 기록을 읽지 못하면 아무것도 삭제하지 않는다.
// 잠금 안에서는 휴지통 이름으로 바꾸고 기록을 쓰기만 하고, 삭제는 잠금 밖에서 비동기로 한다(카드의 삭제는 재생 중에도 실행된다)

import fs from "node:fs";
import path from "node:path";
import { withLock } from "./folder-lock.ts";
import { pathHolder, treeSize } from "./folder-guard.ts";
import type { LogText } from "./log/log-text.ts";

const STAGING = /^\.staging-(\d+)-\d+$/;
const TRASH = /^\.trash-/;
/** 휴지통 이름으로 바꾸기의 재시도 횟수와 간격. 백신이 새로 본 실행 파일을 잠깐 쥘 수 있다 */
const RENAME_TRIES = 5;
const RENAME_GAP_MS = 300;
const BUSY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/** 기록이 가리키는 빌드 하나(폴더 이름만 본다) */
type Build = { folder: string };
/** 기록: 지금 빌드와 이전 빌드 */
type Versioned = { active: Build | null; previous: Build | null };
type StateRead<S> = { kind: "ok"; state: S } | { kind: "none" } | { kind: "broken"; error: string | LogText };
/** 도구마다 다른 것: 기록 읽기와 쓰기, 버전 폴더 이름의 모양, 폴더 이름에서 버전(릴리스, 태그)을 떼는 법 */
type VersionStore<S extends Versioned> = { read(dir: string): StateRead<S>; write(dir: string, state: S): void; versionFolder: RegExp; release(name: string): string };

/** 살아 있는 프로세스면 true. ESRCH만 없는 것으로 본다(권한이 없어 확인하지 못하면 살아 있는 것으로 본다) */
function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * inUse: 봇이 지금 쓰는 실행 파일 경로(그 폴더를 남긴다. 기동 정리는 아직 정하지 않아 넘기지 않는다). dropPrevious: 이전 빌드도 삭제한다.
 * go: 잠금을 잡은 뒤 바꾸기 전에 부른다(예외를 던지면 아무것도 바꾸지 않는다). alive, pathEnv, rename: 테스트용(프로세스 확인, PATH, 이름 바꾸기)
 */
type CleanupOptions = { inUse?: string | null; dropPrevious?: boolean; go?: () => void; alive?: (pid: number) => boolean; pathEnv?: string; rename?: (from: string, to: string) => Promise<void> };
/** 남긴 사유. in-use: 봇이 쓰는 중이거나 PATH의 폴더가 들어 있다, only-build: 지금 빌드가 없어 이전 빌드가 하나뿐이다, rename-failed: 휴지통 이름으로 바꾸지 못했다(안의 파일이 열려 있다) */
type KeptReason = "in-use" | "only-build" | "rename-failed";
/** 삭제할(삭제한) 폴더. release: 버전 폴더면 그 버전(임시 폴더, 휴지통은 null) */
type Doomed = { name: string; release: string | null };
type Kept = { name: string; reason: KeptReason };
/** 미리 보기. bytes: 삭제할 폴더의 크기 합 */
type CleanupPreview = { kind: "ok"; doomed: Doomed[]; kept: Kept[]; bytes: number } | { kind: "broken" };
/** 결과. removed: 삭제한 폴더와 크기, failed: 휴지통으로는 옮겼지만 삭제하지 못한 폴더(다음 정리가 삭제한다), dropped: 기록에서 뺀 이전 빌드 */
type CleanupResult<B extends Build = Build> = { kind: "ok"; removed: (Doomed & { bytes: number })[]; kept: Kept[]; failed: string[]; dropped: B | null } | { kind: "broken" } | { kind: "busy"; holder: number | null };

/** 이전 빌드를 삭제할 수 있는지. 삭제할 수 없으면 그 사유 */
function previousVerdict(state: Versioned | null, inUse: (folder: string) => boolean): "drop" | KeptReason | null {
  const previous = state?.previous?.folder;
  if (!previous) return null;
  if (!state?.active) return "only-build";
  return inUse(previous) ? "in-use" : "drop";
}

/** 정리가 삭제할 이름인가: 남길 것이 아닌 버전 폴더, 만든 프로세스가 끝난 임시 폴더, 휴지통 */
function isStale(name: string, versionFolder: RegExp, keep: Set<string>, alive: (pid: number) => boolean): boolean {
  if (TRASH.test(name)) return true;
  if (versionFolder.test(name)) return !keep.has(name);
  const staging = STAGING.exec(name);
  return staging !== null && !alive(Number(staging[1]));
}

/** 남길 버전 폴더와, 이전 빌드를 남기는 사유(삭제하거나 삭제를 요청하지 않았으면 없다) */
function keepOf(state: Versioned | null, verdict: ReturnType<typeof previousVerdict>): { keep: Set<string>; kept: Kept[] } {
  const { active = null, previous = null } = state ?? {};
  const kept: Kept[] = verdict && verdict !== "drop" && previous ? [{ name: previous.folder, reason: verdict }] : [];
  const keep = new Set([active, verdict === "drop" ? null : previous].flatMap((b) => (b ? [b.folder] : [])));
  return { keep, kept };
}

/** 무엇을 삭제하고 무엇을 남길지 정한다. 기록과 폴더 목록만 보고 바꾸지 않는다 */
function decide<S extends Versioned>(dir: string, store: VersionStore<S>, state: S | null, options: CleanupOptions): { doomed: Doomed[]; kept: Kept[]; dropPrevious: boolean } {
  const holder = pathHolder(options.inUse ?? null, options.pathEnv);
  const held = (name: string) => holder(path.join(dir, name));
  const alive = options.alive ?? isAlive;
  const verdict = options.dropPrevious ? previousVerdict(state, held) : null;
  const { keep, kept } = keepOf(state, verdict);
  const doomed: Doomed[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // 링크(심볼릭 링크, 정션)는 따라가지도 삭제하지도 않는다
    if (!entry.isDirectory() || !isStale(entry.name, store.versionFolder, keep, alive)) continue;
    const release = store.versionFolder.test(entry.name) ? store.release(entry.name) : null;
    if (TRASH.test(entry.name) || !held(entry.name)) doomed.push({ name: entry.name, release });
    else kept.push({ name: entry.name, reason: "in-use" });
  }
  return { doomed, kept, dropPrevious: verdict === "drop" };
}

/** 지금 상태로 무엇을 삭제할지 본다(삭제하지 않는다). 탭을 열 때 크기를 보이는 데 쓴다 */
async function previewVersionsCleanup<S extends Versioned>(dir: string, store: VersionStore<S>, options: CleanupOptions = {}): Promise<CleanupPreview> {
  if (!fs.existsSync(dir)) return { kind: "ok", doomed: [], kept: [], bytes: 0 };
  const read = store.read(dir);
  if (read.kind === "broken") return { kind: "broken" };
  const { doomed, kept } = decide(dir, store, read.kind === "ok" ? read.state : null, options);
  let bytes = 0;
  for (const d of doomed) bytes += await treeSize(path.join(dir, d.name));
  return { kind: "ok", doomed, kept, bytes };
}

type Rename = (from: string, to: string) => Promise<void>;
type Moved = { doomed: Doomed; trash: string };

/** 이름을 바꾼다. 백신 등이 잠깐 쥔 것(바쁨 코드)은 몇 번 재시도한다. 바꿨으면 true */
async function renameRetry(from: string, to: string, rename: Rename = (a, b) => fs.promises.rename(a, b)): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return true;
    } catch (error) {
      if (!BUSY_CODES.has(String((error as NodeJS.ErrnoException).code)) || attempt >= RENAME_TRIES) return false;
      await new Promise((done) => setTimeout(done, RENAME_GAP_MS));
    }
  }
}

/** 삭제할 폴더를 휴지통 이름으로 바꾼다(휴지통은 그대로). 바꾸지 못한 것은 남긴 것으로 */
async function moveToTrash(dir: string, doomed: Doomed[], rename: Rename): Promise<{ moved: Moved[]; failed: Kept[] }> {
  const moved: Moved[] = [];
  const failed: Kept[] = [];
  for (const one of doomed) {
    const from = path.join(dir, one.name);
    const trash = TRASH.test(one.name) ? from : path.join(dir, `.trash-${one.name}-${process.pid}-${Date.now()}`);
    if (trash === from || (await renameRetry(from, trash, rename))) moved.push({ doomed: one, trash });
    else failed.push({ name: one.name, reason: "rename-failed" });
  }
  return { moved, failed };
}

/** 기록에서 이전 빌드를 뺀다. 쓰기가 실패하면 옮긴 그 폴더를 제자리로 되돌리고 예외를 던진다(기록이 존재하지 않는 폴더를 가리키지 않게) */
async function dropFromState<S extends Versioned>(dir: string, store: VersionStore<S>, state: S, moved: Moved[], rename: Rename) {
  try {
    store.write(dir, { ...state, previous: null });
  } catch (error) {
    const folder = state.previous?.folder;
    const back = moved.find((m) => m.doomed.name === folder);
    if (back && folder) await rename(back.trash, path.join(dir, folder)).catch(() => undefined);
    throw error;
  }
}

/** 잠금 안의 일: 새로 읽은 기록으로 다시 정하고, 휴지통 이름으로 바꾸고, 기록을 쓴다. 기록을 읽지 못하면 null */
async function cleanupLocked<S extends Versioned>(dir: string, store: VersionStore<S>, options: CleanupOptions, rename: Rename): Promise<{ moved: Moved[]; kept: Kept[]; dropped: S["previous"] } | null> {
  const read = store.read(dir);
  if (read.kind === "broken") return null;
  const state = read.kind === "ok" ? read.state : null;
  const plan = decide(dir, store, state, options);
  options.go?.();
  const { moved, failed } = await moveToTrash(dir, plan.doomed, rename);
  const kept = [...plan.kept, ...failed];
  const previous = state?.previous ?? null;
  const dropped = plan.dropPrevious && previous && !failed.some((k) => k.name === previous.folder) ? previous : null;
  if (dropped && state) await dropFromState(dir, store, state, moved, rename);
  return { moved, kept, dropped };
}

/** 정리한다. 다른 프로세스가 폴더를 쥐고 있으면(다운로드 중) 5초 기다리고 busy를 반환한다 */
async function cleanupVersions<S extends Versioned>(dir: string, store: VersionStore<S>, options: CleanupOptions = {}): Promise<CleanupResult<NonNullable<S["previous"]>>> {
  if (!fs.existsSync(dir)) return { kind: "ok", removed: [], kept: [], failed: [], dropped: null };
  const rename: Rename = options.rename ?? ((from, to) => fs.promises.rename(from, to));
  const held = await withLock(dir, () => cleanupLocked(dir, store, options, rename), 5000);
  if (!held.ok) return { kind: "busy", holder: held.holder };
  if (!held.value) return { kind: "broken" };
  const removed: (Doomed & { bytes: number })[] = [];
  const failed: string[] = [];
  for (const { doomed, trash } of held.value.moved) {
    const bytes = await treeSize(trash);
    try {
      await fs.promises.rm(trash, { recursive: true, force: true, maxRetries: 2 });
      removed.push({ ...doomed, bytes });
    } catch {
      failed.push(doomed.name);
    }
  }
  return { kind: "ok", removed, kept: held.value.kept, failed, dropped: held.value.dropped as NonNullable<S["previous"]> | null };
}

export { cleanupVersions, previewVersionsCleanup, renameRetry };
export type { VersionStore, Versioned, StateRead, CleanupOptions, CleanupPreview, CleanupResult, KeptReason };
