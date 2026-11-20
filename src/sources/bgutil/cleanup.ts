// vendor/bgutil 정리. 규칙은 infra/version-folders와 같고, 버전 폴더 이름(<태그>-<받은 시각>)과 기록(sources/bgutil/state)만 넘긴다.
// 봇이 기동 시 부른다(돌고 있는 POToken 서버의 빌드는 inUse로 넘겨 남긴다)

import { readState, writeState, VERSION_FOLDER, type BgutilState } from "./state.ts";
import { cleanupVersions, previewVersionsCleanup, type CleanupOptions, type VersionStore } from "../../infra/version-folders.ts";

const STORE: VersionStore<BgutilState> = { read: readState, write: writeState, versionFolder: VERSION_FOLDER, release: (name) => name.replace(/-\d+$/, "") };

const cleanupBgutil = (dir: string, options: CleanupOptions = {}) => cleanupVersions(dir, STORE, options);
const previewBgutilCleanup = (dir: string, options: CleanupOptions = {}) => previewVersionsCleanup(dir, STORE, options);

export { cleanupBgutil, previewBgutilCleanup };
