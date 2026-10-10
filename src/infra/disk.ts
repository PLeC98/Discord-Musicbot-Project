// 경로가 놓인 드라이브의 크기와 쓴 양. 봇 상태 탭의 저장공간이 캐시 폴더 · DB 파일의 드라이브를 본다

import fs from "node:fs";
import path from "node:path";

/** drive: Windows 는 "F:", 그 밖은 "/"(마운트 지점이 아니라 뿌리). 읽지 못하면 null */
function driveOf(target: string): { drive: string; usedBytes: number; totalBytes: number } | null {
  try {
    const stat = fs.statfsSync(target);
    const totalBytes = stat.blocks * stat.bsize;
    const root = path.parse(path.resolve(target)).root;
    return { drive: root.length > 1 ? root.replace(/[\\/]+$/, "") : root, usedBytes: totalBytes - stat.bfree * stat.bsize, totalBytes };
  } catch {
    return null;
  }
}

export { driveOf };
