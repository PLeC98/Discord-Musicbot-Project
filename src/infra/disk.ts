// 경로가 놓인 드라이브의 크기와 쓴 양 · 남은 크기. 봇 상태 탭의 저장공간이 캐시 폴더 · DB 파일의 드라이브를, 로그인 배경이 저장 위치를 본다.
// 드라이브 이름은 Windows 면 드라이브 문자("F:"), 그 밖은 마운트 지점(위 폴더로 올라가며 dev 가 바뀌기 직전). 이름이 같으면 같은 드라이브다

import fs from "node:fs";
import path from "node:path";
import logger from "./log/logger.ts";
import { messageOf } from "./error-text.ts";
const log = logger.child({ category: "core" });

/** 마운트 지점: target 과 dev 가 같은 가장 위 폴더 */
function mountPoint(target: string) {
  let at = path.resolve(target);
  const dev = fs.statSync(at).dev;
  for (;;) {
    const up = path.dirname(at);
    if (up === at || fs.statSync(up).dev !== dev) return at;
    at = up;
  }
}

function driveName(target: string) {
  if (process.platform === "win32") return path.parse(path.resolve(target)).root.replace(/[\\/]+$/, "");
  return mountPoint(target);
}

/** 읽지 못하면 null */
function driveOf(target: string): { drive: string; usedBytes: number; totalBytes: number } | null {
  try {
    const stat = fs.statfsSync(target);
    const totalBytes = stat.blocks * stat.bsize;
    return { drive: driveName(target), usedBytes: totalBytes - stat.bfree * stat.bsize, totalBytes };
  } catch (error) {
    log.debug(`드라이브 크기 읽기 실패(${target}): ${messageOf(error)}`);
    return null;
  }
}

/** 디스크를 꽉 채우지 않게 남겨 둘 크기(설정 DB · 로그가 쓸 공간). 큰 파일을 다운로드하거나 구울 때 이만큼은 남긴다 */
const KEEP_FREE_BYTES = 256 * 1024 * 1024;

/** 이 사용자가 쓸 수 있는 남은 크기(바이트). 읽지 못하면 null */
function freeBytesOf(target: string): number | null {
  try {
    const stat = fs.statfsSync(target);
    return stat.bavail * stat.bsize;
  } catch (error) {
    log.debug(`남은 크기 읽기 실패(${target}): ${messageOf(error)}`);
    return null;
  }
}

/** 그 위치에 더 써도 되는 크기: 남은 크기에서 남겨 둘 몫을 뺀 것(못 읽으면 0) */
const roomIn = (target: string) => Math.max(0, (freeBytesOf(target) ?? 0) - KEEP_FREE_BYTES);

export { driveOf, freeBytesOf, roomIn, KEEP_FREE_BYTES };
