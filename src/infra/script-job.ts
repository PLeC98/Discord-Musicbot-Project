// 봇이 설치 스크립트를 자식 프로세스로 실행하는 작업(외부 도구 다운로드). 한 번에 하나만 돈다.
// 스크립트는 셸 없이 봇과 같은 Node 실행 파일로 실행하고 stdin을 닫는다. POSIX는 detached로 실행해 프로세스 그룹째 종료한다.
// 무엇을 실행하는지(ffmpeg, bgutil)는 모른다. 스크립트, 인자, 시간 상한, 성공 판정은 호출부가 넘긴다.
// 봇이 정상 종료될 때는 자식 프로세스 정리 전에 stopJob을 호출해, 실행 중인 작업을 취소할 때와 같은 절차(SIGTERM부터)로 중단한다.
// POSIX에서 SIGKILL만 보내면 스크립트가 별도 프로세스 그룹으로 띄운 도구(npm, tsc)가 남는다. 종료가 시작된 뒤에는 새 작업을 받지 않는다

import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import * as registry from "./process-registry.ts";
import { isShuttingDown } from "./shutdown-state.ts";
import { messageOf } from "./error-text.ts";
import type { Job } from "./process-job.ts";

const IS_WIN = process.platform === "win32";
/** 메모리에 두는 출력의 상한: 마지막 줄 수, 전체 바이트, 한 줄의 글자 수 */
const KEEP_LINES = 200;
const KEEP_BYTES = 64 * 1024;
const LINE_CHARS = 4096;
/** 취소하거나 시간 상한에 걸렸을 때 자식 프로세스가 끝나기를 기다리는 상한(ms). POSIX는 이 시간의 절반 동안 SIGTERM을 받은 스크립트가 스스로 끝나기를 기다린 뒤 SIGKILL을 보낸다 */
const STOP_WAIT_MS = 5000;
/** 스크립트가 끝난 뒤 출력 파이프가 닫히기를 기다리는 상한(ms). 손자 프로세스가 파이프를 물고 남아 있어도 이 시간이 지나면 작업을 끝낸다 */
const DRAIN_MS = 3000;

/** running: 실행 중. 끝난 작업의 사유(reason): cancelled(취소), timeout(시간 상한), exit(종료 코드가 0이 아님), unmet(종료 코드가 0이지만 성공 판정을 통과하지 못함), spawn(실행하지 못함) */
type ScriptJobState = "running" | "succeeded" | "failed";
type FailReason = "cancelled" | "timeout" | "exit" | "unmet" | "spawn";
/** 작업 하나의 상태. output: 출력의 마지막 줄 목록(ANSI 색 코드를 뺀 것) */
type ScriptJobInfo = { id: number; name: Job; state: ScriptJobState; reason: FailReason | null; exitCode: number | null; startedAt: number; endedAt: number | null; output: string[] };
/**
 * name: 작업 이름(자식 프로세스 목록에 보인다). script: 실행할 스크립트 경로. env: 넘길 환경 변수(비밀값을 뺀 것).
 * timeoutMs: 작업 전체의 시간 상한(스크립트 안 각 명령의 상한을 합친 것보다 길게). succeeded: 종료 코드가 0일 때 실제로 성공했는지 보는 판정(state.json의 가리킴이 목표를 가리키는지)
 */
type ScriptJobSpec = { name: Job; script: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; succeeded: () => boolean; onEnd?: (info: ScriptJobInfo) => void };
type StartResult = { ok: true; id: number } | { ok: false; reason: "busy" | "stopping"; running: ScriptJobInfo | null };
type CancelResult = "cancelled" | "not-running";

/** 출력 스트림(stdout, stderr) 하나를 줄 단위로 나눈다. UTF-8 글자가 청크 경계에 걸려도 깨지지 않게 디코더를 스트림마다 둔다 */
class LineSplitter {
  #decoder = new StringDecoder("utf8");
  #partial = "";
  #emit: (line: string) => void;
  constructor(emit: (line: string) => void) {
    this.#emit = emit;
  }
  write(chunk: Buffer) {
    this.#take(this.#decoder.write(chunk));
  }
  end() {
    this.#take(this.#decoder.end());
    if (this.#partial) this.#emit(this.#partial);
    this.#partial = "";
  }
  // \r만 있는 줄바꿈(진행 표시를 덮어쓰는 출력)도 줄로 본다. 줄바꿈 없이 이어지는 출력은 메모리가 끝없이 늘지 않게 한 줄 상한마다 끊어 내보낸다
  #take(text: string) {
    const parts = (this.#partial + text).split(/\r\n|\r|\n/);
    let partial = parts.pop() ?? "";
    for (const line of parts) this.#emit(line);
    while (partial.length > LINE_CHARS) {
      this.#emit(partial.slice(0, LINE_CHARS));
      partial = partial.slice(LINE_CHARS);
    }
    this.#partial = partial;
  }
}

// 터미널 색, 커서 이동 코드
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

class OutputTail {
  readonly lines: string[] = [];
  #bytes = 0;
  push(raw: string) {
    let line = raw.replace(ANSI, "");
    if (line.length > LINE_CHARS) line = `${line.slice(0, LINE_CHARS)}…`;
    this.lines.push(line);
    this.#bytes += Buffer.byteLength(line);
    while (this.lines.length > KEEP_LINES || (this.#bytes > KEEP_BYTES && this.lines.length > 1)) this.#bytes -= Buffer.byteLength(this.lines.shift() ?? "");
  }
}

let nextId = 1;
let current: { info: ScriptJobInfo; child: ChildProcess | null; tail: OutputTail; stop: (reason: "cancelled" | "timeout") => Promise<void>; ended: Promise<void> } | null = null;

const snapshot = (info: ScriptJobInfo, tail: OutputTail): ScriptJobInfo => ({ ...info, output: [...tail.lines] });

/** 도는 작업, 없으면 마지막에 끝난 작업(봇이 뜬 뒤 하나도 없었으면 null) */
function jobNow(): ScriptJobInfo | null {
  return current ? snapshot(current.info, current.tail) : null;
}

/** 실행 중인 작업이 있으면 true */
function jobRunning(): boolean {
  return current?.info.state === "running";
}

/** 작업을 시작한다. 도는 작업이 있거나 봇이 종료 중이면 시작하지 않는다 */
function startJob(spec: ScriptJobSpec): StartResult {
  if (isShuttingDown()) return { ok: false, reason: "stopping", running: null };
  if (current?.info.state === "running") return { ok: false, reason: "busy", running: jobNow() };

  const info: ScriptJobInfo = { id: nextId++, name: spec.name, state: "running", reason: null, exitCode: null, startedAt: Date.now(), endedAt: null, output: [] };
  const tail = new OutputTail();
  let stopping: "cancelled" | "timeout" | null = null;
  let finish!: () => void;
  const ended = new Promise<void>((done) => (finish = done));
  const end = (state: ScriptJobState, reason: FailReason | null, exitCode: number | null) => {
    if (info.state !== "running") return;
    Object.assign(info, { state, reason, exitCode, endedAt: Date.now() });
    clearTimeout(timer);
    finish();
    spec.onEnd?.(snapshot(info, tail));
  };

  let child: ChildProcess | null = null;
  try {
    child = spawn(process.execPath, [spec.script, ...spec.args], { cwd: spec.cwd, env: spec.env, stdio: ["ignore", "pipe", "pipe"], detached: !IS_WIN, windowsHide: true });
  } catch (error) {
    tail.push(messageOf(error));
  }
  const stop = async (reason: "cancelled" | "timeout") => {
    stopping ??= reason;
    if (!child || info.state !== "running") return;
    // POSIX: SIGTERM을 받은 스크립트는 띄운 도구를 정리하고 끝난다. 기다리는 동안 끝나지 않으면 프로세스 그룹째 SIGKILL.
    // 이미 끝난 스크립트에는 보내지 않는다(PID가 재사용됐을 수 있다)
    if (!IS_WIN && child.pid && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // 이미 끝났다
      }
      await Promise.race([ended, new Promise((done) => setTimeout(done, STOP_WAIT_MS / 2))]);
    }
    if (info.state === "running") registry.kill(child);
    await Promise.race([ended, new Promise((done) => setTimeout(done, STOP_WAIT_MS))]);
  };
  const timer = setTimeout(() => void stop("timeout"), spec.timeoutMs);
  current = { info, child, tail, stop, ended };

  if (!child) {
    end("failed", "spawn", null);
    return { ok: true, id: info.id };
  }
  const release = registry.register(child, spec.name, { group: !IS_WIN, job: spec.name, lowPriority: true });
  const out = new LineSplitter((line) => tail.push(line));
  const err = new LineSplitter((line) => tail.push(line));
  child.stdout?.on("data", (chunk: Buffer) => out.write(chunk));
  child.stderr?.on("data", (chunk: Buffer) => err.write(chunk));
  child.once("error", (error) => {
    tail.push(messageOf(error));
    release();
    end("failed", "spawn", null);
  });
  // close는 출력 파이프가 모두 닫혀야 온다. 손자 프로세스가 파이프를 물고 남으면 오지 않으므로 스크립트가 끝난 뒤 상한이 지나면 이쪽에서 닫는다
  child.once("exit", () => {
    const drain = setTimeout(() => {
      child?.stdout?.destroy();
      child?.stderr?.destroy();
    }, DRAIN_MS);
    void ended.then(() => clearTimeout(drain));
  });
  // close: 두 출력이 다 닫힌 뒤라 마지막 줄까지 모였다
  child.once("close", (code) => {
    out.end();
    err.end();
    release();
    if (stopping) return end("failed", stopping, code);
    if (code !== 0) return end("failed", "exit", code);
    let ok = false;
    try {
      ok = spec.succeeded();
    } catch (error) {
      tail.push(messageOf(error));
    }
    end(ok ? "succeeded" : "failed", ok ? null : "unmet", code);
  });
  return { ok: true, id: info.id };
}

/** id의 작업이 실행 중이면 프로세스 트리째 종료하고, 끝난 것을 확인하거나 상한(5초)이 지나면 반환한다. id가 다르면(그사이 다음 작업이 시작됐다) 건드리지 않는다 */
async function cancelJob(id: number): Promise<CancelResult> {
  if (!current || current.info.id !== id || current.info.state !== "running") return "not-running";
  await current.stop("cancelled");
  return "cancelled";
}

/** 봇 종료 처리: 실행 중인 작업이 있으면 취소할 때처럼 중단하고 그 이름을 반환한다. 없으면 null */
async function stopJob(): Promise<Job | null> {
  if (!current || current.info.state !== "running") return null;
  await current.stop("cancelled");
  return current.info.name;
}

/** 테스트: 처음 상태로 되돌린다 */
function _resetJobs() {
  current = null;
}

export { startJob, cancelJob, stopJob, jobNow, jobRunning, _resetJobs, KEEP_LINES, LINE_CHARS };
export type { ScriptJobInfo, ScriptJobSpec, StartResult, CancelResult, FailReason };
