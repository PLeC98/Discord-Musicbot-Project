// 봇 상태 탭의 저장공간: 오디오 캐시 · 캐시 드라이브 · DB. 줄 수를 세고 드라이브를 읽으므로 15초 칸마다 모아 둔다

import * as audioCache from "../../store/audio-cache.ts";
import { dbStats } from "../../store/stores.ts";
import { driveOf } from "../../infra/disk.ts";
import { onWindow } from "../../infra/vitals.ts";
import type { StorageView } from "../contract/admin.ts";

const UNKNOWN_DRIVE = { drive: "?", usedBytes: 0, totalBytes: 0 };

function measure(): StorageView {
  const { cache, drive, minFreeBytes } = audioCache.storageStats();
  const { dir, bytes, lookups, sponsorSegments, sessions } = dbStats();
  return { cache, disk: { ...(drive ?? UNKNOWN_DRIVE), minFreeBytes }, db: { bytes, drive: driveOf(dir)?.drive ?? "?", lookups, sponsorSegments, sessions } };
}

let last: StorageView | null = null;

/** 칸마다 잰다. 끊는 함수를 돌려준다 */
function watchStorage() {
  return onWindow(() => {
    last = measure();
  });
}

/** 모아 둔 값. 아직 없으면 지금 잰다 */
function storageView(): StorageView {
  return (last ??= measure());
}

export { watchStorage, storageView };
