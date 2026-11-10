// yt-dlp 바이너리(onedir 판: 실행 파일과 _internal 폴더). 버전마다 vendor/bin/yt-dlp/<버전>/ 에 두고, yt-dlp 를 실행하는 곳(ytdlp-spawn)은 실행할 때마다 현재 버전의 경로를 가져온다.
//
// 새 버전은 GitHub 릴리스의 zip 을 받아 서명, 체크섬을 맞추고(ytdlp-release) 풀어서, --version 이 목표와 같을 때만 버전 폴더로 옮겨 교체한다.
// 교체는 가리키는 경로(state.json)만 바꾸므로 이미 돌고 있는 yt-dlp 는 옛 버전으로 끝까지 돈다. 처음에는(기록이 없으면) 설정과 상관없이 목표 버전을 설치한다.
// 봇과 update:ytdlp(다른 프로세스)가 겹칠 수 있어 기록 다시 읽기, 버전 폴더 공개, 기록 쓰기, 정리의 이름 바꾸기는 OS 가 쥐는 잠금 안에서 한다(자식 프로세스, 네트워크는 잠금 밖).
//
// 목표 버전: .env 의 YTDLP_VERSION(고정) 이 있으면 그 버전, 없으면 YTDLP_CHANNEL 의 최신(GitHub 릴리스). 최신은 하루 한 번 본다.
// 새 버전을 보았을 때 할 일은 YTDLP_UPDATE(auto 다운로드해 교체한다, notify 알린다, off 보지 않는다).

import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
import * as procRegistry from "../infra/process-registry.ts";
import { acquireInstanceLock } from "../infra/instance-lock.ts";
import { latestReleaseTag } from "./github-release.ts";
import { assetHere, fetchRelease, type Asset, type ReleaseError } from "./ytdlp-release.ts";
import { leaseFor, inUse } from "./ytdlp-exec.ts";
import { extractZip } from "../infra/zip.ts";
import { isYtdlpTag } from "../rules/ytdlp-tag.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import { bestEffort } from "../infra/best-effort.ts";
import { PROJECT } from "../infra/project-paths.ts";

const log = logger.child({ category: "ytdlp" });

type Channel = (typeof config.ytdlp)["channel"];
type Mode = (typeof config.ytdlp)["update"];

// 채널마다 릴리스를 내는 저장소(yt-dlp 의 UPDATE_SOURCES 와 같다)
const REPOS: Record<Channel, string> = { stable: "yt-dlp/yt-dlp", nightly: "yt-dlp/yt-dlp-nightly-builds", master: "yt-dlp/yt-dlp-master-builds" };
const DAY_MS = 24 * 60 * 60 * 1000;
// 확인, 설치가 일시적으로 실패하면 이만큼 뒤에 다시 본다(하루를 통째로 기다리지 않는다)
const RETRY_MS = 60 * 60 * 1000;
const VERSION_TIMEOUT_MS = 30_000; // 처음 실행하는 onedir 판은 백신이 140여 개 파일을 검사해 수 초 걸린다
// 풀린 크기 상한. 지금 가장 큰 macOS 판이 129MB, 134개
const UNZIP_LIMITS = { maxEntries: 1000, maxBytes: 512 * 1024 * 1024 };
const LOCK_WAIT_MS = 60_000;
const LOCK_POLL_MS = 200;
// 백신이 막 쓴 파일을 잡고 있으면 Windows 의 폴더 이름 바꾸기가 잠깐 실패한다
const RENAME_TRIES = 10;
const RENAME_GAP_MS = 500;
const BUSY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * vendor/bin/yt-dlp/state.json. 현재 버전(설치 전이면 null), 이전 버전, 최신을 마지막으로 확인한 시각,
 * 다운로드했지만 이 환경에서 실행되지 않은 태그(하루 확인이 다시 다운로드하지 않는다)
 */
type State = { version: string | null; previous: string | null; lastChecked: number; unusable: string | null };
/** 바이너리를 한 번 부른 결과. 띄우기 실패, 시간 초과, 신호 종료는 이 환경의 상한이 아니라 일시적 실패로 본다 */
type Ran = { kind: "exited"; status: number; stdout: string; stderr: string } | { kind: "spawn-failed"; code: string } | { kind: "timeout" } | { kind: "signal"; signal: string };
/** 잠금을 놓는 함수 */
type Unlock = () => Promise<void>;
/** 바깥 경계. 테스트는 가짜를 넘긴다 */
type Io = {
  /** 버전마다 폴더를 둘 곳 */
  dir: string;
  /** 이 환경의 자산(채널마다. 없으면 까닭) */
  asset(channel: Channel): Asset | { missing: string };
  /** 한 태그의 자산을 받아 확인하고 staging/dir 에 푼다. 실패는 ReleaseError(kind) */
  fetch(job: { repo: string; tag: string; asset: Asset; staging: string; skipSignature: boolean }): Promise<void>;
  run(file: string, args: string[], timeoutMs: number): Promise<Ran>;
  /** 채널의 최신 릴리스 태그 */
  latestTag(channel: Channel): Promise<string>;
  now(): number;
  /** 이 프로세스. staging, 휴지통 폴더 이름에 쓴다 */
  pid: number;
  isAlive(pid: number): boolean;
  /** 그 폴더나 그 아래에서 이 프로세스가 띄운 yt-dlp 가 도는 중인가 */
  inUse(dir: string): boolean;
  /** 프로세스 사이 잠금. 기다려도 못 잡으면 null */
  lock(): Promise<Unlock | null>;
};
/** 다시 해 볼 때: transient 는 한 시간 뒤, lasting(자산 없음, 서명, 실행되지 않음)은 하루 뒤(태그가 바뀌어야 달라진다) */
type Retry = "transient" | "lasting";
/** 버전을 맞춘 결과. 로그 한 줄로 옮긴다(describe). current, from 이 null 이면 설치 전이다 */
type Outcome = { kind: "current"; version: string } | { kind: "installed"; from: string | null; to: string; channel: Channel } | { kind: "reused"; from: string | null; to: string } | { kind: "available"; from: string; to: string; channel: Channel } | { kind: "unusable"; current: string | null; target: string; reason: string; channel: Channel } | { kind: "failed"; current: string | null; target: string | null; reason: string; channel: Channel; retry: Retry };
type Options = { force?: boolean; skipSignature?: boolean };
type Failed = (reason: string, retry: Retry) => Outcome;

const EMPTY: State = { version: null, previous: null, lastChecked: 0, unusable: null };

// 휴지통으로 옮긴 폴더를 지운다(잠금 밖). 못 지운 것은 다음 정리가 다시 해 본다
function emptyTrash(folders: string[]) {
  for (const full of folders) {
    try {
      fs.rmSync(full, { recursive: true, force: true, maxRetries: 2 });
    } catch (error) {
      log.debug(`yt-dlp 옛 폴더 삭제 실패(${path.basename(full)}): ${messageOf(error)}`);
    }
  }
}
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function realRun(file: string, args: string[], timeoutMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    const release = leaseFor(file);
    let child: ChildProcess;
    try {
      child = spawn(file, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
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
    // close 를 기다리지 않는다: 신호를 무시하거나 물려받은 파이프를 쥔 손자가 있으면 close 가 오지 않는다
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
    throw Object.assign(new Error(`${asset.zip} 압축 풀기 실패: ${messageOf(error)}`), { kind: "integrity" as const }) satisfies ReleaseError;
  }
  fs.rmSync(zipFile, { force: true });
}

/** 살아 있는 프로세스인가. ESRCH 만 없는 것으로 본다(권한이 없어 못 보는 것은 살아 있다) */
function realIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) !== "ESRCH";
  }
}

/** 이 폴더의 잠금을 쥔다. 다른 실행이 쥐고 있으면 LOCK_WAIT_MS 까지 기다린다 */
async function realLock(dir: string): Promise<Unlock | null> {
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const held = await acquireInstanceLock(dir);
    if (held.ok) return held.release;
    if (Date.now() >= until) return null;
    await sleep(LOCK_POLL_MS);
  }
}

const REAL_DIR = path.join(PROJECT.bin, "yt-dlp");
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

// 실패한 호출을 한 줄로. yt-dlp 는 마지막 줄에 원인(ERROR: …)을 적는다
function reasonOf(ran: Ran) {
  if (ran.kind === "timeout") return `${VERSION_TIMEOUT_MS / 1000}초 안에 끝나지 않아 중단`;
  if (ran.kind === "spawn-failed") return `실행하지 못함(${ran.code})`;
  if (ran.kind === "signal") return `신호로 끝남(${ran.signal})`;
  return ran.stderr.trim().split(/\r?\n/).at(-1)?.trim() || `종료 코드 ${ran.status}`;
}

class YtdlpBinary {
  io: Io;
  state: State | null = null;
  // 버전 맞추기는 한 번에 하나(기동 확인과 하루 확인이 겹치지 않게)
  busy: Promise<Outcome> | null = null;
  timer: NodeJS.Timeout | null = null;
  /** 다음 확인 시각(예약하지 않았으면 null) */
  nextAt: number | null = null;
  /** 설치 전 실패의 다시 해 볼 때. 설치되면 null */
  pending: Retry | null = null;
  // 봇이 돌리는 중(start 뒤). 실행 파일이 사라졌을 때 설치를 예약하는 것은 봇뿐이다
  started = false;
  // 같은 까닭의 lasting 실패는 warn 을 한 번만
  warned: string | null = null;

  constructor(io: Io = REAL) {
    this.io = io;
  }

  get stateFile() {
    return path.join(this.io.dir, "state.json");
  }

  /** 이 환경의 실행 파일 이름. stable 에 모든 판이 있어 채널과 상관없이 같다. 이 환경용 판이 없으면 null */
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
      };
    } catch (error) {
      if (codeOf(error) !== "ENOENT") log.debug(`yt-dlp 버전 기록 읽기 실패: ${messageOf(error)}`);
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
  }

  /** 잠금 안에서 디스크의 기록을 다시 읽고 고쳐 쓴다. 잠금을 못 잡으면 null */
  async _update(change: (state: State) => State): Promise<State | null> {
    fs.mkdirSync(this.io.dir, { recursive: true });
    const unlock = await this.io.lock();
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
   * 지금 버전의 경로. 설치 전이면 null. 기록의 실행 파일이 사라졌으면 디스크의 기록을 다시 읽고,
   * 그래도 없으면(봇이 돌리는 중이면) 설치를 1분 뒤로 예약한다
   */
  path(): string | null {
    this.state ??= this._read();
    if (this.installed(this.state)) return this.fileOf(this.state.version);
    this.state = this._read();
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
   * force 는 사람이 부른 것(설치, update:ytdlp)이다: 실행되지 않았던 태그도 다시 해 본다. 설치했으면 그 결과(outcome)
   */
  async prepare({ force = false, skipSignature = false }: Options = {}): Promise<{ version: string | null; outcome: Outcome | null }> {
    this.state = this._read();
    if (this.installed(this.state)) {
      this.pending = null;
      return { version: this.state.version, outcome: null };
    }
    const outcome = await this._first({ force, skipSignature });
    return { version: this.installed(this.state) ? this.state.version : null, outcome };
  }

  // 처음 설치: 목표를 정해 설치한다. 실행되지 않았던 태그면(force 가 아니면) 다시 받지 않는다
  async _first({ force = false, skipSignature = false }: Options): Promise<Outcome | null> {
    const { channel, version: pin } = config.ytdlp;
    let target: string | null = pin;
    if (!target) {
      try {
        target = await this._latestTag(channel);
      } catch (error) {
        this.pending = "transient";
        return { kind: "failed", current: null, target: null, reason: `최신 릴리스 조회 실패: ${messageOf(error)}`, channel, retry: "transient" };
      }
      await this._update((state) => ({ ...state, lastChecked: this.io.now() }));
    }
    if (!force && target === (this._read() ?? EMPTY).unusable) {
      this.pending = "lasting";
      return null;
    }
    return this._run(target, channel, skipSignature);
  }

  /**
   * 목표 버전으로 맞춘다. force 는 사람이 부른 것(설치, update:ytdlp)이다: 하루 한 번, YTDLP_UPDATE, 실행되지 않았던 태그를 보지 않고 다운로드한다.
   * 버전은 디스크의 기록에서 다시 읽는다(돌고 있는 봇이 update:ytdlp 가 다운로드한 버전을 이어받는다). 설치 전이면 처음 설치를 한다. 알릴 것이 없으면 null
   */
  async check({ force = false, skipSignature = false }: Options = {}): Promise<Outcome | null> {
    const { channel, version: pin, update: mode } = config.ytdlp;
    this.state = this._read();
    if (!this.installed(this.state)) return this._first({ force, skipSignature });
    this.pending = null;
    const state = this.state;
    if (!force && mode === "off") return null;
    if (!force && !pin && this.io.now() - state.lastChecked < DAY_MS) return null;

    const target = await this._target(channel, pin);
    if (target === state.version) return { kind: "current", version: target };
    if (!force && target === state.unusable) return null;
    if (!force && mode === "notify") return { kind: "available", from: state.version, to: target, channel };
    return this._run(target, channel, skipSignature);
  }

  // 목표 버전: 고정이면 그것, 아니면 채널의 최신(물은 시각을 적는다)
  async _target(channel: Channel, pin: string | null): Promise<string> {
    if (pin) return pin;
    const tag = await this._latestTag(channel);
    await this._update((fresh) => ({ ...fresh, lastChecked: this.io.now() }));
    return tag;
  }

  // 설치는 한 번에 하나. 겹치면 하던 것을 기다린다
  _run(target: string, channel: Channel, skipSignature: boolean): Promise<Outcome> {
    this.busy ??= this._install(target, channel, skipSignature)
      .then((outcome) => {
        if (outcome.kind === "installed" || outcome.kind === "reused") this.pending = null;
        else if (!this.installed(this.state)) this.pending = outcome.kind === "failed" ? outcome.retry : "lasting";
        return outcome;
      })
      .finally(() => (this.busy = null));
    return this.busy;
  }

  async _install(target: string, channel: Channel, skipSignature: boolean): Promise<Outcome> {
    const current = this.installed(this.state) ? this.state.version : null;
    const failed: Failed = (reason, retry) => ({ kind: "failed", current, target, reason, channel, retry });
    const asset = this.io.asset(channel);
    if ("missing" in asset) return failed(asset.missing, "lasting");
    // 시도마다 따로(시간 초과로 내린 --version 이 아직 앞의 staging 에서 끝나는 중일 수 있다)
    const staging = path.join(this.io.dir, `.staging-${this.io.pid}-${this.io.now()}`);
    try {
      // 두 번째는 받는 사이 다른 프로세스가 같은 버전을 공개했거나 남의 정리가 확인한 폴더를 옮긴 때다
      for (let attempt = 0; attempt < 2; attempt++) {
        const kept = await this._fromKept(target, asset, current, failed);
        if ("done" in kept) return kept.done;
        if ("again" in kept) continue;
        const fresh = await this._fromRelease({ target, channel, asset, staging, skipSignature, replace: kept.wrong, current, failed });
        if (fresh) return fresh;
      }
      return failed("버전 폴더가 다른 프로세스와 엇갈림", "transient");
    } catch (error) {
      return failed(messageOf(error), "transient");
    } finally {
      this._clearStaging(staging);
    }
  }

  // 다운로드해 둔 버전(직전 버전으로 되돌리기, 다른 프로세스가 먼저 설치)이면 다운로드하지 않는다. wrong: 그 이름의 폴더에 다른 버전이 들었다(새로 받아 바꾼다)
  async _fromKept(target: string, asset: Asset, current: string | null, failed: Failed): Promise<{ done: Outcome } | { again: true } | { wrong: boolean }> {
    const file = path.join(this.io.dir, target, asset.exe);
    if (!fs.existsSync(file)) return { wrong: false };
    const kept = await this._version(file);
    // 확인이 일시적으로 실패한 폴더는 건드리지 않는다(돌고 있는 봇이 쓰는 버전일 수 있다)
    if (!kept.ok) return { done: failed(`저장된 yt-dlp ${target} 확인 실패: ${reasonOf(kept.ran)}`, "transient") };
    if (kept.version !== target) return { wrong: true };
    const done = await this._publish(target, null);
    if (done === "published") return { done: { kind: "reused", from: current, to: target } };
    if (done === "locked") return { done: failed("버전 기록 잠금을 잡지 못함", "transient") };
    return { again: true };
  }

  // 릴리스를 staging 에 받아 확인하고 공개한다. 그사이 다른 프로세스가 같은 버전을 공개했으면 null(처음부터 그것을 확인한다)
  async _fromRelease({ target, channel, asset, staging, skipSignature, replace, current, failed }: { target: string; channel: Channel; asset: Asset; staging: string; skipSignature: boolean; replace: boolean; current: string | null; failed: Failed }): Promise<Outcome | null> {
    this._clearStaging(staging);
    fs.mkdirSync(staging, { recursive: true });
    try {
      await this.io.fetch({ repo: REPOS[channel], tag: target, asset, staging, skipSignature });
    } catch (error) {
      const kind = (error as Partial<ReleaseError>).kind;
      return failed(messageOf(error), kind === "missing" || kind === "signature" ? "lasting" : "transient");
    }
    const got = await this._version(path.join(staging, "dir", asset.exe));
    // 실행은 됐는데 오류로 끝났다(로더가 glibc 부족 등을 적는다). 이 태그는 이 환경에서 쓸 수 없다
    if (!got.ok && got.ran.kind === "exited" && got.ran.stderr.trim()) {
      await this._update((state) => ({ ...state, unusable: target }));
      return { kind: "unusable", current, target, reason: reasonOf(got.ran), channel };
    }
    if (!got.ok) return failed(`다운로드한 yt-dlp 실행 실패: ${reasonOf(got.ran)}`, "transient");
    if (got.version !== target) return failed(`다운로드한 yt-dlp 의 버전이 다름(${got.version})`, "transient");
    const done = await this._publish(target, path.join(staging, "dir"), replace);
    if (done === "published") return { kind: "installed", from: current, to: target, channel };
    if (done === "locked") return failed("버전 기록 잠금을 잡지 못함", "transient");
    if (done === "rename-failed") return failed("버전 폴더로 옮기지 못함", "transient");
    return null;
  }

  /**
   * 잠금 안에서 버전 폴더를 공개하고 기록을 바꾼다. from 이 null 이면 이미 있는 목적지를 쓴다.
   * 목적지에 이 판의 실행 파일이 없으면(옛 판의 폴더) 휴지통으로 옮기고 그 자리에 둔다. replace 면 실행 파일이 있어도(다른 버전이 들었다) 옮긴다.
   * published: 끝남, locked: 잠금을 못 잡음, moved: 확인한 목적지가 사라졌거나(남의 정리) 공개하려던 자리에 남이 먼저 공개함, rename-failed: 옮기지 못함
   */
  async _publish(target: string, from: string | null, replace = false): Promise<"published" | "locked" | "moved" | "rename-failed"> {
    const unlock = await this.io.lock();
    if (!unlock) return "locked";
    try {
      const fresh = this._read() ?? EMPTY;
      const ours = this.fileOf(target);
      if (from === null && (!ours || !fs.existsSync(ours))) return "moved";
      if (from !== null) {
        const placed = await this._place(target, from, replace);
        if (placed !== "placed") return placed;
      }
      const previous = fresh.version && fresh.version !== target ? fresh.version : fresh.previous;
      this._write({ ...fresh, version: target, previous, unusable: null });
      return "published";
    } finally {
      await unlock();
    }
  }

  // 잠금 안에서 from 을 버전 폴더로 옮긴다. 목적지에 이 판의 실행 파일이 없거나 replace 면 먼저 휴지통으로
  async _place(target: string, from: string, replace: boolean): Promise<"placed" | "moved" | "rename-failed"> {
    const dest = path.join(this.io.dir, target);
    const ours = this.fileOf(target);
    if (fs.existsSync(dest) && (replace || !ours || !fs.existsSync(ours))) {
      try {
        fs.renameSync(dest, path.join(this.io.dir, `.trash-${target}-${this.io.pid}-${this.io.now()}`));
      } catch (error) {
        log.debug(`yt-dlp 옛 버전 폴더 옮기기 실패(${target}): ${messageOf(error)}`);
        return "rename-failed";
      }
    }
    for (let attempt = 1; ; attempt++) {
      // 그사이 남이 같은 자리에 공개했다(POSIX 는 EEXIST, ENOTEMPTY, Windows 는 비어 있지 않은 폴더로도 EPERM)
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
        return "rename-failed";
      }
    }
  }

  // 이 프로세스의 staging 을 지운다. 그 안에서 아직 도는 yt-dlp(시간 초과로 내린 --version)가 있으면 두고 정리에 맡긴다
  _clearStaging(staging: string) {
    if (this.io.inUse(staging)) return;
    try {
      fs.rmSync(staging, { recursive: true, force: true, maxRetries: 2 });
    } catch (error) {
      log.debug(`yt-dlp 다운로드 임시 폴더 삭제 실패: ${messageOf(error)}`);
    }
  }

  /**
   * 정리. 건드리는 것만 정해 둔다: 지금, 직전 버전도, 이 프로세스가 쓰는 중인 버전도 아닌 버전 폴더(이름이 릴리스 태그 모양),
   * 주인 프로세스가 없거나(남의 것) 설치 중이 아니고 쓰는 중도 아닌(이 프로세스의 것) staging, 휴지통(.trash-*). 그 밖(state.json, 모르는 이름)은 손대지 않는다.
   * 지울 폴더는 잠금 안에서 휴지통 이름으로 바꾸고 잠금 밖에서 지운다(반쯤 지운 버전 폴더가 버전 이름으로 남지 않는다). 봇만 부른다: 기동 시와 확인할 때마다
   */
  async cleanup() {
    if (!fs.existsSync(this.io.dir)) return;
    const unlock = await this.io.lock();
    if (!unlock) return void log.debug("yt-dlp 정리 건너뜀(버전 기록 잠금을 잡지 못함)");
    const trash: string[] = [];
    try {
      const state = this._read();
      if (state) this.state = state;
      const keep = new Set([state?.version, state?.previous].filter(Boolean));
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
          log.debug(`yt-dlp 옛 폴더 옮기기 실패(${entry.name}): ${messageOf(error)}`);
        }
      }
    } finally {
      await unlock();
    }
    emptyTrash(trash);
  }

  // 정리가 지울 폴더인가: 지금, 직전, 쓰는 중이 아닌 버전 폴더, 주인이 없거나 설치 중도 쓰는 중도 아닌 자기 staging
  _removable(name: string, full: string, keep: Set<string | null | undefined>): boolean {
    if (isYtdlpTag(name)) return !keep.has(name) && !this.io.inUse(full);
    const staging = /^\.staging-(\d+)(-\d+)?$/.exec(name);
    if (!staging) return false;
    const owner = Number(staging[1]);
    return owner === this.io.pid ? !this.busy && !this.io.inUse(full) : !this.io.isAlive(owner);
  }

  /** 봇 기동. 버전을 갖추고(없으면 설치) 한 줄 남긴 뒤, 설정대로 기동 시와 하루 한 번 새 버전을 본다. 설치가 안 됐으면 될 때까지 다시 해 본다 */
  async start() {
    const { channel, version: pin, update: mode } = config.ytdlp;
    this.started = true;
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
    if (mode === "off") return;
    await this._tick();
  }

  // 기동 시와 하루 한 번. 새 버전을 보고 버전을 정리한 뒤 다음 확인을 예약한다. 설치 전이면 설치를 다시 해 본다
  async _tick() {
    let failed = false;
    try {
      this._report(await this.check());
    } catch (error) {
      failed = true;
      log.warn(`yt-dlp 업데이트 조회 실패: ${messageOf(error)}`);
    } finally {
      await this.cleanup();
    }
    if (!this.installed(this.state)) return this._schedule((this.pending ?? "transient") === "lasting" ? DAY_MS : RETRY_MS);
    // 고정한 버전, off 는 기동 시 한 번만 맞춘다(설치 전에 걸어 둔 다시 해 보기도 지운다)
    if (config.ytdlp.version || config.ytdlp.update === "off") return this.stop();
    this._schedule(failed ? RETRY_MS : this.state!.lastChecked + DAY_MS - this.io.now());
  }

  _schedule(delayMs: number) {
    this.stop();
    const wait = Math.max(delayMs, 60_000);
    this.nextAt = this.io.now() + wait;
    this.timer = setTimeout(() => {
      this.nextAt = null;
      bestEffort(log, this._tick(), "yt-dlp 업데이트 조회");
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
  if (mode === "auto") return pinned ? "자동" : "자동 (1일 1회 확인)";
  return mode === "notify" ? "알림만" : "하지 않음";
}

/** 결과를 한 줄로. 봇은 로그로, update:ytdlp 는 콘솔로 남긴다 */
function describe(outcome: Outcome): { level: "info" | "warn"; line: string } {
  switch (outcome.kind) {
    case "current":
      return { level: "info", line: `yt-dlp 버전이 목표와 같음(${outcome.version})` };
    case "installed":
      return { level: "info", line: outcome.from ? `yt-dlp 업데이트 완료: ${outcome.from} → ${outcome.to}` : `yt-dlp 설치 완료: ${outcome.to} (${outcome.channel})` };
    case "reused":
      return { level: "info", line: outcome.from ? `yt-dlp를 저장된 버전으로 교체: ${outcome.from} → ${outcome.to}` : `yt-dlp를 저장된 버전으로 설치: ${outcome.to}` };
    case "available":
      return { level: "info", line: `yt-dlp 업데이트 있음: ${outcome.from} → ${outcome.to} (${outcome.channel}). (업데이트: pnpm run update:ytdlp)` };
    case "unusable":
      return outcome.current ? { level: "warn", line: `yt-dlp 업데이트 불가(기존 버전 유지): ${outcome.current} → ${outcome.target} (${outcome.channel}) - 이 환경에서 실행되지 않음: ${outcome.reason}` } : { level: "warn", line: `yt-dlp 설치 불가(yt-dlp 를 쓰는 기능이 동작하지 않음): ${outcome.target} (${outcome.channel}) - 이 환경에서 실행되지 않음: ${outcome.reason}` };
    case "failed": {
      const hint = /서명/.test(outcome.reason) ? ". yt-dlp 서명 키가 바뀌었을 수 있음. 봇을 업데이트하거나, 확인했으면 pnpm run update:ytdlp --skip-signature" : "";
      return outcome.current ? { level: "warn", line: `yt-dlp 업데이트 실패(기존 버전 유지): ${outcome.current} → ${outcome.target ?? "?"} (${outcome.channel}) - ${outcome.reason}${hint}` } : { level: "warn", line: `yt-dlp 설치 실패(yt-dlp 를 쓰는 기능이 동작하지 않음): ${outcome.target ?? "?"} (${outcome.channel}) - ${outcome.reason}${hint}` };
    }
  }
}

/** 봇과 update:ytdlp 가 쓰는 하나 */
const ytdlpBinary = new YtdlpBinary();

export { ytdlpBinary, YtdlpBinary, describe, updateText, realLock as lockFolder };
export type { Io as YtdlpBinaryIo, Outcome as YtdlpOutcome, State as YtdlpState, Ran as YtdlpRan };
