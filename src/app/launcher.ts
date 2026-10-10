// 실행기. 봇을 자식 프로세스로 띄우고, 봇이 다시 시작 코드(EXIT.restart)로 끝나면 다시 띄운다. 대시보드의 다시 시작 단추가 이 길을 쓴다.
//
// 감시를 겹쳐 쓰는 경우(pm2 · systemd · 도커)를 위해 지킬 것:
//   - 다시 띄우는 것은 다시 시작 코드일 때만. 다른 코드로 끝나면 실행기도 같은 코드로 끝난다(크래시 · 기동 실패는 바깥 감시가 정한 대로 다룬다)
//   - 받은 종료 신호는 봇에 넘기고 봇이 끝날 때까지 기다린다(봇이 세션을 저장한다). 그 뒤에는 다시 시작 코드여도 다시 띄우지 않는다
//   - 봇이 완전히 끝난 뒤에(exit) 다시 띄운다. DB 파일 · 4416 포트를 앞 프로세스가 쥔 채 겹치지 않게
// Windows 는 신호를 넘기지 않는다. 콘솔의 Ctrl+C 는 같은 콘솔의 봇에도 바로 가고, Windows 의 kill 은 신호가 아니라 강제 종료라 세션을 저장하지 못한다.

import os from "node:os";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EXIT, LAUNCHER_ENV } from "./exit-codes.ts";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** 바깥 경계. 시험은 가짜를 넘긴다 */
type LauncherDeps = {
  spawn(command: string, args: string[], options: SpawnOptions): Pick<ChildProcess, "on" | "kill">;
  proc: Pick<NodeJS.Process, "on" | "platform" | "execPath" | "execArgv" | "env">;
  exit(code: number): void;
  /** 실행기 자신의 알림(봇 로그 모듈은 쓰지 않는다. 봇과 같은 터미널에 한 줄) */
  say(line: string): void;
};

/** 끝난 자식의 종료 코드. 신호로 끝났으면 셸 관례대로 128 + 번호 */
function codeOf(code: number | null, signal: NodeJS.Signals | null) {
  if (code !== null) return code;
  return signal ? 128 + (os.constants.signals[signal] ?? 0) : 1;
}

/** entry: 봇의 진입 파일 */
function launch(entry: string, { spawn, proc, exit, say }: LauncherDeps) {
  let child: Pick<ChildProcess, "on" | "kill"> | null = null;
  let stopping = false;

  const run = () => {
    child = spawn(proc.execPath, [...proc.execArgv, entry], { stdio: "inherit", env: { ...proc.env, [LAUNCHER_ENV]: "1" } });
    child.on("error", (error: Error) => {
      say(`[실행기] 봇을 띄우지 못했습니다: ${error.message}`);
      exit(1);
    });
    child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      child = null;
      if (code === EXIT.restart && !stopping) {
        say("[실행기] 봇을 다시 띄웁니다");
        run();
        return;
      }
      exit(codeOf(code, signal));
    });
  };

  for (const signal of SIGNALS) {
    proc.on(signal, () => {
      stopping = true;
      if (child && proc.platform !== "win32") child.kill(signal);
    });
  }
  run();
}

export { launch };
export type { LauncherDeps };
