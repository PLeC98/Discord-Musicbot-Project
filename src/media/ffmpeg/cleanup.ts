// vendor/ffmpeg 정리. 규칙은 infra/version-folders와 같고, 버전 폴더 이름(<릴리스>-<받은 시각>)과 기록(media/ffmpeg/state)만 넘긴다.
// 봇이 기동 시 맞추기 뒤에(경로를 정하기 전) 부르고, 업데이트 탭의 외부 프로그램 이전 버전 카드가 이전 설치본까지 삭제하도록 부른다

import { readState, writeState, type FfmpegState } from "./state.ts";
import { cleanupVersions, previewVersionsCleanup, type CleanupOptions, type VersionStore } from "../../infra/version-folders.ts";

const STORE: VersionStore<FfmpegState> = {
  read: readState,
  write: writeState,
  versionFolder: /^autobuild-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d+$/,
  release: (name) => name.replace(/-\d+$/, ""),
};

const cleanupFfmpeg = (dir: string, options: CleanupOptions = {}) => cleanupVersions(dir, STORE, options);
const previewFfmpegCleanup = (dir: string, options: CleanupOptions = {}) => previewVersionsCleanup(dir, STORE, options);

export { cleanupFfmpeg, previewFfmpegCleanup };
export type { CleanupOptions, CleanupPreview, CleanupResult, KeptReason } from "../../infra/version-folders.ts";
