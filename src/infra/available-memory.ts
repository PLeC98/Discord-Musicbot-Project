// 지금 쓸 수 있는 메모리(바이트). Linux, Windows 는 os.freemem() 이 이미 쓸 수 있는 양이다(MemAvailable, 사용 가능한 물리 메모리).
// macOS 의 os.freemem() 은 비어 있는 페이지만 세어 캐시로 쥔 페이지(inactive)가 빠져 실제보다 훨씬 작다(러너에서 7GB 중 1.2GB).
// macOS 는 vm_stat 의 free + inactive 로 잰다(psutil 의 available 과 같다. purgeable 은 다른 항목과 겹쳐 더하지 않는다)

import os from "node:os";
import { spawnSync } from "node:child_process";

/** 다시 재기 전에 앞의 값을 쓰는 시간(ms). 메모리를 기다리는 곳이 5초마다 묻는다 */
const CACHE_MS = 2_000;

/** vm_stat 의 출력 → free + inactive 바이트. 모양이 다르면 null */
function parseVmStat(text: string): number | null {
  const page = /page size of (\d+) bytes/.exec(text)?.[1];
  const free = /^Pages free:\s+(\d+)\.?$/m.exec(text)?.[1];
  const inactive = /^Pages inactive:\s+(\d+)\.?$/m.exec(text)?.[1];
  if (!page || !free || !inactive) return null;
  return (Number(free) + Number(inactive)) * Number(page);
}

/** macOS 에서 vm_stat 을 실행해 잰다. 실패하면 null(부르는 쪽이 os.freemem 으로 물러선다) */
function vmStatNow(): number | null {
  const ran = spawnSync("vm_stat", { encoding: "utf8", timeout: 2_000, windowsHide: true });
  return ran.status === 0 ? parseVmStat(ran.stdout) : null;
}

let cached: { at: number; bytes: number } | null = null;

/** 지금 쓸 수 있는 메모리(바이트). platform, measure, now 는 테스트가 바꾼다 */
function availableMemory({ platform = process.platform, measure = vmStatNow, now = Date.now() }: { platform?: NodeJS.Platform; measure?: () => number | null; now?: number } = {}): number {
  if (platform !== "darwin") return os.freemem();
  if (cached && now - cached.at < CACHE_MS) return cached.bytes;
  const bytes = measure() ?? os.freemem();
  cached = { at: now, bytes };
  return bytes;
}

/** 테스트가 앞의 값을 비운다 */
function _resetCache() {
  cached = null;
}

export { availableMemory, parseVmStat, _resetCache };
