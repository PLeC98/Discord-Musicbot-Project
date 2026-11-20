// 설치 스크립트가 외부 도구(git, npm, tar, tsc)를 실행하는 함수. 명령마다 시간 상한을 두고, 넘으면 그 명령의 프로세스 트리를 강제 종료하고 실패한다.
// 설치 스크립트 전용이다. 처음 실행할 때 종료 시그널(SIGINT, SIGTERM, SIGHUP)과 프로세스 exit에 도는 도구를 종료하는 핸들러를 건다(봇은 종료 처리와 자식 프로세스 레지스트리가 맡는다).
// POSIX는 도구를 별도 프로세스 그룹으로 실행한다. 스크립트를 실행한 쪽(터미널, 봇)의 시그널은 도구 그룹에 가지 않아 위의 핸들러가 전한다.
// 로거, 자식 프로세스 레지스트리를 불러오지 않는다: 로거를 불러오면 console.*를 가로채 스크립트의 안내 출력이 로그 형식으로 바뀐다.
// 환경 변수는 호출부가 넘긴다(비밀값을 뺀 config/tool-env의 사본)

import { spawn, type ChildProcess } from "node:child_process";
import { messageOf } from "./error-text.ts";
import { killTrees } from "./kill-tree.ts";
import { settleChild } from "./process-priority.ts";

const IS_WIN = process.platform === "win32";
/** 오류 메시지에 붙이는 stderr 끝부분의 길이(글자 수) */
const STDERR_TAIL = 2000;
/** capture로 모으는 stdout의 상한(바이트). 넘으면 도구를 강제 종료하고 실패 처리한다 */
const CAPTURE_BYTES = 16 * 1024 * 1024;
/** 도구가 끝난 뒤 출력 파이프가 닫히기를 기다리는 상한(ms). 손자 프로세스가 파이프를 물고 남아 있어도 이 시간이 지나면 끝난 것으로 본다 */
const DRAIN_MS = 3000;

/** 실행 중인 도구. 프로세스가 끝나면(exit) 바로 뺀다(이미 끝난 프로세스의 PID는 다른 프로세스가 다시 쓰고 있을 수 있다) */
const running = new Set<ChildProcess>();
const killRunning = () => killTrees([...running].flatMap(({ pid }) => (pid ? [{ pid, group: !IS_WIN }] : [])));

let hooked = false;
function hookExit() {
  if (hooked) return;
  hooked = true;
  process.on("exit", killRunning);
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ] as const) {
    process.once(signal, () => process.exit(code));
  }
}

/**
 * label: 오류 메시지에 쓰는 이름. timeoutMs: 이 명령 하나의 시간 상한(ms).
 * capture: true면 출력을 모아 반환하고, false면 터미널에 그대로 출력한다. shell: Windows의 .cmd(npm)를 실행할 때만 쓰고, 그때 file은 명령줄 전체다
 */
type ToolRun = { cwd?: string; env: NodeJS.ProcessEnv; label: string; timeoutMs: number; capture?: boolean; shell?: boolean };

/** 도구를 낮은 우선순위로 실행하고 끝나기를 기다린다. 종료 코드 0이면 모은 stdout(capture가 아니면 "")을 반환하고, 아니면 원인을 담은 Error로 거부된다 */
function runTool(file: string, args: string[], { cwd, env, label, timeoutMs, capture = false, shell = false }: ToolRun): Promise<string> {
  hookExit();
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(file, args, { cwd, env, shell, windowsHide: true, detached: !IS_WIN, stdio: ["ignore", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"] });
    } catch (error) {
      reject(new Error(`${label} 실행 실패: ${messageOf(error)}`));
      return;
    }
    if (child.pid) {
      running.add(child);
      try {
        settleChild(child.pid, true); // 재생 중인 봇에게 양보한다
      } catch {
        // 우선순위를 낮추지 못해도 설치는 계속한다
      }
    }
    let timedOut = false;
    let tooBig = false;
    let exited = false;
    let settled = false;
    let drain: NodeJS.Timeout | undefined;
    // 끝난 도구에는 보내지 않는다(PID가 재사용됐을 수 있다)
    const kill = () => {
      if (!exited && child.pid) killTrees([{ pid: child.pid, group: !IS_WIN }]);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const settle = (fail: Error | null, stdout = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drain);
      running.delete(child);
      if (fail) reject(fail);
      else resolve(stdout);
    };
    const out: Buffer[] = [];
    let outBytes = 0;
    let err = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      if (tooBig) return;
      outBytes += chunk.length;
      if (outBytes <= CAPTURE_BYTES) return void out.push(chunk);
      tooBig = true;
      kill();
      child.stdout?.destroy();
    });
    child.stderr?.on("data", (chunk: Buffer) => (err = (err + chunk.toString("utf8")).slice(-STDERR_TAIL)));
    child.once("error", (error) => settle(new Error(`${label} 실행 실패: ${messageOf(error)}`)));
    // close는 출력 파이프가 모두 닫혀야 온다. 손자 프로세스가 파이프를 물고 남으면 오지 않으므로 도구가 끝난 뒤 상한이 지나면 이쪽에서 닫는다
    child.once("exit", () => {
      exited = true;
      running.delete(child);
      drain = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
      }, DRAIN_MS);
    });
    child.once("close", (code, signal) => {
      if (timedOut) return settle(new Error(`${label}: 시간 상한(${Math.round(timeoutMs / 1000)}초)을 넘겨 강제 종료함`));
      if (tooBig) return settle(new Error(`${label}: 출력이 상한(${CAPTURE_BYTES / 1024 / 1024}MB)을 넘어 강제 종료함`));
      if (code === 0) return settle(null, Buffer.concat(out).toString("utf8"));
      settle(new Error(`${label} 실패(종료 코드 ${code ?? signal ?? "?"})${err.trim() ? `: ${err.trim()}` : ""}`));
    });
  });
}

export { runTool };
export type { ToolRun };
