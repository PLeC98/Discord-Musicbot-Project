// vendor/ffmpeg 정리. 봇이 기동 때 맞추기 뒤에 한 번 부른다(설치 스크립트는 정리하지 않는다: 켜진 봇이 쓰는 폴더일 수 있다).
// 지우는 것: 기록이 가리키지 않는 버전 폴더(<릴리스>-<받은 시각>), 만든 프로세스가 끝난 다운로드 임시 폴더(.staging-<pid>-<시각>).
// 그 밖(state.json, 옮겨 둔 깨진 기록, 모르는 이름)은 건드리지 않는다. 기록을 읽지 못하면 아무것도 지우지 않는다

import fs from "node:fs";
import path from "node:path";
import { readState, withLock } from "./state.ts";

const VERSION_FOLDER = /^autobuild-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d+$/;
const STAGING = /^\.staging-(\d+)-\d+$/;

/** 살아 있는 프로세스면 true. ESRCH만 없는 것으로 본다(권한이 없어 확인하지 못하면 살아 있는 것으로 본다) */
function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** 지운 폴더 이름을 반환한다. 다른 프로세스가 폴더를 쥐고 있으면(받는 중) 건너뛰고 null */
async function cleanupFfmpeg(dir: string, alive: (pid: number) => boolean = isAlive): Promise<string[] | null> {
  if (!fs.existsSync(dir)) return [];
  const held = await withLock(
    dir,
    () => {
      const read = readState(dir);
      if (read.kind === "broken") return [];
      const keep = new Set(read.kind === "ok" ? [read.state.active?.folder, read.state.previous?.folder].filter(Boolean) : []);
      const removed: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const staging = STAGING.exec(entry.name);
        const remove = (VERSION_FOLDER.test(entry.name) && !keep.has(entry.name)) || (staging && !alive(Number(staging[1])));
        if (!remove) continue;
        fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true, maxRetries: 2 });
        removed.push(entry.name);
      }
      return removed;
    },
    5000,
  );
  return held.ok ? held.value : null;
}

export { cleanupFfmpeg };
