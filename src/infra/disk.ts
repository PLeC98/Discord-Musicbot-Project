// 경로가 놓인 드라이브의 크기와 쓴 양, 남은 크기. 봇 상태 탭의 저장공간이 캐시 폴더, DB 파일의 드라이브를, 로그인 배경이 저장 위치를 본다.
// 드라이브 이름은 Windows 면 드라이브 문자("F:"), 그 밖은 마운트 지점(위 폴더로 올라가며 dev 가 바뀌기 직전). 이름이 같으면 같은 드라이브다

import fs from "node:fs";
import path from "node:path";
import logger from "./log/logger.ts";
import { messageOf } from "./error-text.ts";
import { repeatingFailure } from "./repeating-failure.ts";
const log = logger.child({ category: "core" });

const failureLog = { error: (line: string) => log.warn(line), info: (line: string) => log.info(line) };
const driveFailures = new Map<string, ReturnType<typeof repeatingFailure>>();
const freeFailures = new Map<string, ReturnType<typeof repeatingFailure>>();

function failuresOf(byTarget: Map<string, ReturnType<typeof repeatingFailure>>, target: string, what: string) {
  let failures = byTarget.get(target);
  if (!failures) byTarget.set(target, (failures = repeatingFailure(failureLog, what)));
  return failures;
}
const driveFailure = (target: string) => failuresOf(driveFailures, target, `${target} 디스크 용량 statfs 조회`);
const freeFailure = (target: string) => failuresOf(freeFailures, target, `${target} 디스크 여유 공간 statfs 조회`);

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
    const drive = { drive: driveName(target), usedBytes: totalBytes - stat.bfree * stat.bsize, totalBytes };
    driveFailure(target).ok();
    return drive;
  } catch (error) {
    driveFailure(target).fail(`${messageOf(error)} (드라이브 카드에 알 수 없음으로 표시)`);
    return null;
  }
}

/** 디스크를 꽉 채우지 않게 남겨 둘 크기(설정 DB, 로그가 쓸 공간). 큰 파일을 다운로드하거나 인코딩할 때 이만큼은 남긴다 */
const KEEP_FREE_BYTES = 256 * 1024 * 1024;

/** 이 사용자가 쓸 수 있는 남은 크기(바이트). 읽지 못하면 null */
function freeBytesOf(target: string): number | null {
  try {
    const stat = fs.statfsSync(target);
    freeFailure(target).ok();
    return stat.bavail * stat.bsize;
  } catch (error) {
    freeFailure(target).fail(`${messageOf(error)} (여유 공간 0바이트로 처리)`);
    return null;
  }
}

/** 그 위치에 더 써도 되는 크기: 남은 크기에서 남겨 둘 몫을 뺀 것(못 읽으면 0) */
const roomIn = (target: string) => Math.max(0, (freeBytesOf(target) ?? 0) - KEEP_FREE_BYTES);

export { driveOf, freeBytesOf, roomIn, KEEP_FREE_BYTES };
