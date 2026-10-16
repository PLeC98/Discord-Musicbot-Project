// 로그인 배경의 메모리 관문: 크기 어림(약 1.4GB)과 굽기(4K AV1 하나 7 ~ 8GB, 나눠 굽기 9.5 ~ 9.9GB, research §11.7)가 16GB 서버에서 함께 돌 수 있어,
// 무거운 ffmpeg 를 띄우기 전에 남은 메모리가 그만큼 될 때까지 기다린다(5초마다 본다). 30분을 기다려도 모자라면 그대로 띄운다(기기 메모리가 원래 작다)

import os from "node:os";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });

/** 일의 대략의 최대 메모리(바이트) */
const NEEDS = { probe: 1.5 * 1024 ** 3, fhd: 3 * 1024 ** 3, uhd: 8.5 * 1024 ** 3, split: 11 * 1024 ** 3 };
const POLL_MS = 5_000;
const WAIT_MAX_MS = 30 * 60_000;

/** 남은 메모리가 bytes 이상이 될 때까지 기다린다. 멈추면(signal) 바로 끝난다 */
async function enoughMemory(bytes: number, what: string, signal: AbortSignal): Promise<void> {
  const started = Date.now();
  let told = false;
  while (os.freemem() < bytes && !signal.aborted && Date.now() - started < WAIT_MAX_MS) {
    if (!told) log.info({ sub: "admin" }, `로그인 배경 ${what}: 남은 메모리가 모자라 기다립니다(${(os.freemem() / 1024 ** 3).toFixed(1)}GB / ${(bytes / 1024 ** 3).toFixed(1)}GB)`);
    told = true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export { NEEDS, enoughMemory };
