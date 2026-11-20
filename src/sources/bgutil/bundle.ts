// 봇이 쓰는 bgutil 빌드 하나. 기동 시 기록(vendor/bgutil/state.json)의 active를 한 번 읽어 묶음으로 두고,
// POToken 서버(서버 폴더, 버전), yt-dlp 옵션(플러그인 폴더), 상태(버전)가 같이 쓴다. 서버와 플러그인이 다른 설치에서 짝지어지지 않는다.
// 기록이 그 뒤에 바뀌어도(터미널의 install:bgutil) 다시 시작할 때까지 처음 읽은 것을 쓴다

import fs from "node:fs";
import path from "node:path";
import logger from "../../infra/log/logger.ts";
import { PROJECT } from "../../infra/project-paths.ts";
import { readState, VERSION_FOLDER } from "./state.ts";
import { ENTRY } from "./launch.ts";
const log = logger.child({ category: "core", sub: "bgutil" });

/** root: 버전 폴더(저장소 체크아웃. yt-dlp의 --plugin-dirs가 받는 곳), serverDir: 그 안의 server, entry: 서버 실행 파일, version: 서버 버전 */
type BgutilBundle = { folder: string; root: string; serverDir: string; entry: string; tag: string; commit: string; version: string };

/** 기록의 active를 읽는다. 설치돼 있지 않거나(기록 없음, 실행 파일 없음) 기록을 읽지 못하면 null */
function readBundle(dir: string): BgutilBundle | null {
  const read = readState(dir);
  if (read.kind === "broken") {
    log.warn(`bgutil 기록(${path.join(dir, "state.json")}) 읽기 실패(${read.error}): 설치되지 않은 것으로 봄. pnpm run install:bgutil로 다시 설치하세요`);
    return null;
  }
  const active = read.kind === "ok" ? read.state.active : null;
  if (!active || !VERSION_FOLDER.test(active.folder)) return null;
  const root = path.join(dir, active.folder);
  const serverDir = path.join(root, "server");
  const entry = path.join(serverDir, ENTRY);
  if (!fs.existsSync(entry)) {
    log.warn(`bgutil 기록이 가리키는 빌드(${active.folder})에 서버 실행 파일이 없음: 설치되지 않은 것으로 봄. pnpm run install:bgutil로 다시 설치하세요`);
    return null;
  }
  return { folder: active.folder, root, serverDir, entry, tag: active.tag, commit: active.commit, version: active.version };
}

let cached: BgutilBundle | null | undefined;

/** 기동 시 처음 부를 때 읽고 그 뒤로는 같은 것을 준다 */
function bgutilBundle(): BgutilBundle | null {
  if (cached === undefined) cached = readBundle(PROJECT.bgutil);
  return cached;
}

/** 테스트용. 다음 호출이 다시 읽는다 */
function _resetBundle() {
  cached = undefined;
}

export { bgutilBundle, readBundle, _resetBundle };
export type { BgutilBundle };
