// 큰 파일 업로드(운영자 패널의 백업 불러오기, 로그인 배경): 시작 요청에서 크기를 받아 남은 공간을 예약하고, 본문은 청크로 받아 그 위치에 쓴다.
// 요청 하나로 받으면 공간 부족으로 거절한 이유가 브라우저에 닿지 않고(받는 중에 닫으면 연결 리셋) 5분 요청 제한에 끊긴다.
// 상태는 메모리에만 둔다. 봇을 다시 시작하면 처음부터 다시 올려야 하고, 남은 임시 파일은 용도마다 기동 때 치운다(target이 만든 위치)

import crypto from "node:crypto";
import fs from "node:fs";
import { UPLOAD_PURPOSES, type UploadPurpose } from "./contract/uploads.ts";

/** 청크 하나의 상한(바이트). 화면은 이 크기로 나눠 보낸다 */
const CHUNK_SIZE = 8 * 1024 * 1024;
/** 봇 전체에서 동시에 열어 둘 수 있는 업로드 수 */
const MAX_ACTIVE = 8;
/** 마지막 청크 뒤 이만큼 아무 요청이 없으면 지운다 */
const IDLE_MS = 15 * 60_000;
const SWEEP_MS = 60_000;

const ID = /^[0-9a-f]{32}$/;
type Purpose = UploadPurpose;

/** 용도가 정하는 것: 임시 파일, 그 위치의 남은 공간(남겨 둘 여유 공간을 뺀 값), 지우기(임시 파일, 잡아 둔 폴더), 용도가 붙이는 값 */
type Target = { file: string; room: () => number; discard: () => void; ref: string };

/**
 * open: 다음 청크를 받는다. busy: 청크 하나를 받는 중(위치 검사부터 받은 위치를 올릴 때까지). taking: 기능 쪽이 가져가는 중. closed: 지웠다(쥔 쪽이 놓으면 파일을 지운다)
 * pending: 지금 청크에서 이미 파일에 쓴 바이트(다른 업로드의 공간 계산에서 두 번 세지 않게)
 */
type Upload = { id: string; sid: string; purpose: Purpose; size: number; received: number; pending: number; target: Target; state: "open" | "busy" | "taking" | "closed"; held: boolean; at: number };

const uploads = new Map<string, Upload>();
let sweeper: NodeJS.Timeout | null = null;

/** 아직 쓰지 않은 예약 공간. except는 빼고 센다 */
const ahead = (except?: Upload) => [...uploads.values()].reduce((sum, one) => (one === except || one.state === "closed" ? sum : sum + Math.max(0, one.size - one.received - one.pending)), 0);

type Started = { ok: true; upload: Upload } | { ok: false; why: "busy" } | { ok: false; why: "no-space"; room: number };

/** 업로드를 연다. 남은 공간에서 다른 업로드의 예약 공간을 빼고도 size가 들어가야 한다. targetOf는 업로드 id로 저장 위치를 잡는다(열지 못하면 지운다) */
function start({ sid, purpose, size, targetOf }: { sid: string; purpose: Purpose; size: number; targetOf: (id: string) => Target }): Started {
  const id = crypto.randomBytes(16).toString("hex");
  const target = targetOf(id);
  const live = [...uploads.values()].filter((one) => one.state !== "closed").length;
  const room = target.room();
  const left = room - ahead();
  if (live >= MAX_ACTIVE || size > left) {
    target.discard();
    // 다른 업로드의 예약 때문에 모자라면 busy(끝나면 다시 올릴 수 있다)
    if (live >= MAX_ACTIVE || size <= room) return { ok: false, why: "busy" };
    return { ok: false, why: "no-space", room: Math.max(0, left) };
  }
  try {
    fs.closeSync(fs.openSync(target.file, "w"));
  } catch (error) {
    target.discard();
    throw error;
  }
  const upload: Upload = { id, sid, purpose, size, received: 0, pending: 0, target, state: "open", held: false, at: Date.now() };
  uploads.set(upload.id, upload);
  sweeper ??= setInterval(sweepIdle, SWEEP_MS).unref();
  return { ok: true, upload };
}

/** 그 세션의 살아 있는 업로드. 없거나 지웠거나 다른 세션이면 null */
function find(id: string, sid: string): Upload | null {
  const one = ID.test(id) ? uploads.get(id) : undefined;
  return one && one.sid === sid && one.state !== "closed" ? one : null;
}

type Begun = { ok: true; upload: Upload } | { ok: false; why: "gone" } | { ok: false; why: "offset"; received: number };

/** 청크 하나를 받기 시작한다: offset이 받은 위치와 같고 다른 청크를 받는 중이 아니어야 한다. 조건이 맞으면 busy로 잡는다(release로 놓는다) */
function begin(id: string, sid: string, offset: number): Begun {
  const one = find(id, sid);
  if (!one) return { ok: false, why: "gone" };
  if (one.state !== "open" || offset !== one.received) return { ok: false, why: "offset", received: one.received };
  one.state = "busy";
  one.held = true;
  one.at = Date.now();
  return { ok: true, upload: one };
}

type Written = { ok: true; received: number } | { ok: false; why: "no-space"; room: number } | { ok: false; why: "gone" };

/**
 * busy로 잡은 업로드에 청크를 받은 위치부터 쓴다. 쓰기 전에 남은 공간을 다시 확인한다(다른 쓰기가 그사이 공간을 썼더라도 남겨 둘 여유 공간을 침범하지 않게).
 * 실패하면 파일을 받은 위치까지 잘라 되돌린다(자르지 못하면 업로드를 지운다). ENOSPC는 공간 부족으로 처리하고, 그 밖의 오류는 던진다
 */
async function write(one: Upload, chunk: Buffer): Promise<Written> {
  if (one.state === "closed") return { ok: false, why: "gone" };
  const left = one.target.room() - ahead(one);
  if (left < one.size - one.received) return { ok: false, why: "no-space", room: Math.max(0, left) };
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(one.target.file, "r+");
    while (one.pending < chunk.length) {
      const { bytesWritten } = await handle.write(chunk, one.pending, chunk.length - one.pending, one.received + one.pending);
      if (!bytesWritten) throw new Error("파일에 쓰지 못함(0바이트)");
      one.pending += bytesWritten;
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    handle = null;
    one.pending = 0;
    try {
      await fs.promises.truncate(one.target.file, one.received);
    } catch {
      close(one);
    }
    if ((error as NodeJS.ErrnoException).code === "ENOSPC") return { ok: false, why: "no-space", room: Math.max(0, one.target.room() - ahead(one)) };
    throw error;
  } finally {
    await handle?.close();
  }
  one.received += chunk.length;
  one.pending = 0;
  one.at = Date.now();
  return { ok: true, received: one.received };
}

/** busy, taking으로 잡은 상태를 해제한다. 그사이 지웠으면(취소, 만료, 세션 종료) 이제 파일을 지운다 */
function release(one: Upload) {
  one.held = false;
  one.pending = 0;
  if (one.state === "closed") return discard(one);
  one.state = "open";
  one.at = Date.now();
}

type Taken = { ok: true; upload: Upload } | { ok: false; why: "gone" | "incomplete" };

/** 기능 경로가 다 받은 파일을 가져가려고 잡는다(두 번째는 gone). 등록을 마치면 finish, 실패하면 close와 release */
function take(id: string, sid: string, purpose: Purpose): Taken {
  const one = find(id, sid);
  if (!one || one.purpose !== purpose || one.state !== "open") return { ok: false, why: "gone" };
  if (one.received !== one.size) return { ok: false, why: "incomplete" };
  one.state = "taking";
  one.held = true;
  return { ok: true, upload: one };
}

/** 가져갔다: 파일은 기능 쪽 것이 되었으니 지우지 않고 목록에서만 뺀다 */
function finish(one: Upload) {
  uploads.delete(one.id);
}

/** 지운다. 쥔 쪽이 있으면 놓을 때 파일을 지운다 */
function close(one: Upload) {
  if (one.state === "closed" && !uploads.has(one.id)) return;
  one.state = "closed";
  if (!one.held) discard(one);
}

function discard(one: Upload) {
  uploads.delete(one.id);
  one.target.discard();
}

/** 화면이 그만두었다. 모르는 업로드는 무시한다 */
function cancel(id: string, sid: string) {
  const one = find(id, sid);
  if (one) close(one);
}

/** 대시보드 세션이 끝났다(로그아웃, 기기 로그아웃, 기한): 그 세션의 업로드를 지운다 */
function dropSession(sid: string) {
  for (const one of [...uploads.values()]) if (one.sid === sid) close(one);
}

function sweepIdle(now = Date.now()) {
  for (const one of [...uploads.values()]) if (!one.held && one.state !== "closed" && now - one.at > IDLE_MS) close(one);
}

/** 테스트: 모두 지우고 정리 타이머를 멈춘다 */
function _reset() {
  for (const one of [...uploads.values()]) discard(one);
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}

export { start, find, begin, write, release, take, finish, close, cancel, dropSession, sweepIdle, _reset, CHUNK_SIZE, MAX_ACTIVE, IDLE_MS, UPLOAD_PURPOSES };
export type { Purpose, Target, Upload };
