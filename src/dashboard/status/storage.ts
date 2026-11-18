// 봇 상태 탭의 저장공간: 오디오 캐시, 캐시 드라이브, DB, 외부 프로그램 폴더. 행 수를 세고 드라이브를 읽으므로 15초 구간마다 모아 둔다.
// 외부 프로그램 폴더는 파일이 많아(bgutil의 node_modules) 10분마다 백그라운드에서 센다

import fs from "node:fs";
import * as audioCache from "../../store/audio-cache.ts";
import { dbStats } from "../../store/stores.ts";
import { driveOf } from "../../infra/disk.ts";
import { onWindow } from "../../infra/vitals.ts";
import { treeSize } from "../../infra/folder-guard.ts";
import { PROJECT } from "../../infra/project-paths.ts";
import type { StorageView } from "../contract/admin.ts";

const UNKNOWN_DRIVE = { drive: "?", usedBytes: 0, totalBytes: 0 };

const VENDOR_EVERY_MS = 10 * 60_000;
let vendorBytes: number | null = null;
let vendorAt = 0;
let vendorCounting = false;

/** 외부 프로그램 폴더 크기를 백그라운드에서 다시 센다(10분이 지났거나 force). 세는 중이면 겹치지 않는다 */
function countVendor(force = false) {
  if (vendorCounting || (!force && Date.now() - vendorAt < VENDOR_EVERY_MS)) return;
  vendorCounting = true;
  vendorAt = Date.now();
  void treeSize(PROJECT.vendor)
    .then((bytes) => {
      vendorBytes = bytes;
    })
    .finally(() => {
      vendorCounting = false;
    });
}

function measure(): StorageView {
  const { cache, drive, minFreeBytes } = audioCache.storageStats();
  const { dir, bytes, lookups, pins, sponsorSegments, sessions } = dbStats();
  countVendor();
  return {
    cache,
    disk: { ...(drive ?? UNKNOWN_DRIVE), minFreeBytes },
    db: { bytes, drive: driveOf(dir)?.drive ?? "?", lookups, pins, sponsorSegments, sessions },
    // 아직 아무것도 받지 않았으면 폴더가 없다(조회 실패로 경고하지 않는다)
    vendor: fs.existsSync(PROJECT.vendor) ? { bytes: vendorBytes, drive: driveOf(PROJECT.vendor)?.drive ?? "?" } : { bytes: 0, drive: "?" },
  };
}

let last: StorageView | null = null;

/** 구간마다 잰다. 끊는 함수를 돌려준다 */
function watchStorage() {
  return onWindow(() => {
    last = measure();
  });
}

/** 모아 둔 값. 아직 없으면 지금 잰다 */
function storageView(): StorageView {
  return (last ??= measure());
}

/** 외부 프로그램 폴더를 바꾼 뒤(이전 버전 삭제) 다음 구간을 기다리지 않고 다시 센다 */
const recountVendor = () => countVendor(true);

export { watchStorage, storageView, recountVendor };
