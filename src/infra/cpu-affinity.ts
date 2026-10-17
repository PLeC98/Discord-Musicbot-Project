// 무거운 일(로그인 배경 굽기)이 쓸 코어. 논리 코어의 80% 로 묶고 최소 2개는 비운다(2026-10-15 사용자): 코어를 다 쓰면 이벤트 루프 지연이 튀어 소리가 잠깐 빈다.
// 우선순위는 그대로 둔다(보통 아래로 내리면 데스크톱에서 4 ~ 5배 느려졌다). 묶는 것은 위쪽 코어(아래쪽을 봇에게 남긴다).
// 리눅스는 taskset 으로 띄우고(있을 때), Windows 는 띄운 뒤 PowerShell 로 affinity 를 건다. 그 밖(macOS)은 묶지 않는다

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

/** 쓸 코어 수와 첫 코어(위쪽부터 쓴다) */
function encodeCores(): { first: number; count: number; total: number } {
  const total = os.cpus().length;
  const count = Math.max(1, Math.min(total - 2, Math.floor(total * 0.8)));
  return { first: total - count, count, total };
}

const TASKSET = ["/usr/bin/taskset", "/bin/taskset"].find((file) => fs.existsSync(file)) ?? null;

/** 띄울 명령을 묶어서 띄우는 꼴로(리눅스 taskset). 묶을 수 없으면 그대로 */
function bindCommand(file: string, args: string[]): { file: string; args: string[] } {
  if (process.platform !== "linux" || !TASKSET) return { file, args };
  const { first, total } = encodeCores();
  return { file: TASKSET, args: ["-c", `${first}-${total - 1}`, file, ...args] };
}

/** 띄운 프로세스를 묶는다(Windows). 실패해도 일은 그대로 돈다(묶이지 않을 뿐) */
function bindProcess(pid: number | undefined) {
  if (process.platform !== "win32" || !pid) return;
  const { first, count } = encodeCores();
  const mask = ((2n ** BigInt(count) - 1n) << BigInt(first)).toString();
  execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid}).ProcessorAffinity = [IntPtr]${mask}`], { windowsHide: true, timeout: 15_000 }, (error) => {
    // 묶지 못해도 굽기는 그대로 돈다(코어를 다 쓸 뿐)
    void error;
  });
}

/** 묶는 코어 수(묶지 못하는 기기면 null: macOS · taskset 이 없는 리눅스) */
const boundCores = () => (process.platform === "win32" || (process.platform === "linux" && TASKSET) ? encodeCores().count : null);

export { encodeCores, bindCommand, bindProcess, boundCores };
