// yt-dlp를 띄우는 가장 아래 층. 플래그(camelCase 객체)를 명령줄 인자로 바꾸고, 띄워서 stdout, stderr를 모은다.
// 부르는 곳은 ytdlp-spawn 하나다(레지스트리, 우선순위, 줄).
// 띄운 실행 파일의 폴더에 사용권을 잡고 그 프로세스가 끝날 때(exit) 놓는다. 버전 정리(ytdlp-binary)는 사용권이 있는 폴더를 지우지 않는다(onedir 판은 돌면서 _internal의 파일을 읽는다).

import path from "node:path";
import { EventEmitter } from "node:events";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { L } from "../infra/log/text.ts";
import { logTextError } from "../infra/log/log-text.ts";

/** yt-dlp 플래그(camelCase). 이 봇이 쓰는 것만 적는다. 출력 템플릿은 하나만 쓴다(다운로드 파일 그룹 감시가 하나를 전제한다) */
type YtDlpFlags = {
  version?: boolean;
  output?: string;
  paths?: string;
  format?: string;
  formatSort?: string | string[];
  extractAudio?: boolean;
  audioFormat?: string;
  postprocessorArgs?: string;
  dumpSingleJson?: boolean;
  flatPlaylist?: boolean;
  noPlaylist?: boolean;
  playlistItems?: string;
  matchFilter?: string;
  maxFilesize?: string | number;
  ignoreNoFormatsError?: boolean;
  writeInfoJson?: boolean;
  loadInfoJson?: string;
  retries?: number;
  fragmentRetries?: number;
  concurrentFragments?: number;
  ffmpegLocation?: string;
  cookies?: string;
  cookiesFromBrowser?: string;
  extractorArgs?: string | string[];
  pluginDirs?: string;
  noPluginDirs?: boolean;
  ignoreConfig?: boolean;
  jsRuntimes?: string;
};

/** 실행 결과: Promise 이면서 띄운 자식 프로세스의 필드(띄운 때의 값)와 이벤트, kill을 가진 것 */
type Running = Promise<{ stdout: string; stderr: string }> & Pick<ChildProcess, "pid" | "spawnfile" | "exitCode" | "signalCode" | "kill">;
/** 실행 파일 하나로 yt-dlp를 띄우는 함수 */
type Exec = (url: string, flags?: YtDlpFlags, options?: SpawnOptions) => Running;

// 넘기면 Windows onedir 판의 실행 파일이 onefile로 덮인다(yt-dlp가 자기를 onefile로 알아본다). 버전은 ytdlp-binary가 바꾼다
const SELF_UPDATE = new Set(["update", "updateTo", "U"]);

/** 인자 이름: 접두사는 바꾸기 전 키 길이로(한 글자면 -), 대문자 앞에 - 를 넣고 소문자로 */
const optionOf = (key: string) => (key.length === 1 ? "-" : "--") + key.replace(/[A-Z]/g, "-$&").toLowerCase();

/**
 * 플래그를 인자로. 이름과 값은 따로 넘기고(이름=값 이 아니다), 빈 것은 뺀다.
 * true는 이름만, false는 --no-이름, 문자열, 수(NaN 빼고)는 이름과 값(빈 문자열이면 이름만), 배열은 원소마다 이름과 값(truthy인 원소만, 바꾸지 않고). 그 밖(undefined, null, 객체)은 버린다
 */
function argsOf(flags: YtDlpFlags): string[] {
  const out: unknown[] = [];
  for (const [key, value] of Object.entries(flags) as [string, unknown][]) {
    if (key === "_" || key === "--") throw logTextError(L.ytdlp.flagKeyRejected({ key }));
    if (SELF_UPDATE.has(key)) throw logTextError(L.ytdlp.selfUpdateFlagRejected({ key }));
    const push = (name: string, argument: unknown) => {
      out.push(optionOf(name));
      if (argument) out.push(argument);
    };
    if (value === true) push(key, "");
    if (value === false) push(`no-${key}`, "");
    if (typeof value === "string") push(key, value);
    if (typeof value === "number" && !Number.isNaN(value)) push(key, String(value));
    if (Array.isArray(value)) for (const item of value) push(key, item);
  }
  return out.filter(Boolean) as string[];
}

/** 실행 결과가 JSON 인가({ 로 시작하면) */
const isJSON = (text = "") => text.startsWith("{");

// ── 버전 폴더 사용권 ──

const IS_WIN = process.platform === "win32";
/** 폴더(정규화한 경로) → 잡은 수 */
const leases = new Map<string, number>();
const keyOf = (dir: string) => (IS_WIN ? path.resolve(dir).toLowerCase() : path.resolve(dir));

/** 실행 파일의 폴더에 사용권을 잡는다. 돌려주는 함수로 놓는다(두 번 불러도 한 번만 놓는다) */
function leaseFor(file: string): () => void {
  const dir = keyOf(path.dirname(file));
  leases.set(dir, (leases.get(dir) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (leases.get(dir) ?? 1) - 1;
    if (left > 0) leases.set(dir, left);
    else leases.delete(dir);
  };
}

/** dir이나 그 아래 폴더에 사용권이 있나 */
function inUse(dir: string): boolean {
  const root = keyOf(dir);
  for (const held of leases.keys()) if (held === root || held.startsWith(root + path.sep)) return true;
  return false;
}

// ── 실행 ──

// Promise에 묶는 자식 프로세스의 메서드(이벤트, kill)
const BOUND = Object.getOwnPropertyNames(EventEmitter.prototype)
  .filter((name) => !name.startsWith("_"))
  .concat(["kill", "ref", "unref"]);

/** 모은 출력을 UTF-8로 풀고 앞뒤 공백을 자른다 */
const textOf = (chunks: Buffer[]) => Buffer.concat(chunks).toString("utf8").trim();

/** 띄우고 끝을 기다린다. 종료 코드가 0이 아니면(신호로 끝난 것 포함) stdout, stderr, exitCode, signalCode를 실은 Error, 띄우기 실패는 그 오류 그대로 거절한다 */
function launch(file: string, args: string[], options: SpawnOptions): Running {
  const release = leaseFor(file);
  let child!: ChildProcess;
  const done = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    try {
      child = spawn(file, args, options);
    } catch (error) {
      release();
      throw error;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    // 사용권은 프로세스가 끝날 때 놓는다. 중단(signal)하면 Promise는 AbortError로 먼저 끝나도 프로세스는 아직 끝나는 중이다
    child.once("exit", release);
    child.on("error", (error) => {
      if (child.pid === undefined) release();
      reject(error);
    });
    child.on("close", (exitCode: number | null) => {
      const out = { stdout: textOf(stdout), stderr: textOf(stderr) };
      if (exitCode === 0) return resolve(out);
      const command = `${file} ${args.join(" ")}`;
      reject(Object.assign(logTextError(L.ytdlp.processExited({ exitCode: String(child.exitCode), signal: String(child.signalCode), command })), { command, exitCode: child.exitCode, signalCode: child.signalCode, pid: child.pid, spawnfile: child.spawnfile, ...out }));
    });
  });
  // 띄운 때의 필드를 복사한다. exitCode, signalCode는 늘 null로 남아 레지스트리가 release 전까지 살아 있는 것으로 본다
  // (지금 값을 읽으면 yt-dlp만 먼저 끝나고 stdout을 물려받은 손자가 남았을 때 그룹 종료를 건너뛴다)
  const running = Object.assign(done, child) as unknown as Running & Record<string, unknown>;
  // spawn이 바로 예외를 던졌으면(인자가 틀렸다) 묶을 자식이 없다. done이 그 오류로 거절된다
  if (!child) return running;
  for (const name of BOUND) {
    const method = (child as unknown as Record<string, unknown>)[name];
    if (typeof method === "function") running[name] = (method as (...rest: unknown[]) => unknown).bind(child);
  }
  return running;
}

/** 실행 파일 하나로 띄우는 함수. 인자는 플래그 뒤에 --, url(빈 url은 빠진다) */
const execWith =
  (file: string): Exec =>
  (url, flags = {}, options = {}) =>
    launch(file, [...argsOf(flags), "--", url].filter(Boolean), options);

/**
 * 호스트의 yt-dlp 설정을 섞지 않는 실행기. 모든 실행의 맨 앞에 --ignore-config(실행 파일 옆, 사용자, 시스템의 설정 파일을 읽지 않는다)와
 * --no-plugin-dirs(기본 플러그인 폴더를 비운다)를 둔다. 봇이 넘기는 --plugin-dirs(POToken 플러그인)는 그 뒤라 그대로 찾는다
 */
const isolated =
  (exec: Exec): Exec =>
  (url, flags = {}, options) =>
    exec(url, { ignoreConfig: true, noPluginDirs: true, ...flags }, options);

export { argsOf, execWith, isolated, isJSON, leaseFor, inUse };
export type { YtDlpFlags, Exec, Running };
