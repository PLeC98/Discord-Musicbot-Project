// yt-dlp 바이너리. 버전마다 vendor/bin/yt-dlp/<버전>/ 에 두고, yt-dlp 를 띄우는 곳(ytdlpSpawn)은 지금 버전의 경로를 묻는다.
//
// 새 버전은 지금 버전의 복사본 위에서 yt-dlp 의 자체 업데이트(--update-to 채널@태그. 받은 파일의 SHA-256 을 검사한다)로 받고,
// 받은 버전이 목표와 같을 때만 바꿔 끼운다. 바꿔 끼우기는 가리키는 경로만 바꾸므로 이미 돌고 있는 yt-dlp 는 옛 버전으로 끝까지 돈다.
// 처음 한 번은 youtube-dl-exec 가 설치 때 받은 것을 옮겨 온다. 그 자리는 npm install 이 stable 로 다시 덮어 쓰지 않는다.
//
// 목표 버전: .env 의 YTDLP_VERSION(고정) 이 있으면 그 버전, 없으면 YTDLP_CHANNEL 의 최신(GitHub 릴리스). 최신은 하루 한 번 본다.
// 새 버전을 보았을 때 할 일은 YTDLP_UPDATE(auto 받아서 바꿔 끼운다 · notify 알린다 · off 보지 않는다).

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import youtubedl from "youtube-dl-exec";
import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
import * as procRegistry from "../infra/process-registry.ts";
import { httpFor } from "../infra/http.ts";
import { messageOf } from "../rules/error-kind.ts";
import { bestEffort } from "../infra/best-effort.ts";
import { PROJECT } from "../infra/project-paths.ts";

const log = logger.child({ category: "ytdlp" });

type Channel = (typeof config.ytdlp)["channel"];
type Mode = (typeof config.ytdlp)["update"];

// 채널마다 릴리스를 내는 저장소(yt-dlp 의 UPDATE_SOURCES 와 같다)
const REPOS: Record<Channel, string> = { stable: "yt-dlp/yt-dlp", nightly: "yt-dlp/yt-dlp-nightly-builds", master: "yt-dlp/yt-dlp-master-builds" };
const DAY_MS = 24 * 60 * 60 * 1000;
// 확인이 실패하면 이만큼 뒤에 다시 본다(하루를 통째로 기다리지 않는다)
const RETRY_MS = 60 * 60 * 1000;
const UPDATE_TIMEOUT_MS = 180_000; // 바이너리 20MB 안팎을 받는다
const VERSION_TIMEOUT_MS = 30_000; // 유닉스용 바이너리는 파이썬으로 뜬다
const API_TIMEOUT_MS = 15_000;

// youtube-dl-exec 가 설치 때 받은 바이너리(라이브러리가 내보내지만 타입에는 없다)
const { YOUTUBE_DL_PATH } = (youtubedl as typeof youtubedl & { constants: { YOUTUBE_DL_PATH: string } }).constants;

/** vendor/bin/yt-dlp/state.json. 지금 버전 · 직전 버전 · 최신을 마지막으로 본 때 · 받아 봤지만 목표가 아니었던 태그 */
type State = { version: string; previous: string | null; lastChecked: number; capped: string | null };
/** 바이너리를 한 번 부른 결과 */
type Ran = { status: number | null; stdout: string; stderr: string };
/** 바깥 경계. 시험은 가짜를 넘긴다 */
type Io = {
  /** 버전마다 폴더를 둘 곳 */
  dir: string;
  /** 처음에 옮겨 올 바이너리 */
  seed: string;
  run(file: string, args: string[], timeoutMs: number): Promise<Ran>;
  /** 채널의 최신 릴리스 태그 */
  latestTag(channel: Channel): Promise<string>;
  now(): number;
};
/** 버전을 맞춘 결과. 로그 한 줄로 옮긴다(describe) */
type Outcome = { kind: "current"; version: string } | { kind: "installed"; from: string; to: string; channel: Channel } | { kind: "reused"; from: string; to: string } | { kind: "available"; from: string; to: string; channel: Channel } | { kind: "capped"; current: string; target: string; got: string; channel: Channel } | { kind: "failed"; current: string; target: string; reason: string; channel: Channel };

function realRun(file: string, args: string[], timeoutMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const release = procRegistry.register(child, "yt-dlp 버전 맞추기", { job: "ytdlp-update" });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => {
      stderr += `\n${timeoutMs / 1000}초 안에 끝나지 않아 멈췄습니다`;
      child.kill();
    }, timeoutMs);
    // 실행 실패면 error 뒤에 close 가 또 온다. 한 번만
    let finished = false;
    const done = (status: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      release();
      resolve({ status, stdout, stderr });
    };
    child.on("error", (error) => {
      stderr += messageOf(error);
      done(null);
    });
    child.on("close", (code) => done(code));
  });
}

// 최신 릴리스는 GitHub API 로(공유 HTTP 클라이언트)
const github = httpFor("github");

async function realLatestTag(channel: Channel) {
  const res = await github.fetch(`https://api.github.com/repos/${REPOS[channel]}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": config.userAgents.bot },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub 릴리스 조회 ${res.status} (${REPOS[channel]})`);
  const { tag_name: tag } = (await res.json()) as { tag_name?: unknown };
  if (typeof tag !== "string" || !tag) throw new Error(`GitHub 릴리스에 태그가 없습니다 (${REPOS[channel]})`);
  return tag;
}

const REAL: Io = { dir: path.join(PROJECT.bin, "yt-dlp"), seed: YOUTUBE_DL_PATH, run: realRun, latestTag: realLatestTag, now: () => Date.now() };

// 실패한 부름을 한 줄로. yt-dlp 는 마지막 줄에 까닭(ERROR: …)을 적는다
const reasonOf = (ran: Ran) => ran.stderr.trim().split(/\r?\n/).at(-1)?.trim() || `종료 코드 ${ran.status ?? "없음"}`;

class YtdlpBinary {
  io: Io;
  state: State | null = null;
  // 버전 맞추기는 한 번에 하나(기동 확인과 하루 확인이 겹치지 않게)
  busy: Promise<Outcome> | null = null;
  timer: NodeJS.Timeout | null = null;
  /** 다음 확인 때(걸어 두지 않았으면 null) */
  nextAt: number | null = null;

  constructor(io: Io = REAL) {
    this.io = io;
  }

  get stateFile() {
    return path.join(this.io.dir, "state.json");
  }

  /** 버전의 바이너리 경로. 이름은 처음에 옮겨 온 것과 같다(유닉스용은 확장자가 없다) */
  fileOf(version: string) {
    return path.join(this.io.dir, version, path.basename(this.io.seed));
  }

  // 디스크의 기록. 기록한 버전의 바이너리가 없으면 없는 것으로 본다
  _read(): State | null {
    try {
      const state = JSON.parse(fs.readFileSync(this.stateFile, "utf8")) as State;
      return typeof state.version === "string" && fs.existsSync(this.fileOf(state.version)) ? state : null;
    } catch {
      return null;
    }
  }

  // 다른 프로세스(update:ytdlp)가 읽다 만 파일을 보지 않게 옆에 쓰고 옮긴다
  _write(state: State) {
    fs.mkdirSync(this.io.dir, { recursive: true });
    const temp = `${this.stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, this.stateFile);
    this.state = state;
  }

  /** 지금 버전의 경로. 아직 옮겨 오지 않았으면 설치 때 받은 것 */
  path() {
    this.state ??= this._read();
    return this.state ? this.fileOf(this.state.version) : this.io.seed;
  }

  async _version(file: string) {
    const ran = await this.io.run(file, ["--version"], VERSION_TIMEOUT_MS);
    const version = ran.stdout.trim();
    if (ran.status !== 0 || !version) throw new Error(`yt-dlp 버전을 읽지 못했습니다(${reasonOf(ran)}): ${file}`);
    return version;
  }

  /** 관리하는 바이너리를 갖춘다. 없으면 설치 때 받은 것을 옮겨 온다(네트워크를 쓰지 않는다) */
  async prepare(): Promise<{ version: string; seeded: boolean }> {
    this.state = this._read();
    if (this.state) return { version: this.state.version, seeded: false };
    if (!fs.existsSync(this.io.seed)) throw new Error(`yt-dlp 바이너리가 없습니다: ${this.io.seed}`);
    const version = await this._version(this.io.seed);
    this._place(this.io.seed, version, "copy");
    this._write({ version, previous: null, lastChecked: 0, capped: null });
    return { version, seeded: true };
  }

  // 바이너리를 버전의 폴더에 둔다
  _place(from: string, version: string, how: "copy" | "move") {
    const to = this.fileOf(version);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (how === "copy") fs.copyFileSync(from, to);
    else fs.renameSync(from, to);
    fs.chmodSync(to, 0o755);
  }

  /**
   * 목표 버전으로 맞춘다. force 는 사람이 부른 것(설치 · update:ytdlp)이다: 하루 한 번 · YTDLP_UPDATE · 받아 봤던 태그를 보지 않고 받는다.
   * 버전은 디스크의 기록에서 다시 읽는다(돌고 있는 봇이 update:ytdlp 가 받은 버전을 이어받는다). 알릴 것이 없으면 null
   */
  async check({ force = false } = {}): Promise<Outcome | null> {
    const { channel, version: pin, update: mode } = config.ytdlp;
    await this.prepare();
    const state = this.state!;
    if (!force && mode === "off") return null;
    if (!force && !pin && this.io.now() - state.lastChecked < DAY_MS) return null;

    let target = pin;
    if (!target) {
      target = await this.io.latestTag(channel);
      this._write({ ...state, lastChecked: this.io.now() });
    }
    if (target === state.version) return { kind: "current", version: target };
    if (!force && target === state.capped) return null;
    if (!force && mode === "notify") return { kind: "available", from: state.version, to: target, channel };
    this.busy ??= this._install(target, channel).finally(() => (this.busy = null));
    return this.busy;
  }

  async _install(target: string, channel: Channel): Promise<Outcome> {
    const current = this.state!.version;
    const swap = (to: string) => this._write({ ...this.state!, version: to, previous: current, capped: null });
    // 받아 둔 버전(직전 버전으로 되돌리기 등)이면 받지 않고 바꿔 끼운다. 어느 채널에서 받은 버전인지는 모른다
    if (fs.existsSync(this.fileOf(target)) && (await this._version(this.fileOf(target)).catch(() => null)) === target) {
      swap(target);
      return { kind: "reused", from: current, to: target };
    }

    // 프로세스마다 따로(돌고 있는 봇과 update:ytdlp 가 겹쳐도 서로의 받기를 지우지 않게). 남은 것은 봇 기동 때의 정리가 지운다
    const staging = path.join(this.io.dir, `.staging-${process.pid}`);
    const file = path.join(staging, path.basename(this.io.seed));
    try {
      fs.rmSync(staging, { recursive: true, force: true });
      fs.mkdirSync(staging, { recursive: true });
      fs.copyFileSync(this.fileOf(current), file);
      const ran = await this.io.run(file, ["--update-to", `${channel}@${target}`], UPDATE_TIMEOUT_MS);
      if (ran.status !== 0) return { kind: "failed", current, target, reason: reasonOf(ran), channel };
      const got = await this._version(file);
      // 이 환경에서 받을 수 있는 버전에 상한이 있으면(yt-dlp 의 _update_spec) 목표가 아닌 버전이 온다. 같은 태그를 날마다 다시 받지 않는다
      if (got !== target) {
        this._write({ ...this.state!, capped: target });
        return { kind: "capped", current, target, got, channel };
      }
      this._place(file, target, "move");
      swap(target);
      return { kind: "installed", from: current, to: target, channel };
    } catch (error) {
      return { kind: "failed", current, target, reason: messageOf(error), channel };
    } finally {
      try {
        fs.rmSync(staging, { recursive: true, force: true, maxRetries: 2 });
      } catch {
        // Windows 에서 옛 파일(.old)이 아직 잡혀 있으면 못 지운다. 다음 받기나 봇 기동 때의 정리가 지운다
      }
    }
  }

  /**
   * 지금 버전 · 직전 버전이 아닌 폴더를 지운다. 봇만 부른다: 기동 때와 확인할 때마다(오래 켜 두어도 버전이 쌓이지 않게).
   * 봇은 디스크의 기록을 막 읽은 뒤라 제가 쓰는 버전이 지금 버전이다. update:ytdlp 는 돌고 있는 봇이 아직 쓰는 버전을 지울 수 있어 부르지 않는다.
   * 옛 버전으로 아직 돌고 있어 못 지운 것(Windows)은 다음에 지운다
   */
  cleanup() {
    const keep = new Set([this.state?.version, this.state?.previous].filter(Boolean));
    if (!fs.existsSync(this.io.dir)) return;
    const entries = fs.readdirSync(this.io.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || keep.has(entry.name)) continue;
      try {
        fs.rmSync(path.join(this.io.dir, entry.name), { recursive: true, force: true });
      } catch {
        // 옛 버전으로 아직 돌고 있다
      }
    }
  }

  /** 봇 기동. 버전을 갖추고 한 줄 남긴 뒤, 설정대로 기동 때와 하루 한 번 새 버전을 본다 */
  async start() {
    const { channel, version: pin, update: mode } = config.ytdlp;
    try {
      const { version, seeded } = await this.prepare();
      this.cleanup();
      log.info(`yt-dlp ${version} | 채널=${channel}${pin ? ` | 고정=${pin}` : ""} | 업데이트=${updateText(mode, Boolean(pin))}${seeded ? " | 설치 때 받은 것을 옮겨 옴" : ""}`);
    } catch (error) {
      log.warn(`yt-dlp 버전을 갖추지 못했습니다: ${messageOf(error)} | 쓰는 경로=${this.path()}`);
      return;
    }
    if (mode === "off") return;
    await this._tick();
  }

  // 기동 때와 하루 한 번. 새 버전을 보고 버전을 정리한 뒤 다음 확인을 건다
  async _tick() {
    let failed = false;
    try {
      report(await this.check());
    } catch (error) {
      failed = true;
      log.warn(`yt-dlp 업데이트 조회 실패: ${messageOf(error)}`);
    } finally {
      this.cleanup();
    }
    // 고정한 버전은 기동 때 한 번만 맞춘다
    if (!config.ytdlp.version) this._schedule(failed ? RETRY_MS : this.state!.lastChecked + DAY_MS - this.io.now());
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
}

// 기동 줄의 업데이트 방식. 버전을 고정하면 하루 한 번 확인하지 않는다(기동 때 한 번 맞춘다)
function updateText(mode: Mode, pinned: boolean) {
  if (mode === "auto") return pinned ? "자동" : "자동 (1일 1회 확인)";
  return mode === "notify" ? "알림만" : "하지 않음";
}

/** 결과를 한 줄로. 봇은 로그로, update:ytdlp 는 콘솔로 남긴다 */
function describe(outcome: Outcome): { level: "info" | "warn"; line: string } {
  switch (outcome.kind) {
    case "current":
      return { level: "info", line: `yt-dlp가 목표 버전입니다(${outcome.version})` };
    case "installed":
      return { level: "info", line: `yt-dlp를 업데이트했습니다: ${outcome.from} → ${outcome.to}` };
    case "reused":
      return { level: "info", line: `yt-dlp를 저장된 버전으로 교체했습니다: ${outcome.from} → ${outcome.to}` };
    case "available":
      return { level: "info", line: `yt-dlp에 업데이트가 있습니다: ${outcome.from} → ${outcome.to} (${outcome.channel}). (업데이트: pnpm run update:ytdlp)` };
    case "capped":
      return { level: "warn", line: `yt-dlp 업데이트 불가. 기존 버전을 유지합니다: ${outcome.current} → ${outcome.target} (${outcome.channel}) - 이 환경에서 받을 수 있는 최고 버전은 ${outcome.got}` };
    case "failed":
      return { level: "warn", line: `yt-dlp 업데이트 실패. 기존 버전을 유지합니다: ${outcome.current} → ${outcome.target} (${outcome.channel}) - ${outcome.reason}` };
  }
}

// 봇의 하루 확인. 이미 목표 버전이면 조용히
function report(outcome: Outcome | null) {
  if (!outcome || outcome.kind === "current") return;
  const { level, line } = describe(outcome);
  log[level](line);
}

/** 봇과 update:ytdlp 가 쓰는 하나 */
const ytdlpBinary = new YtdlpBinary();

export { ytdlpBinary, YtdlpBinary, describe, updateText };
export type { Io as YtdlpBinaryIo, Outcome as YtdlpOutcome, State as YtdlpState };
