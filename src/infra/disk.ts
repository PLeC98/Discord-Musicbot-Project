// 경로가 놓인 드라이브의 크기와 쓴 양 · 남은 크기. 봇 상태 탭의 저장공간이 캐시 폴더 · DB 파일의 드라이브를, 로그인 배경이 저장 자리를 본다.
// 드라이브 이름은 Windows 면 드라이브 문자("F:"), 그 밖은 마운트 지점(위 폴더로 올라가며 dev 가 바뀌기 직전). 이름이 같으면 같은 드라이브다

import fs from "node:fs";
import path from "node:path";

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
  } catch {
    return null;
  }
}

/** 이 사용자가 쓸 수 있는 남은 크기(바이트). 읽지 못하면 null */
function freeBytesOf(target: string): number | null {
  try {
    const stat = fs.statfsSync(target);
    return stat.bavail * stat.bsize;
  } catch {
    return null;
  }
}

export { driveOf, freeBytesOf };
