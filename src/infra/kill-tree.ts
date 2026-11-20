// 프로세스와 하위 프로세스를 강제 종료한다. Windows는 taskkill /T, POSIX는 detached로 실행한 프로세스 그룹(-pid)에 SIGKILL.
// 로거를 불러오지 않는다: 설치 스크립트도 이 모듈을 쓰는데, 로거를 불러오면 console.*를 가로챈다. 실패는 호출부에 넘겨 호출부가 로그로 남긴다.
// 이미 끝난 자식의 PID는 다른 프로세스가 다시 쓰고 있을 수 있어, 살아 있는지는 호출부가 걸러서 넘긴다

import { spawnSync } from "node:child_process";
import { codeOf } from "./error-text.ts";

const IS_WIN = process.platform === "win32";
// taskkill 한 번에 넘기는 PID 수(명령줄 길이 한도 안). 하나씩 실행하면 동시 재생이 많을 때 종료가 수십 초 걸린다
const TASKKILL_BATCH = 100;

/** group: POSIX에서 detached로 실행해 자기 프로세스 그룹이 있다 */
type Target = { pid: number; group: boolean };
/** 종료 실패의 원인. Windows는 taskkill을 배치 단위로 실행해 같은 배치의 pid 모두에 같은 원인이 온다 */
type KillFailure = { pids: number[]; error?: unknown; status?: number | null; stderr?: Buffer };

/** targets와 하위 프로세스를 강제 종료하고, 종료하지 못한 pid를 반환한다. pid는 1보다 큰 정수여야 한다(0은 -0이 되어 자기 그룹을 끝낸다) */
function killTrees(targets: Target[], onFailure?: (failure: KillFailure) => void): Set<number> {
  const failed = new Set<number>();
  const live = targets.filter(({ pid }) => Number.isInteger(pid) && pid > 1);
  if (!IS_WIN) {
    for (const target of live) {
      const error = killPosix(target);
      if (error) {
        failed.add(target.pid);
        onFailure?.({ pids: [target.pid], error });
      }
    }
    return failed;
  }
  for (let i = 0; i < live.length; i += TASKKILL_BATCH) {
    const batch = live.slice(i, i + TASKKILL_BATCH).map(({ pid }) => pid);
    // /T = 하위 프로세스 포함, /F = 강제. 종료 코드 128: 그사이 이미 끝난 것이 있다(나머지는 종료된다)
    const { error, status, stderr } = spawnSync("taskkill", [...batch.flatMap((pid) => ["/PID", String(pid)]), "/T", "/F"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    if (error || (status !== 0 && status !== 128)) {
      // 배치의 어느 것이 실패했는지 알 수 없어 배치 전체를 실패로 본다
      for (const pid of batch) failed.add(pid);
      onFailure?.({ pids: batch, error, status, stderr });
    }
  }
  return failed;
}

/** 종료했거나 이미 없으면 undefined, 아니면 그 오류 */
function killPosix({ pid, group }: Target): unknown {
  try {
    process.kill(group ? -pid : pid, "SIGKILL");
    return undefined;
  } catch {
    // ESRCH(이미 종료) 또는 그룹이 없는 경우. pid 하나로 다시 시도한다
    try {
      process.kill(pid, "SIGKILL");
      return undefined;
    } catch (error) {
      return codeOf(error) === "ESRCH" ? undefined : error;
    }
  }
}

export { killTrees };
export type { Target, KillFailure };
