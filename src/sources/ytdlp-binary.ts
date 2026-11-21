// yt-dlp 바이너리(onedir 판: 실행 파일과 _internal 폴더). 버전마다 vendor/yt-dlp/<버전>/에 두고, yt-dlp를 실행하는 곳(ytdlp-spawn)은 실행할 때마다 현재 버전의 경로를 가져온다.
//
// 새 버전은 GitHub 릴리스의 zip을 받아 서명, 체크섬을 맞추고(ytdlp-release) 풀어서, --version이 목표와 같을 때만 버전 폴더로 옮겨 교체한다.
// 교체는 가리키는 경로(state.json)만 바꾸므로 이미 돌고 있는 yt-dlp는 옛 버전으로 끝까지 돈다. 처음에는(기록이 없으면) 설정과 상관없이 목표 버전을 설치한다.
// 봇과 update:ytdlp(다른 프로세스)가 겹칠 수 있어 기록 다시 읽기, 버전 폴더로 옮기기, 기록 쓰기, 정리의 이름 바꾸기는 OS가 쥐는 잠금 안에서 한다(자식 프로세스, 네트워크는 잠금 밖).
//
// 목표 버전(설정은 업데이트 탭의 yt-dlp 카드가 고친다): 고정(YTDLP_VERSION)이 있으면 모드와 상관없이 그 버전, 없으면 모드가 auto일 때 채널(YTDLP_CHANNEL)의 최신(GitHub 릴리스, 하루 한 번 본다).
// notify면 하루 한 번 확인만 하고 새 버전이 있으면 로그에 남긴다(카드에 업데이트 버튼이 뜬다).
// manual이고 고정이 없으면 확인도 하지 않는다(운영자가 확인, 업데이트를 누른다). 설치된 것이 없으면 모드와 상관없이 다운로드한다.
// 자동으로 시작한 다운로드(auto)는 그사이 설정이 바뀌었으면 교체하지 않고 버린다. 운영자가 선택한 것(고정, 업데이트, update:ytdlp)은 그대로 교체한다.

import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import config from "../config/index.ts";
import { toolEnv } from "../config/tool-env.ts";
import logger from "../infra/log/logger.ts";
import * as procRegistry from "../infra/process-registry.ts";
import { acquireInstanceLock } from "../infra/instance-lock.ts";
import { latestReleaseTag } from "./github-release.ts";
import { assetHere, fetchRelease, type Asset, type ReleaseError } from "./ytdlp-release.ts";
import { leaseFor, inUse } from "./ytdlp-exec.ts";
import { extractZip } from "../infra/zip.ts";
import { warmExecutable } from "../infra/warm-exe.ts";
import { isYtdlpTag } from "../rules/ytdlp-tag.ts";
import { codedError, codeOf, errorProblem, messageOf } from "../rules/error-kind.ts";
import { plain, rule, type RuleProblem } from "../rules/rule-problem.ts";
import { logRuleLine } from "../rules/text/index.ts";
import { PROJECT } from "../infra/project-paths.ts";
import { isShuttingDown } from "../infra/shutdown-state.ts";
import type { YtdlpCardStatus, YtdlpPeek } from "./ytdlp-status-types.ts";

const log = logger.child({ category: "ytdlp" });

type Channel = (typeof config.ytdlp)["channel"];
type Mode = (typeof config.ytdlp)["update"];

// 채널마다 릴리스를 내는 저장소(yt-dlp의 UPDATE_SOURCES와 같다)
const REPOS: Record<Channel, string> = { stable: "yt-dlp/yt-dlp", nightly: "yt-dlp/yt-dlp-nightly-builds", master: "yt-dlp/yt-dlp-master-builds" };
const DAY_MS = 24 * 60 * 60 * 1000;
// 확인, 설치가 일시적으로 실패하면 이만큼 뒤에 다시 본다(하루를 통째로 기다리지 않는다)
const RETRY_MS = 60 * 60 * 1000;
const VERSION_TIMEOUT_MS = 30_000; // 처음 실행하는 onedir 판은 백신이 140여 개 파일을 검사해 수 초 걸린다
// 풀린 크기 상한. 지금 가장 큰 macOS 판이 129MB, 134개
const UNZIP_LIMITS = { maxEntries: 1000, maxBytes: 512 * 1024 * 1024 };
const LOCK_WAIT_MS = 60_000;
const LOCK_POLL_MS = 200;
// 백신이 막 쓴 파일을 잡고 있으면 Windows의 폴더 이름 바꾸기가 잠깐 실패한다
const RENAME_TRIES = 10;
const RENAME_GAP_MS = 500;
const BUSY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * vendor/yt-dlp/state.json. 현재 버전(설치 전이면 null), 이전 버전, 최신을 마지막으로 확인한 시각과 그때의 채널(채널을 바꾸면 확인한 적 없는 것이다),
 * 다운로드했지만 이 환경에서 실행되지 않은 태그(일일 확인이 다시 다운로드하지 않는다), 현재 버전과 이전 버전을 다운로드한 채널(그 필드가 없던 기록이면 null: 모른다)
 */
type State = { version: string | null; previous: string | null; lastChecked: number; unusable: string | null; channel: Channel | null; previousChannel: Channel | null; checkedChannel: Channel | null };
/** 바이너리를 한 번 부른 결과. 띄우기 실패, 시간 초과, 신호 종료는 이 환경의 상한이 아니라 일시적 실패로 본다 */
type Ran = { kind: "exited"; status: number; stdout: string; stderr: string } | { kind: "spawn-failed"; code: string } | { kind: "timeout" } | { kind: "signal"; signal: string };
/** 잠금을 놓는 함수 */
type Unlock = () => Promise<void>;
/** 버전 폴더를 옮기지 못했다. failed는 실패 줄에 실을 원인 */
type RenameFailed = { failed: RuleProblem };
/** 바깥 경계. 테스트는 가짜를 넘긴다 */
type Io = {
  /** 버전마다 폴더를 둘 곳 */
  dir: string;
  /** 이 환경의 에셋(채널마다. 없으면 이유) */
  asset(channel: Channel): Asset | { missing: RuleProblem };
  /** 한 태그의 에셋을 받아 확인하고 staging/dir에 푼다. 실패는 ReleaseError(kind) */
  fetch(job: { repo: string; tag: string; asset: Asset; staging: string; skipSignature: boolean }): Promise<void>;
  run(file: string, args: string[], timeoutMs: number): Promise<Ran>;
  /** 채널의 최신 릴리스 태그 */
  latestTag(channel: Channel): Promise<string>;
  now(): number;
  /** 이 프로세스. staging, 휴지통 폴더 이름에 쓴다 */
  pid: number;
  isAlive(pid: number): boolean;
  /** 그 폴더나 그 아래에서 이 프로세스가 띄운 yt-dlp가 도는 중인가 */
  inUse(dir: string): boolean;
  /** 프로세스 사이 잠금. 기다려도 다른 프로세스가 놓지 않으면 그 프로세스(holder: PID, 모르면 null) */
  lock(): Promise<Unlock | { holder: number | null }>;
};
/** 재시도 시점: transient는 한 시간 뒤, lasting(에셋 없음, 서명, 실행되지 않음)은 하루 뒤(태그가 바뀌어야 달라진다) */
type Retry = "transient" | "lasting";
/** 버전을 맞춘 결과. 로그 한 줄로 옮긴다(describe). current, from이 null이면 설치 전이다 */
type Outcome =
  | { kind: "current"; version: string }
  | { kind: "installed"; from: string | null; to: string; channel: Channel }
  | { kind: "reused"; from: string | null; to: string }
  | { kind: "superseded"; target: string }
  | { kind: "available"; from: string | null; to: string; channel: Channel }
  | { kind: "unusable"; current: string | null; target: string; reason: RuleProblem; channel: Channel }
  | { kind: "failed"; current: string | null; target: string | null; reason: RuleProblem; channel: Channel; retry: Retry; signature?: true };
/** force: 직접 실행한 것(하루 한 번 제한, 모드, 실행되지 않았던 태그 표시를 무시한다). fresh: 설정이 방금 바뀌었다(하루 한 번 제한만 무시한다) */
type Options = { force?: boolean; skipSignature?: boolean; fresh?: boolean };
/** signature: 서명이 맞지 않았다(로그에 키가 바뀌었을 수 있다고 덧붙인다) */
type Failed = (reason: RuleProblem, retry: Retry, signature?: boolean) => Outcome;
/** 다운로드를 시작한 쪽. auto는 다운로드하는 사이 설정이 바뀌면 버린다 */
type Origin = "auto" | "human";
/** 교체하기 직전에 부른다. 참이면 다운로드한 것을 버린다(그사이 설정이 바뀌었다). null이면 부르지 않는다 */
type Stale = (() => boolean) | null;
/** 마지막 다운로드 실패(카드에 보인다). lasting: 같은 태그로는 다시 시도해도 실패한다 */
type Failure = { target: string | null; reason: RuleProblem; lasting: boolean; at: number };

const EMPTY: State = { version: null, previous: null, lastChecked: 0, unusable: null, channel: null, previousChannel: null, checkedChannel: null };
const isChannel = (value: unknown): value is Channel => typeof value === "string" && Object.hasOwn(REPOS, value);
// 기록이 target을 가리키게 한 것. 지금 버전이 바뀌면 바뀌기 전 버전이 이전 버전이 된다(다운로드한 채널도 함께).
// kept: 남겨 둔 폴더를 다시 쓴다. 그것이 이전 버전이면 그 버전을 다운로드했던 채널을 적는다
function pointedAt(state: State, target: string, channel: Channel, kept: boolean): State {
  const moving = Boolean(state.version) && state.version !== target;
  const origin = kept && target === state.previous ? (state.previousChannel ?? channel) : channel;
  return { ...state, version: target, previous: moving ? state.version : state.previous, channel: origin, previousChannel: moving ? state.channel : state.previousChannel, unusable: null };
}

// 채널, 모드, 고정을 이은 문자열(바뀌었는지 비교한다)
const settingsKey = () => `${config.ytdlp.channel}|${config.ytdlp.update}|${config.ytdlp.version ?? ""}`;

// 휴지통으로 옮긴 폴더를 지운다(잠금 밖). 못 지운 것은 다음 정리가 재시도한다
// 재생 중에도 실행되므로(일일 확인, 초기화 카드) 비동기로 삭제한다
async function emptyTrash(folders: string[]) {
  for (const full of folders) {
    try {
      await fs.promises.rm(full, { recursive: true, force: true, maxRetries: 2 });
    } catch (error) {
      log.warn(`yt-dlp 옛 폴더 삭제 실패(${path.basename(full)}): ${messageOf(error)}`);
    }
  }
}
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function realRun(file: string, args: string[], timeoutMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    const release = leaseFor(file);
    let child: ChildProcess;
    try {
      child = spawn(file, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: toolEnv() });
    } catch (error) {
      release();
      return resolve({ kind: "spawn-failed", code: String(codeOf(error) ?? messageOf(error)) });
    }
    const unregister = procRegistry.register(child, "yt-dlp 버전 확인", { job: "ytdlp-update" });
    // 사용권은 프로세스가 실제로 끝날 때 놓는다(시간 초과로 먼저 돌아가도)
    child.once("exit", release);
    let stdout = "";
    let stderr = "";
    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    let finished = false;
    const done = (ran: Ran) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      unregister();
      resolve(ran);
    };
    // close를 기다리지 않는다: 신호를 무시하거나 물려받은 파이프를 쥔 손자가 있으면 close가 오지 않는다
    const timer = setTimeout(() => {
      procRegistry.kill(child);
      done({ kind: "timeout" });
    }, timeoutMs);
    child.on("error", (error) => {
      if (child.pid === undefined) release();
      done({ kind: "spawn-failed", code: String(codeOf(error) ?? error.name) });
    });
    child.on("close", (status, signal) => done(status === null ? { kind: "signal", signal: String(signal) } : { kind: "exited", status, stdout, stderr }));
  });
}

async function realFetch({ repo, tag, asset, staging, skipSignature }: Parameters<Io["fetch"]>[0]) {
  const zipFile = path.join(staging, asset.zip);
  await fetchRelease({ repo, tag, asset: asset.zip, zipFile, skipSignature });
  try {
    await extractZip(zipFile, path.join(staging, "dir"), UNZIP_LIMITS);
  } catch (error) {
    const problem = rule("ytdlp-unzip-failed", { file: asset.zip }, errorProblem(error));
    throw Object.assign(new Error(logRuleLine(problem)), { kind: "integrity" as const, problem }) satisfies ReleaseError;
  }
  fs.rmSync(zipFile, { force: true });
  // 처음 띄울 때의 백신 검사는 워커 스레드에서 받는다(메인에서 받으면 재생 중인 소리가 끊긴다). 다음 --version 확인은 메인에서 바로 뜬다
  await warmExecutable(path.join(staging, "dir", asset.exe), ["--version"], VERSION_TIMEOUT_MS, toolEnv());
}

/** 살아 있는 프로세스인가. ESRCH만 없는 것으로 본다(권한이 없어 못 보는 것은 살아 있다) */
function realIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) !== "ESRCH";
  }
}

/** 이 폴더의 잠금을 쥔다. 다른 프로세스가 쥐고 있으면 LOCK_WAIT_MS까지 기다리고, 그래도 놓지 않으면 그 프로세스를 돌려준다 */
async function realLock(dir: string): Promise<Unlock | { holder: number | null }> {
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const held = await acquireInstanceLock(dir);
    if (held.ok) return held.release;
    if (Date.now() >= until) return { holder: held.holder };
    await sleep(LOCK_POLL_MS);
  }
}

const REAL_DIR = PROJECT.ytdlp;
const REAL: Io = {
  dir: REAL_DIR,
  asset: assetHere,
  fetch: realFetch,
  run: realRun,
  latestTag: (channel) => latestReleaseTag(REPOS[channel]),
  now: () => Date.now(),
  pid: process.pid,
  isAlive: realIsAlive,
  inUse,
  lock: () => realLock(REAL_DIR),
};

// 실패한 호출을 한 줄로. yt-dlp는 마지막 줄에 원인(ERROR: …)을 적는다
function reasonOf(ran: Ran): RuleProblem {
  if (ran.kind === "timeout") return rule("run-timeout", { sec: VERSION_TIMEOUT_MS / 1000 });
  if (ran.kind === "spawn-failed") return rule("run-spawn-failed", { code: ran.code });
  if (ran.kind === "signal") return rule("run-signal", { signal: ran.signal });
  const last = ran.stderr.trim().split(/\r?\n/).at(-1)?.trim();
  return last ? plain(last) : rule("run-exit", { status: String(ran.status) });
}

class YtdlpBinary {
  io: Io;
  state: State | null = null;
  // 버전 맞추기는 한 번에 하나(기동 확인과 일일 확인이 겹치지 않게)
  busy: Promise<Outcome> | null = null;
  timer: NodeJS.Timeout | null = null;
  /** 다음 확인 시각(예약하지 않았으면 null) */
  nextAt: number | null = null;
  /** 설치 전 실패의 재시도 시점. 설치되면 null */
  pending: Retry | null = null;
  // 봇이 돌리는 중(start 뒤). 실행 파일이 사라졌을 때 설치를 예약하는 것은 봇뿐이다
  started = false;
  // 마지막으로 warn한 lasting 실패 줄. 같은 줄이 또 오면 warn 대신 debug
  warned: string | null = null;
  // 진행 중인 설치의 목표. 목표가 같은 요청만 그 결과를 공유한다
  busyTarget: string | null = null;
  // 채널, 모드, 고정이 바뀔 때마다 오른다
  generation = 0;
  settings = settingsKey();
  /** 채널마다 마지막으로 본 최신 태그(확인 버튼, 일일 확인). 메모리에만 둔다 */
  seen: Partial<Record<Channel, { tag: string; at: number }>> = {};
  failure: Failure | null = null;
  // 마지막으로 잠금을 쥐지 못했을 때 쥐고 있던 다른 프로세스의 PID(모르면 null)
  holder: number | null = null;
  // 마지막으로 읽었을 때의 기록 파일 수정 시각. 달라졌으면 다른 프로세스(update:ytdlp)가 바꾼 것이라 다시 읽는다
  stamp: number | null = null;
  // 진행 중인 맞추기(converge)와 그사이 들어온 요청
  converging: Promise<void> | null = null;
  want: { human: boolean; fresh: boolean } | null = null;

  constructor(io: Io = REAL) {
    this.io = io;
  }

  get stateFile() {
    return path.join(this.io.dir, "state.json");
  }

  /** 이 환경의 실행 파일 이름. stable에 모든 판이 있어 채널과 상관없이 같다. 이 환경용 판이 없으면 null */
  exe(): string | null {
    const asset = this.io.asset("stable");
    return "missing" in asset ? null : asset.exe;
  }

  /** 버전의 실행 파일 경로 */
  fileOf(version: string): string | null {
    const exe = this.exe();
    return exe ? path.join(this.io.dir, version, exe) : null;
  }

  /** 기록의 버전이 있고 그 실행 파일이 있나 */
  installed(state: State | null): state is State & { version: string } {
    const file = state?.version ? this.fileOf(state.version) : null;
    return Boolean(file && fs.existsSync(file));
  }

  // 디스크의 기록. 없거나 깨졌으면 null
  _read(): State | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.stateFile, "utf8")) as Partial<State>;
      return {
        version: typeof raw.version === "string" ? raw.version : null,
        previous: typeof raw.previous === "string" ? raw.previous : null,
        lastChecked: typeof raw.lastChecked === "number" ? raw.lastChecked : 0,
        unusable: typeof raw.unusable === "string" ? raw.unusable : null,
        channel: isChannel(raw.channel) ? raw.channel : null,
        previousChannel: isChannel(raw.previousChannel) ? raw.previousChannel : null,
        checkedChannel: isChannel(raw.checkedChannel) ? raw.checkedChannel : null,
      };
    } catch (error) {
      if (codeOf(error) !== "ENOENT") log.warn(`yt-dlp 버전 기록 읽기 실패: ${messageOf(error)}`);
      return null;
    }
  }

  // 다른 프로세스가 쓰다 만 파일을 읽지 않게 임시 파일에 쓰고 rename 한다. 잠금 안에서만 부른다
  _write(state: State) {
    fs.mkdirSync(this.io.dir, { recursive: true });
    const temp = `${this.stateFile}.${this.io.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, this.stateFile);
    this.state = state;
    this.stamp = this._stampNow();
  }

  _stampNow(): number | null {
    try {
      return fs.statSync(this.stateFile).mtimeMs;
    } catch {
      // 기록이 아직 없다
      return null;
    }
  }

  // 디스크의 기록을 읽어 기억한다
  _load(): State | null {
    this.stamp = this._stampNow();
    this.state = this._read();
    return this.state;
  }

  // 잠금을 쥔다. 다른 프로세스가 놓지 않으면 그 PID를 남기고 null(실패 문구가 쓴다)
  async _lock(): Promise<Unlock | null> {
    const got = await this.io.lock();
    if (typeof got === "function") return got;
    this.holder = got.holder;
    return null;
  }

  // 잠금을 쥐지 못한 다른 프로세스. PID를 알면 함께
  _holderText(): string {
    return `다른 프로세스${this.holder ? `(PID ${this.holder})` : ""}`;
  }

  _busy(): RuleProblem {
    return rule("ytdlp-busy", { ...(this.holder ? { pid: this.holder } : {}), sec: LOCK_WAIT_MS / 1000 });
  }

  /** 잠금 안에서 디스크의 기록을 다시 읽고 고쳐 쓴다. 다른 프로세스가 폴더를 쓰는 중이라 잠금을 쥐지 못하면 null */
  async _update(change: (state: State) => State): Promise<State | null> {
    fs.mkdirSync(this.io.dir, { recursive: true });
    const unlock = await this._lock();
    if (!unlock) return null;
    try {
      const next = change(this._read() ?? EMPTY);
      this._write(next);
      return next;
    } finally {
      await unlock();
    }
  }

  /**
   * 지금 버전의 경로. 설치 전이면 null. 기록 파일이 그사이 바뀌었으면(다른 프로세스가 버전을 바꿨다) 다시 읽는다.
   * 기록의 실행 파일이 사라졌으면 디스크의 기록을 다시 읽고, 그래도 없으면(봇이 돌리는 중이면) 설치를 1분 뒤로 예약한다
   */
  path(): string | null {
    if (this.state === null || this._stampNow() !== this.stamp) this._load();
    if (this.installed(this.state)) return this.fileOf(this.state.version);
    this._load();
    if (this.installed(this.state)) return this.fileOf(this.state.version);
    if (this.started && !this.busy && (this.nextAt === null || this.nextAt - this.io.now() > 60_000)) this._schedule(60_000);
    return null;
  }

  async _version(file: string): Promise<{ ok: true; version: string } | { ok: false; ran: Ran }> {
    const ran = await this.io.run(file, ["--version"], VERSION_TIMEOUT_MS);
    const version = ran.kind === "exited" && ran.status === 0 ? ran.stdout.trim() : "";
    return version ? { ok: true, version } : { ok: false, ran };
  }

  // 받은 태그는 설치 폴더 이름과 실행 경로가 된다. 형식이 다르면 쓰지 않는다
  async _latestTag(channel: Channel) {
    const tag = await this.io.latestTag(channel);
    if (!isYtdlpTag(tag)) throw new Error(`yt-dlp 릴리스 태그 형식이 아님: ${tag.slice(0, 40)}`);
    return tag;
  }

  /**
   * 설치돼 있으면 그대로(네트워크를 쓰지 않는다), 기록이 없으면 설정과 상관없이 목표 버전을 설치한다.
   * force는 직접 실행한 것(설치, update:ytdlp)이다: 실행되지 않았던 태그도 재시도한다. 설치했으면 그 결과(outcome)
   */
  async prepare({ force = false, skipSignature = false }: Options = {}): Promise<{ version: string | null; outcome: Outcome | null }> {
    this._load();
    if (this.installed(this.state)) {
      this.pending = null;
      return { version: this.state.version, outcome: null };
    }
    const outcome = await this._first({ force, skipSignature });
    return { version: this.installed(this.state) ? this.state.version : null, outcome };
  }

  // 처음 설치: 목표를 정해 설치한다. 실행되지 않았던 태그면(force가 아니면) 다시 받지 않는다
  async _first({ force = false, skipSignature = false }: Options): Promise<Outcome | null> {
    const { channel, version: pin } = config.ytdlp;
    let target: string | null = pin;
    if (!target) {
      try {
        target = await this._latestTag(channel);
      } catch (error) {
        this.pending = "transient";
        return { kind: "failed", current: null, target: null, reason: rule("ytdlp-latest-failed", undefined, errorProblem(error)), channel, retry: "transient" };
      }
      this.seen[channel] = { tag: target, at: this.io.now() };
      await this._update((state) => ({ ...state, lastChecked: this.io.now(), checkedChannel: channel }));
    }
    if (!force && target === (this._read() ?? EMPTY).unusable) {
      this.pending = "lasting";
      return null;
    }
    return this._run(target, channel, skipSignature, force ? "human" : "auto");
  }

  /**
   * 목표 버전으로 맞춘다. force는 운영자가 요청한 것(고정, update:ytdlp)이다: 하루 한 번, 모드, 실행되지 않았던 태그를 보지 않고 다운로드한다.
   * 고정이 있으면 모드와 상관없이 그 버전으로, 고정이 없고 manual이면 자동으로 맞추지 않는다. fresh는 하루 한 번 제한만 건너뛴다(설정을 방금 바꿨다).
   * 버전은 디스크의 기록에서 다시 읽는다(돌고 있는 봇이 update:ytdlp가 다운로드한 버전을 이어받는다). 설치 전이면 처음 설치를 한다. 알릴 것이 없으면 null
   */
  async check({ force = false, skipSignature = false, fresh = false }: Options = {}): Promise<Outcome | null> {
    const { channel, version: pin, update: mode } = config.ytdlp;
    this._load();
    if (!this.installed(this.state)) return this._first({ force, skipSignature });
    this.pending = null;
    const state = this.state;
    if (!force && !pin && !this._due(state, channel, mode, fresh)) return null;

    const target = await this._target(channel, pin);
    if (target === state.version) {
      this.failure = null;
      return { kind: "current", version: target };
    }
    const held = force ? undefined : this._hold(state, { target, channel, pin, mode });
    if (held !== undefined) return held;
    return this._run(target, channel, skipSignature, force ? "human" : "auto");
  }

  // 자동으로 맞출 때 다운로드하지 않는 경우. 실행되지 않았던 태그면 조용히 넘어가고(null), notify면 새 버전이 있다고 알린다(확인한 최신 버전은 카드의 업데이트 버튼이 쓴다). 다운로드하면 undefined
  _hold(state: State, { target, channel, pin, mode }: { target: string; channel: Channel; pin: string | null; mode: Mode }): Outcome | null | undefined {
    if (target === state.unusable) return null;
    if (!pin && mode === "notify") return { kind: "available", from: state.version, to: target, channel };
    return undefined;
  }

  // 고정이 없을 때 채널의 최신 버전을 자동으로 확인할 조건. manual이면 확인하지 않는다. auto, notify면 그 채널을 마지막으로 확인한 지 하루가 지났거나 fresh일 때 확인한다
  _due(state: State, channel: Channel, mode: Mode, fresh: boolean): boolean {
    if (mode === "manual") return false;
    const checkedAt = state.checkedChannel === channel ? state.lastChecked : 0;
    return fresh || this.io.now() - checkedAt >= DAY_MS;
  }

  // 목표 버전: 고정이면 그것, 아니면 채널의 최신(조회한 시각과 채널을 적는다)
  async _target(channel: Channel, pin: string | null): Promise<string> {
    if (pin) return pin;
    const tag = await this._latestTag(channel);
    this.seen[channel] = { tag, at: this.io.now() };
    await this._update((fresh) => ({ ...fresh, lastChecked: this.io.now(), checkedChannel: channel }));
    return tag;
  }

  /** 채널의 최신 태그를 조회하기만 한다(다운로드하지 않고 기록도 바꾸지 않는다). 조회한 태그는 update가 대조한다 */
  async peek(): Promise<YtdlpPeek> {
    const { channel } = config.ytdlp;
    const latest = await this._latestTag(channel);
    const at = this.io.now();
    this.seen[channel] = { tag: latest, at };
    return { channel, latest, at };
  }

  /**
   * 운영자가 확인(peek)한 태그로 업데이트한다. 고정이 있으면 pinned, 채널이 그사이 바뀌었거나 태그가 그 채널에서 마지막으로 조회한 최신이 아니면 stale(다시 확인해야 한다).
   * 화면이 보낸 태그를 그대로 쓰지 않는 이유: 아무 태그로나 업데이트할 수 있으면 최근 로그인 없이 버전을 고정하는 길이 된다
   */
  update(channel: string, tag: string): Promise<Outcome> | "pinned" | "stale" {
    if (config.ytdlp.version) return "pinned";
    if (channel !== config.ytdlp.channel || this.seen[config.ytdlp.channel]?.tag !== tag) return "stale";
    this._load();
    if (this.installed(this.state) && this.state.version === tag) return Promise.resolve({ kind: "current", version: tag });
    // 결과(업데이트 완료, 실패)를 로그에 남긴다(맞추기 converge처럼)
    return this._run(tag, config.ytdlp.channel, false, "human").then((outcome) => (this._report(outcome), outcome));
  }

  /**
   * 이전 버전으로 되돌릴 때 고정할 태그와 그것을 다운로드했던 채널(모르면 null: 남은 폴더를 다시 쓸 뿐 다시 다운로드하지는 못한다). 되돌릴 수 없으면 null.
   * 태그를 화면이 보내지 않고 기록에서 읽는다
   */
  rollbackTarget(): { version: string; channel: Channel | null } | null {
    const state = this._load();
    if (!state?.previous) return null;
    const file = this.fileOf(state.previous);
    const kept = Boolean(file && fs.existsSync(file));
    return kept || state.previousChannel ? { version: state.previous, channel: state.previousChannel } : null;
  }

  /**
   * 이전 버전을 삭제한다. 기록에서 지우고(되돌리기가 그 버전을 다시 다운로드하지도 못하게) 폴더를 정리한다.
   * 그 폴더에서 아직 도는 yt-dlp가 있으면 폴더는 다음 정리 때 삭제한다. 삭제한 태그, 이전 버전이 없었으면 null을 반환한다.
   * 잠금을 못 잡거나 기록을 읽지 못하면 예외를 던진다(빈 기록으로 덮어써 지금 버전을 잃지 않게). go: 잠금을 잡은 뒤 바꾸기 전에 부른다(예외를 던지면 바꾸지 않는다)
   */
  async forgetPrevious(go?: () => void): Promise<string | null> {
    const unlock = await this._lock();
    if (!unlock) throw codedError("folder-busy", logRuleLine(this._busy()));
    let gone: string | null;
    try {
      const state = this._read();
      if (!state && fs.existsSync(this.stateFile)) throw codedError("state-broken", "yt-dlp 버전 기록을 읽지 못함");
      go?.();
      gone = state?.previous ?? null;
      if (state && gone) this._write({ ...state, previous: null, previousChannel: null });
    } finally {
      await unlock();
    }
    await this.cleanup();
    return gone;
  }

  /** 업데이트 탭의 yt-dlp 카드에 보낼 상태. 기록은 디스크에서 다시 읽는다(다른 프로세스가 바꿨을 수 있다) */
  status(): YtdlpCardStatus {
    const { channel, version: pin, update: mode } = config.ytdlp;
    const state = this._load();
    const seen = this.seen[channel];
    return {
      version: this.installed(state) ? state.version : null,
      previous: state?.previous ?? null,
      channel,
      mode,
      pin,
      seen: seen ? { latest: seen.tag, at: seen.at } : null,
      nextAt: this.nextAt,
      busy: this.busyTarget,
      failure: this.failure,
      canRollback: this.rollbackTarget() !== null,
    };
  }

  // 설치는 한 번에 하나. 목표가 같으면 진행 중인 설치의 결과를 공유하고, 다르면 그것이 끝난 뒤에 자기 목표로 설치한다
  _run(target: string, channel: Channel, skipSignature: boolean, origin: Origin): Promise<Outcome> {
    if (this.busy) {
      if (this.busyTarget === target) return this.busy;
      const next = () => this._run(target, channel, skipSignature, origin);
      return this.busy.then(next, next);
    }
    const generation = this.generation;
    const stale: Stale = origin === "auto" ? () => this.generation !== generation : null;
    this.busyTarget = target;
    this.busy = this._install(target, channel, skipSignature, stale)
      .then((outcome) => {
        if (outcome.kind === "installed" || outcome.kind === "reused") this.pending = null;
        else if (!this.installed(this.state)) this.pending = outcome.kind === "failed" ? outcome.retry : "lasting";
        this._remember(outcome);
        return outcome;
      })
      .finally(() => {
        this.busy = null;
        this.busyTarget = null;
      });
    return this.busy;
  }

  // 카드에 보일 마지막 실패. 교체했으면 비운다(설정이 바뀌어 다운로드한 것을 버린 경우는 실패가 아니다)
  _remember(outcome: Outcome) {
    if (outcome.kind === "failed") this.failure = { target: outcome.target, reason: outcome.reason, lasting: outcome.retry === "lasting", at: this.io.now() };
    else if (outcome.kind === "unusable") this.failure = { target: outcome.target, reason: rule("ytdlp-unusable", undefined, outcome.reason), lasting: true, at: this.io.now() };
    else if (outcome.kind !== "superseded") this.failure = null;
  }

  async _install(target: string, channel: Channel, skipSignature: boolean, stale: Stale): Promise<Outcome> {
    const current = this.installed(this.state) ? this.state.version : null;
    // 설치된 것이 없어서 하는 다운로드는 버리지 않는다(모드와 상관없이 설치해야 한다)
    const guard: Stale = current === null ? null : stale;
    const failed: Failed = (reason, retry, signature = false) => ({ kind: "failed", current, target, reason, channel, retry, ...(signature ? { signature: true } : {}) });
    const asset = this.io.asset(channel);
    if ("missing" in asset) return failed(asset.missing, "lasting");
    // 시도마다 따로(시간 초과로 내린 --version이 아직 앞의 staging에서 끝나는 중일 수 있다)
    const staging = path.join(this.io.dir, `.staging-${this.io.pid}-${this.io.now()}`);
    try {
      // 두 번째는 받는 사이 다른 프로세스가 같은 버전을 버전 폴더로 옮겼거나 남의 정리가 확인한 폴더를 옮긴 때다
      for (let attempt = 0; attempt < 2; attempt++) {
        const kept = await this._fromKept({ target, channel, asset, current, failed, guard });
        if ("done" in kept) return kept.done;
        if ("again" in kept) continue;
        const fresh = await this._fromRelease({ target, channel, asset, staging, skipSignature, replace: kept.wrong, current, failed, guard });
        if (fresh) return fresh;
      }
      return failed(rule("ytdlp-folders-crossed"), "transient");
    } catch (error) {
      return failed(errorProblem(error), "transient");
    } finally {
      this._clearStaging(staging);
    }
  }

  // 다운로드해 둔 버전(직전 버전으로 되돌리기, 다른 프로세스가 먼저 설치)이면 다운로드하지 않는다. wrong: 그 이름의 폴더에 다른 버전이 들었다(새로 받아 바꾼다)
  async _fromKept({ target, channel, asset, current, failed, guard }: { target: string; channel: Channel; asset: Asset; current: string | null; failed: Failed; guard: Stale }): Promise<{ done: Outcome } | { again: true } | { wrong: boolean }> {
    const file = path.join(this.io.dir, target, asset.exe);
    if (!fs.existsSync(file)) return { wrong: false };
    const kept = await this._version(file);
    // 확인이 일시적으로 실패한 폴더는 건드리지 않는다(돌고 있는 봇이 쓰는 버전일 수 있다)
    if (!kept.ok) return { done: failed(rule("ytdlp-kept-check-failed", { target }, reasonOf(kept.ran)), "transient") };
    if (kept.version !== target) return { wrong: true };
    const done = await this._publish(target, null, { channel, guard });
    if (done === "published") return { done: { kind: "reused", from: current, to: target } };
    if (done === "superseded") return { done: { kind: "superseded", target } };
    if (done === "locked") return { done: failed(this._busy(), "transient") };
    return { again: true };
  }

  // 릴리스를 staging에 받아 확인하고 버전 폴더로 옮긴다. 그사이 다른 프로세스가 같은 버전을 버전 폴더로 옮겼으면 null(처음부터 그것을 확인한다)
  async _fromRelease({ target, channel, asset, staging, skipSignature, replace, current, failed, guard }: { target: string; channel: Channel; asset: Asset; staging: string; skipSignature: boolean; replace: boolean; current: string | null; failed: Failed; guard: Stale }): Promise<Outcome | null> {
    this._clearStaging(staging);
    fs.mkdirSync(staging, { recursive: true });
    try {
      await this.io.fetch({ repo: REPOS[channel], tag: target, asset, staging, skipSignature });
    } catch (error) {
      const kind = (error as Partial<ReleaseError>).kind;
      return failed(errorProblem(error), kind === "missing" || kind === "signature" ? "lasting" : "transient", kind === "signature");
    }
    const got = await this._version(path.join(staging, "dir", asset.exe));
    // 실행은 됐는데 오류로 끝났다(로더가 glibc 부족 등을 적는다). 이 태그는 이 환경에서 쓸 수 없다
    if (!got.ok && got.ran.kind === "exited" && got.ran.stderr.trim()) {
      await this._update((state) => ({ ...state, unusable: target }));
      return { kind: "unusable", current, target, reason: reasonOf(got.ran), channel };
    }
    if (!got.ok) return failed(rule("ytdlp-run-failed", undefined, reasonOf(got.ran)), "transient");
    if (got.version !== target) return failed(rule("ytdlp-version-mismatch", { version: got.version }), "transient");
    const done = await this._publish(target, path.join(staging, "dir"), { channel, guard, replace });
    if (done === "published") return { kind: "installed", from: current, to: target, channel };
    if (done === "superseded") return { kind: "superseded", target };
    if (done === "locked") return failed(this._busy(), "transient");
    if (typeof done === "object") return failed(done.failed, "transient");
    return null;
  }

  /**
   * 잠금 안에서 버전 폴더로 옮기고 기록을 바꾼다. from이 null이면 이미 있는 목적지를 쓴다.
   * 목적지에 이 판의 실행 파일이 없으면(옛 판의 폴더) 휴지통으로 옮기고 그 자리에 둔다. replace면 실행 파일이 있어도(다른 버전이 들었다) 옮긴다.
   * published: 끝남, locked: 잠금을 못 잡음, moved: 확인한 목적지가 사라졌거나(남의 정리) 옮기려던 자리에 남이 먼저 옮김, { failed }: 옮기지 못함(그 원인),
   * superseded: guard가 버리라고 했다(잠금을 기다린 뒤, 옮기기 전에 부른다). channel: 다운로드한 채널(기록에 적는다)
   */
  async _publish(target: string, from: string | null, { channel, guard, replace = false }: { channel: Channel; guard: Stale; replace?: boolean }): Promise<"published" | "locked" | "moved" | "superseded" | RenameFailed> {
    const unlock = await this._lock();
    if (!unlock) return "locked";
    try {
      if (guard?.()) return "superseded";
      const fresh = this._read() ?? EMPTY;
      const ours = this.fileOf(target);
      if (from === null && (!ours || !fs.existsSync(ours))) return "moved";
      if (from !== null) {
        const placed = await this._place(target, from, replace);
        if (placed !== "placed") return placed;
      }
      this._write(pointedAt(fresh, target, channel, from === null));
      return "published";
    } finally {
      await unlock();
    }
  }

  // 잠금 안에서 from을 버전 폴더로 옮긴다. 목적지에 이 판의 실행 파일이 없거나 replace면 먼저 휴지통으로
  async _place(target: string, from: string, replace: boolean): Promise<"placed" | "moved" | RenameFailed> {
    const dest = path.join(this.io.dir, target);
    const ours = this.fileOf(target);
    if (fs.existsSync(dest) && (replace || !ours || !fs.existsSync(ours))) {
      try {
        fs.renameSync(dest, path.join(this.io.dir, `.trash-${target}-${this.io.pid}-${this.io.now()}`));
      } catch (error) {
        log.debug(`yt-dlp 옛 버전 폴더 옮기기 실패(${target}): ${messageOf(error)}`);
        return { failed: rule("ytdlp-trash-failed", { error: String(codeOf(error) ?? messageOf(error)) }) };
      }
    }
    for (let attempt = 1; ; attempt++) {
      // 그사이 남이 같은 자리에 옮겼다(POSIX는 EEXIST, ENOTEMPTY, Windows는 비어 있지 않은 폴더로도 EPERM)
      if (fs.existsSync(dest)) return "moved";
      try {
        fs.renameSync(from, dest);
        return "placed";
      } catch (error) {
        const busy = BUSY_CODES.has(String(codeOf(error) ?? ""));
        if (fs.existsSync(dest)) return "moved";
        if (busy && attempt < RENAME_TRIES) {
          await sleep(RENAME_GAP_MS);
          continue;
        }
        log.debug(`yt-dlp 버전 폴더로 옮기기 실패: ${messageOf(error)}`);
        return { failed: rule("ytdlp-place-failed", { attempt, error: String(codeOf(error) ?? messageOf(error)) }) };
      }
    }
  }

  // 이 프로세스의 staging을 지운다. 그 안에서 아직 도는 yt-dlp(시간 초과로 내린 --version)가 있으면 두고 정리에 맡긴다
  _clearStaging(staging: string) {
    if (this.io.inUse(staging)) return;
    try {
      fs.rmSync(staging, { recursive: true, force: true, maxRetries: 2 });
    } catch (error) {
      log.warn(`yt-dlp 스테이징 폴더 삭제 실패(다음 정리 시 재시도): ${staging} | ${codeOf(error) ?? messageOf(error)}`);
    }
  }

  /**
   * 정리. 건드리는 것만 정해 둔다: 지금, 직전 버전도, 이 프로세스가 쓰는 중인 버전도 아닌 버전 폴더(이름이 릴리스 태그 모양),
   * 주인 프로세스가 없거나(남의 것) 설치 중이 아니고 쓰는 중도 아닌(이 프로세스의 것) staging, 휴지통(.trash-*). 그 밖(state.json, 모르는 이름)은 손대지 않는다.
   * 지울 폴더는 잠금 안에서 휴지통 이름으로 바꾸고 잠금 밖에서 지운다(반쯤 지운 버전 폴더가 버전 이름으로 남지 않는다). 봇만 부른다: 기동 시와 확인할 때마다
   */
  async cleanup() {
    if (!fs.existsSync(this.io.dir)) return;
    const unlock = await this._lock();
    if (!unlock) return void log.warn(`yt-dlp 정리 건너뜀(${this._holderText()}가 yt-dlp 폴더를 사용 중)`);
    const trash: string[] = [];
    try {
      const state = this._read();
      if (state) this.state = state;
      const keep = this._keepSet(state, [state?.version, state?.previous]);
      for (const entry of fs.readdirSync(this.io.dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const full = path.join(this.io.dir, entry.name);
        if (entry.name.startsWith(".trash-")) {
          trash.push(full);
          continue;
        }
        const remove = this._removable(entry.name, full, keep);
        if (!remove) continue;
        const to = path.join(this.io.dir, `.trash-${entry.name}-${this.io.pid}-${this.io.now()}`);
        try {
          fs.renameSync(full, to);
          trash.push(to);
        } catch (error) {
          log.warn(`yt-dlp 옛 폴더 옮기기 실패(${entry.name}): ${messageOf(error)}`);
        }
      }
    } finally {
      await unlock();
    }
    await emptyTrash(trash);
  }

  /**
   * 이전 버전 삭제(forgetPrevious)가 삭제할 폴더의 이름: 이전 버전 폴더(돌고 있는 yt-dlp가 있으면 다음 정리로 미뤄진다), 정리가 삭제할 버전 폴더와 임시 폴더, 휴지통.
   * 미리 보기라 잠금 없이 읽는다. previous: 기록의 이전 버전. 기록이 있는데 읽지 못했으면 null(이전 버전 삭제도 거절한다)
   */
  oldFolders(): { previous: string | null; folders: string[] } | null {
    const state = this._read();
    const keep = this._keepSet(state, [state?.version]);
    if (keep === null) return null;
    if (!fs.existsSync(this.io.dir)) return { previous: state?.previous ?? null, folders: [] };
    const folders = fs
      .readdirSync(this.io.dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (entry.name.startsWith(".trash-") || this._removable(entry.name, path.join(this.io.dir, entry.name), keep)))
      .map((entry) => entry.name);
    return { previous: state?.previous ?? null, folders };
  }

  // 남길 버전 폴더. 기록이 있는데 읽지 못했으면 null(어느 버전이 지금 것인지 모르므로 버전 폴더는 하나도 삭제하지 않는다)
  _keepSet(state: State | null, names: (string | null | undefined)[]): Set<string> | null {
    if (!state && fs.existsSync(this.stateFile)) return null;
    return new Set(names.filter((name): name is string => Boolean(name)));
  }

  // 정리가 삭제할 폴더인가: 지금, 직전, 쓰는 중이 아닌 버전 폴더(keep이 null이면 버전 폴더는 삭제하지 않는다), 주인이 없거나 설치 중도 쓰는 중도 아닌 자기 staging
  _removable(name: string, full: string, keep: Set<string> | null): boolean {
    if (isYtdlpTag(name)) return keep !== null && !keep.has(name) && !this.io.inUse(full);
    const staging = /^\.staging-(\d+)(-\d+)?$/.exec(name);
    if (!staging) return false;
    const owner = Number(staging[1]);
    return owner === this.io.pid ? !this.busy && !this.io.inUse(full) : !this.io.isAlive(owner);
  }

  /** 봇 기동. 버전을 갖추고(없으면 설치) 한 줄 남긴 뒤, 설정대로 맞춘다(고정이면 그 버전으로, auto면 기동 시와 하루 한 번 새 버전을 본다). 설치가 안 됐으면 될 때까지 재시도한다 */
  async start() {
    const { channel, version: pin, update: mode } = config.ytdlp;
    this.started = true;
    this.settings = settingsKey();
    try {
      const { version, outcome } = await this.prepare();
      await this.cleanup();
      log.info(`yt-dlp ${version ?? "없음"} | 채널=${channel}${pin ? ` | 고정=${pin}` : ""} | 업데이트=${updateText(mode, Boolean(pin))}${outcome?.kind === "installed" ? " | 처음 설치" : ""}`);
      this._report(outcome);
    } catch (error) {
      log.warn(`yt-dlp 바이너리 준비 실패: ${messageOf(error)}`);
      this.pending ??= "transient";
    }
    if (this.pending) return this._schedule(this.pending === "lasting" ? DAY_MS : RETRY_MS);
    if (!pin && mode === "manual") return;
    await this._tick();
  }

  /**
   * 채널, 모드, 고정이 바뀌었을 수 있다(설정값 저장, 불러오기, 초기화 뒤에 부른다). 달라졌으면 하던 것이 끝난 뒤 새 설정으로 맞춘다.
   * 자동으로 시작한 다운로드는 교체하지 않고 버린다(generation). 기동 전이면 아무것도 하지 않는다(기동할 때 맞춘다)
   */
  async onSettingsChanged() {
    const now = settingsKey();
    if (now === this.settings) return;
    this.settings = now;
    this.generation++;
    await this.converge({ fresh: true });
  }

  /**
   * 지금 설정으로 맞춘다(진행 중인 설치가 끝난 뒤). human: 운영자가 카드에서 버전을 고정했다(값이 그대로여도, 실행되지 않았던 태그도 재시도한다).
   * fresh: 설정을 방금 바꿨다(하루 한 번 제한을 무시한다)
   */
  converge({ human = false, fresh = false } = {}): Promise<void> {
    if (!this.started) return Promise.resolve();
    // 겹친 요청(저장 알림을 듣는 쪽과 카드의 라우트가 함께 부른다)은 한 번으로 합친다
    this.want = { human: human || Boolean(this.want?.human), fresh: fresh || Boolean(this.want?.fresh) };
    this.converging ??= this._drain().finally(() => {
      this.converging = null;
      // 끝나는 사이에 들어온 요청
      if (this.want) void this.converge();
    });
    return this.converging;
  }

  async _drain() {
    // 같은 순간에 들어오는 요청을 모은다
    await Promise.resolve();
    while (this.want) {
      if (this.busy) await this.busy;
      const { human, fresh } = this.want;
      this.want = null;
      await this._tick({ force: human && Boolean(config.ytdlp.version), fresh: fresh || human });
    }
  }

  // 기동 시, 하루 한 번, 설정이 바뀐 뒤. 목표로 맞추고 버전을 정리한 뒤 다음에 볼 때를 정한다. 설치 전이면 설치를 재시도한다
  async _tick(options: Options = {}) {
    if (isShuttingDown()) return;
    let threw = false;
    let outcome: Outcome | null = null;
    try {
      outcome = await this.check(options);
      this._report(outcome);
    } catch (error) {
      threw = true;
      log.warn(`yt-dlp 업데이트 조회 실패: ${messageOf(error)}`);
    } finally {
      await this.cleanup();
    }
    if (!this.installed(this.state)) return this._schedule((this.pending ?? "transient") === "lasting" ? DAY_MS : RETRY_MS);
    // 다운로드하지 못했으면 설치된 버전으로 돌면서 재시도한다: 일시적이면 한 시간, 같은 태그로는 다시 시도해도 실패하는 것(서명 불일치, 에셋 없음)은 하루 뒤
    if (outcome?.kind === "failed") return this._schedule(outcome.retry === "lasting" ? DAY_MS : RETRY_MS);
    if (threw) return this._schedule(RETRY_MS);
    // 고정한 버전, manual은 맞춘 뒤 더 확인할 것이 없다(설치 전에 예약해 둔 재시도도 취소한다)
    if (config.ytdlp.version || config.ytdlp.update === "manual") return this.stop();
    this._schedule(this.state.lastChecked + DAY_MS - this.io.now());
  }

  _schedule(delayMs: number) {
    this.stop();
    const wait = Math.max(delayMs, 60_000);
    this.nextAt = this.io.now() + wait;
    this.timer = setTimeout(() => {
      this.nextAt = null;
      void this._tick().catch((error: unknown) => log.warn(`yt-dlp 업데이트 및 설치 타이머 작업 실패(이후 확인 예약 중단): ${messageOf(error)}`));
    }, wait);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextAt = null;
  }

  // 봇의 로그. 이미 목표 버전이면 조용히, 하루 간격의 같은 실패는 한 번만
  _report(outcome: Outcome | null) {
    if (!outcome || outcome.kind === "current") return;
    const { level, line } = describe(outcome);
    const lasting = outcome.kind === "unusable" || (outcome.kind === "failed" && outcome.retry === "lasting");
    if (lasting && this.warned === line) return void log.debug(line);
    this.warned = lasting ? line : null;
    log[level](line);
  }
}

// 기동 줄의 업데이트 방식. 버전을 고정하면 하루 한 번 확인하지 않는다(기동 시 한 번 맞춘다)
function updateText(mode: Mode, pinned: boolean) {
  if (mode === "manual") return "꺼짐";
  const name = mode === "notify" ? "알림" : "자동";
  return pinned ? name : `${name} (1일 1회 확인)`;
}

/** 결과를 한 줄로. 봇은 로그로, update:ytdlp는 콘솔로 남긴다 */
function describe(outcome: Outcome): { level: "info" | "warn"; line: string } {
  switch (outcome.kind) {
    case "current":
      return { level: "info", line: `yt-dlp 버전이 목표와 같음(${outcome.version})` };
    case "installed":
      return { level: "info", line: outcome.from ? `yt-dlp 업데이트 완료: ${outcome.from} → ${outcome.to}` : `yt-dlp 설치 완료: ${outcome.to} (${outcome.channel})` };
    case "reused":
      return { level: "info", line: outcome.from ? `yt-dlp를 저장된 버전으로 교체: ${outcome.from} → ${outcome.to}` : `yt-dlp를 저장된 버전으로 설치: ${outcome.to}` };
    case "superseded":
      return { level: "info", line: `yt-dlp ${outcome.target} 다운로드 취소: 다운로드 중 설정이 바뀜` };
    case "available":
      return { level: "info", line: `yt-dlp 업데이트 있음: ${outcome.from ?? "없음"} → ${outcome.to} (${outcome.channel}, 업데이트: 운영자 패널 업데이트 탭의 yt-dlp 카드)` };
    case "unusable":
      return outcome.current ? { level: "warn", line: `yt-dlp 업데이트 불가(기존 버전 유지): ${outcome.current} → ${outcome.target} (${outcome.channel}) - 이 환경에서 실행되지 않음: ${logRuleLine(outcome.reason)}` } : { level: "warn", line: `yt-dlp 설치 불가(yt-dlp를 쓰는 기능이 동작하지 않음): ${outcome.target} (${outcome.channel}) - 이 환경에서 실행되지 않음: ${logRuleLine(outcome.reason)}` };
    case "failed":
      return { level: "warn", line: failedLine(outcome) };
  }
}

function failedLine(outcome: Extract<Outcome, { kind: "failed" }>): string {
  // 서명이 맞지 않을 때만(서명 파일이 없는 옛 릴리스는 이유에 받는 법을 실었다)
  const hint = outcome.signature ? ". yt-dlp 서명 키가 바뀌었을 수 있음. 봇을 업데이트하거나, 확인했으면 pnpm run update:ytdlp --skip-signature" : "";
  return outcome.current ? `yt-dlp 업데이트 실패(기존 버전 유지): ${outcome.current} → ${outcome.target ?? "?"} (${outcome.channel}) - ${logRuleLine(outcome.reason)}${hint}` : `yt-dlp 설치 실패(yt-dlp를 쓰는 기능이 동작하지 않음): ${outcome.target ?? "?"} (${outcome.channel}) - ${logRuleLine(outcome.reason)}${hint}`;
}

/** 봇과 update:ytdlp가 쓰는 하나 */
const ytdlpBinary = new YtdlpBinary();

export { ytdlpBinary, YtdlpBinary, describe, updateText, realLock as lockFolder };
export type { Io as YtdlpBinaryIo, Outcome as YtdlpOutcome, State as YtdlpState, Ran as YtdlpRan, Failure as YtdlpFailure };
