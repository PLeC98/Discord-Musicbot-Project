// 무거운 작업(로그인 배경 인코딩)의 CPU 선호도. 논리 코어의 80% 만 쓰게 하고 최소 2개는 비운다: 코어를 다 쓰면 이벤트 루프 지연이 튀어 소리가 잠깐 빈다.
// 우선순위는 그대로 둔다(보통보다 낮추면 데스크톱에서 크게 느려진다). CPU 선호도는 위쪽 코어로 설정한다(아래쪽을 봇에게 남긴다).
// 리눅스는 taskset 이 있으면 taskset 으로 실행하고, Windows 는 실행한 뒤 PowerShell 로 CPU 선호도를 설정한다. 그 밖(macOS)은 설정하지 않는다

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import logger from "./log/logger.ts";
import { consoleText } from "./console-text.ts";
const log = logger.child({ category: "proc" });

/** 쓸 코어 수와 첫 코어(위쪽부터 쓴다) */
function encodeCores(): { first: number; count: number; total: number } {
  const total = os.cpus().length;
  const count = Math.max(1, Math.min(total - 2, Math.floor(total * 0.8)));
  return { first: total - count, count, total };
}

const TASKSET = ["/usr/bin/taskset", "/bin/taskset"].find((file) => fs.existsSync(file)) ?? null;

/** CPU 선호도를 지정해 실행하는 명령으로 바꾼다(리눅스 taskset). 지정할 수 없으면 그대로 둔다 */
function bindCommand(file: string, args: string[]): { file: string; args: string[] } {
  if (process.platform !== "linux" || !TASKSET) return { file, args };
  const { first, total } = encodeCores();
  return { file: TASKSET, args: ["-c", `${first}-${total - 1}`, file, ...args] };
}

// 프로세스가 아직 살아 있는지 확인한다(신호 0은 실제 신호를 보내지 않고 프로세스가 있는지만 본다. 권한이 없어 거절되면 살아 있다)
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === "EPERM";
  }
}

/** 실행한 프로세스의 CPU 선호도를 설정한다(Windows). 실패해도 작업은 그대로 돈다(코어를 다 쓸 뿐) */
function bindProcess(pid: number | undefined) {
  if (process.platform !== "win32" || !pid) return;
  const { first, count } = encodeCores();
  const mask = ((2n ** BigInt(count) - 1n) << BigInt(first)).toString();
  execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid}).ProcessorAffinity = [IntPtr]${mask}`], { encoding: "buffer", windowsHide: true, timeout: 15_000 }, (error, _stdout, stderr) => {
    // PowerShell 이 붙기 전에 끝난 짧은 작업은 CPU 선호도를 설정할 프로세스가 없어 debug 로 남긴다
    if (error) log[alive(pid) ? "warn" : "debug"](`CPU 선호도 설정 실패(pid ${pid}): ${consoleText(stderr).trim() || error.message}`);
  });
}

/** CPU 선호도로 지정한 코어 수(설정하지 못하는 환경이면 null: macOS, taskset 이 없는 리눅스) */
const boundCores = () => (process.platform === "win32" || (process.platform === "linux" && TASKSET) ? encodeCores().count : null);

export { encodeCores, bindCommand, bindProcess, boundCores };
