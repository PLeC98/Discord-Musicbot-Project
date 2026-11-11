// bgutil POToken 서버. 유튜브가 요구하는 토큰을 만들어 주는 로컬 HTTP 서버를 실행하고 지킨다.
// 조립(app/main)이 하나 만들어 기동 시 실행하고 종료 시 내린다.
//
// 서버는 실행마다 OS가 준 빈 포트, 127.0.0.1 하나에만 열고, yt-dlp에는 그 주소를 넘긴다(youtube/auth). 고정 포트(4416)를 쓰면
// 그 포트를 남(남은 서버, 따로 띄운 서버, 다른 봇)이 쥐었을 때 서버가 뜨지 못하고 yt-dlp가 남의 서버에 기댄다.
// 주소를 하나로 정하는 까닭: 정하지 않으면 bgutil은 ::1과 127.0.0.1에 따로 열고 하나만 열려도 돈다(남이 IPv4만 쥐면 반쪽으로 뜬다).

import childProcess from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import logger from "../../infra/log/logger.ts";
import * as processRegistry from "../../infra/process-registry.ts";
const log = logger.child({ category: "core" });
import config from "../../config/index.ts";
import { PROJECT } from "../../infra/project-paths.ts";
import { messageOf } from "../../rules/error-kind.ts";

const SERVER_DIR = path.join(PROJECT.bgutil, "server");
const ENTRY = path.join(SERVER_DIR, "build", "main.js");
const HOST = "127.0.0.1";
const RESTART_MS = 5000; // 비정상 종료 뒤 다시 실행하기까지
const BIND_TRIES = 3; // 받은 빈 포트를 그 사이 남이 잡아 실행하지 못한 일이 연달아 이만큼이면 멈춘다
const STOP_WAIT_MS = 1000; // 내릴 때 꺼지기를 기다리는 상한. 넘으면 종료 처리의 자식 정리가 내린다
// Windows 콘솔의 종료 신호(창 닫기, 콘솔 전체에 간 Ctrl+C)로 끝난 코드(STATUS_CONTROL_C_EXIT). 같은 콘솔의 봇도 곧 끝난다
const CONSOLE_EXIT = 0xc000013a;
// 서버보다 먼저 싣는 코드: 봇이 열어 둔 표준 입력이 닫히면(봇이 어떻게 끝나든 OS가 닫는다) 서버도 끝난다. bgutil은 고치지 않는다
const EXIT_WITH_PARENT = "data:text/javascript,process.stdin.on('end',()=>process.exit(0));process.stdin.on('error',()=>process.exit(0));process.stdin.resume();";

// 실행한 서버 프로세스. 여기서 쓰는 것만(테스트가 가짜를 넘긴다)
type Output = { on(event: "data", listener: (chunk: Buffer) => void): unknown } | null;
type PotProcess = { pid?: number; exitCode?: number | null; signalCode?: string | null; stdout: Output; stderr: Output; on(event: "exit", listener: (code: number | null) => void): unknown; on(event: "error", listener: (error: Error) => void): unknown; once(event: "exit", listener: () => void): unknown; kill(signal?: NodeJS.Signals): unknown };
/** 내린 결과. none 실행한 것이 없다, stopped 꺼졌다, timeout 상한 안에 꺼지지 않았다 */
type PotStop = "none" | "stopped" | "timeout";
type Spawn = (command: string, args: string[], options: { cwd: string; stdio: ["pipe", "pipe", "pipe"] }) => PotProcess;
type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json?(): Promise<unknown> }>;
type FreePort = () => Promise<number>;

// 지금 이 봇이 띄운 서버의 주소. 없으면 null(꺼 둠, 설치 안 됨, 내림, 포트를 잡지 못해 멈춤)
let current: string | null = null;

/** yt-dlp가 쓸 POToken 서버 주소. 이 봇이 띄운 서버가 없으면 null(그때는 플러그인을 싣지 않는다) */
function potServerUrl() {
  return current;
}

// 받아 둔 서버의 버전. 준비 확인에서 답한 서버가 이 봇이 띄운 것인지 본다
function installedVersion(): string | null {
  try {
    const version = (JSON.parse(fs.readFileSync(path.join(SERVER_DIR, "package.json"), "utf8")) as { version?: unknown }).version;
    return typeof version === "string" ? version : null;
  } catch {
    // 파일이 없으면 설치되지 않은 것이다(launch 가 알린다). 다른 실패는 bgutil-version 이 기동 시 남긴다
    return null;
  }
}

// OS가 준 빈 포트. 열었다 곧바로 닫으므로 서버가 열기 전에 남이 잡을 수 있다(그때 서버는 곧 끝나고 새 포트로 다시 실행한다)
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, HOST, () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

// bgutil이 발급한 토큰을 그대로 로그에 남기지 않는다. 세션 자격증명이다.
// (sink의 레드액션은 access_token 계열 이름만 알아서 poToken은 그냥 통과한다.)
function scrubBgutilLine(line: unknown): string {
  return String(line)
    .replace(/(Generated IntegrityToken:\s*).*/i, "$1[REDACTED]")
    .replace(/((?:poToken|integrityToken)"?\s*[:=]\s*"?)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]");
}

// 포트를 열지 못했다는 줄. 이 모듈이 새 포트로 다시 실행하므로 오류로 올리지 않는다
const BIND_FAILED = /could not listen/i;

// 남의 프로세스라 레벨을 직접 붙일 수 없다. 스트림(stdout/stderr)과 문구로 구분한다.
// bgutil의 stdout은 전량 요청 단위 상세(POT 생성, 챌린지)라 debug로 내린다. 수명주기(시작, 준비
// 완료, 비정상 종료)는 이 파일이 따로 남기므로 여기서 info로 올릴 것이 없다.
function relay(chunk: Buffer | string, stream: "out" | "err") {
  for (const raw of chunk.toString().split("\n").filter(Boolean)) {
    const line = scrubBgutilLine(raw);
    if (stream === "out" || BIND_FAILED.test(line)) log.debug({ sub: "bgutil" }, line);
    else if (/EADDRINUSE|^\s+at /i.test(line)) log.error({ sub: "bgutil" }, line);
    else log.warn({ sub: "bgutil" }, line);
  }
}

// 준비 확인의 답에 실린 서버 버전
async function versionOf(res: { json?(): Promise<unknown> }) {
  try {
    const version = ((await res.json?.()) as { version?: unknown } | undefined)?.version;
    return typeof version === "string" ? version : null;
  } catch {
    // 응답에 버전이 없으면 알 수 없는 버전이다. 버전 필드가 없는 서버와 동일하게 받아들인다
    return null;
  }
}

/**
 * spawn, exists, fetch, freePort: 바깥 경계. 생략하면 실제 구현. version: 받아 둔 서버의 버전(모르면 null이고 버전을 맞춰 보지 않는다)
 */
function createPotServer({ spawn = (command, args, options) => childProcess.spawn(command, args, options), exists = fs.existsSync, fetch = (url, init) => globalThis.fetch(url, init), freePort = pickFreePort, version = installedVersion() }: { spawn?: Spawn; exists?: (file: string) => boolean; fetch?: Fetch; freePort?: FreePort; version?: string | null } = {}) {
  let proc: PotProcess | null = null;
  let stopping = false;
  let port: number | null = null;
  let bindFailures = 0;
  let starting: Promise<void> = Promise.resolve();

  /** 실행한다. 꺼 두었거나 설치돼 있지 않으면 실행하지 않는다. 돌려주는 것은 실행까지(준비는 waitReady). 던지지 않는다 */
  function start(): Promise<void> {
    return run(true);
  }

  function run(newPort: boolean) {
    starting = launch(newPort).catch((error: unknown) => {
      current = null;
      log.error({ sub: "bgutil" }, `POToken 서버 실행 실패(POToken 없이 진행): ${messageOf(error)}`);
    });
    return starting;
  }

  async function launch(newPort: boolean) {
    if (stopping) return;
    const installed = exists(ENTRY);

    // 꺼 두었으면 조용히 넘어간다. 인증 없는 로컬 HTTP 서버를 상시 실행하지 않는 것이
    // 이 설정의 목적이다.
    if (!config.bgutil.enabled) {
      if (installed) log.debug({ sub: "bgutil" }, "bgutil이 설치되어 있지만 유튜브 탭의 POToken 서버 사용이 꺼져 있음(POToken 서버를 실행하지 않고 진행)");
      return;
    }
    // 켜 두었는데 설치돼 있지 않으면 error 로 알린다. 조용히 넘어가면 POToken이 없는 줄 모른 채 돈다.
    if (!installed) {
      log.error({ sub: "bgutil" }, "유튜브 탭에서 POToken 서버 사용을 켰지만 bgutil이 설치되어 있지 않음(POToken 없이 진행). pnpm run install:bgutil로 설치하세요");
      return;
    }
    if (newPort || port === null) port = await freePort();
    if (stopping) return;
    // 다시 실행하는 사이에도 이 주소를 넘긴다. 빼면 플러그인이 기본 주소(4416)의 남의 서버로 간다
    current = `http://${HOST}:${port}`;
    const child = spawn(process.execPath, ["--import", EXIT_WITH_PARENT, "build/main.js", "-p", String(port), "-H", HOST], { cwd: SERVER_DIR, stdio: ["pipe", "pipe", "pipe"] });
    proc = child;
    let bindFailed = false;
    // 레지스트리가 프로세스가 끝날 때(치명적 종료 포함) 함께 내린다. stop() 을 못 부르고 나가도 서버가 포트를 쥔 채 남지 않게
    const release = processRegistry.register(child, "bgutil", { job: "pot-server" });
    child.stdout?.on("data", (d: Buffer) => relay(d, "out"));
    child.stderr?.on("data", (d: Buffer) => {
      if (BIND_FAILED.test(d.toString())) bindFailed = true;
      relay(d, "err");
    });
    child.on("error", (error) => log.error({ sub: "bgutil" }, `POToken 서버 실행 실패: ${messageOf(error)}`));
    child.on("exit", (code) => {
      release();
      proc = null;
      if (stopping) return;
      if (code === CONSOLE_EXIT) {
        log.debug({ sub: "bgutil" }, "POToken 서버가 콘솔 종료 신호로 끝남(봇도 곧 끝나므로 다시 실행하지 않음)");
        return;
      }
      // 포트를 열지 못해 끝났다(받은 빈 포트를 그 사이 남이 잡았다). 새 포트로 곧바로 다시
      if (bindFailed && code === 1) {
        if (++bindFailures >= BIND_TRIES) {
          current = null;
          log.error({ sub: "bgutil" }, `POToken 서버가 빈 포트를 ${BIND_TRIES}번 연달아 열지 못해 다시 실행하지 않음(POToken 없이 진행)`);
          return;
        }
        log.warn({ sub: "bgutil" }, `포트 ${String(port)}번을 열지 못해 새 포트로 POToken 서버 다시 실행`);
        void run(true);
        return;
      }
      bindFailures = 0;
      log.warn({ sub: "bgutil" }, `POToken 서버 비정상 종료 (code=${code ?? "없음"}), 5초 후 다시 시작`);
      setTimeout(() => void run(false), RESTART_MS);
    });
    log.debug({ sub: "bgutil" }, `POToken 서버 시작(포트 ${port})`);
  }

  // 내리고 꺼질 때까지 기다린다(상한 STOP_WAIT_MS). 꺼지면 레지스트리에서도 빠져 종료 처리의 자식 정리에 섞이지 않는다
  function stop(): Promise<PotStop> {
    stopping = true;
    current = null;
    const child = proc;
    proc = null;
    if (!child) return Promise.resolve("none");
    if (child.exitCode != null || child.signalCode != null) return Promise.resolve("stopped");
    return new Promise((done) => {
      const timer = setTimeout(() => done("timeout"), STOP_WAIT_MS);
      timer.unref?.();
      child.once("exit", () => {
        clearTimeout(timer);
        done("stopped");
      });
      child.kill("SIGTERM");
    });
  }

  // /ping에 응답할 때까지 기다린다(최대 timeoutMs). 실행한 것이 없으면 바로 통과, 시간을 넘기면 경고만.
  // 답한 서버의 버전이 받아 둔 서버와 다르면 이 봇이 띄운 서버가 아니다
  async function waitReady(timeoutMs = 30000) {
    await starting;
    if (!proc) return true;
    const deadline = Date.now() + timeoutMs;
    let lastError = "";
    while (Date.now() < deadline) {
      const url = current;
      try {
        const res = url ? await fetch(`${url}/ping`, { signal: AbortSignal.timeout(1000) }) : null;
        if (res?.ok) {
          const answered = await versionOf(res);
          if (!version || !answered || answered === version) {
            log.info({ sub: "bgutil" }, `POToken 서버 준비 완료 (${String(url)})`);
            return true;
          }
          lastError = `다른 버전(${answered})의 서버가 답함`;
        }
      } catch (error) {
        // 아직 준비 안 됨. 재시도
        lastError = messageOf(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    log.warn({ sub: "bgutil" }, `POToken 서버가 ${timeoutMs / 1000}초 안에 응답하지 않아 POToken 없이 봇 기동.${lastError ? ` 마지막 확인: ${lastError}` : ""}`);
    return false;
  }

  return { start, stop, waitReady };
}

export { createPotServer, scrubBgutilLine, potServerUrl };
export type { PotStop };
