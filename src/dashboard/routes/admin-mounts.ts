// 운영자 패널의 경로(/api/admin 하위)를 등록하는 목록이다. createApp이 이 순서로 마운트하고(긴 경로가 먼저, adminRouter가 마지막), 테스트에서 모든 경로를 검사한다.
// 라우터마다 맨 위에서 requireOwner를 거치고(어디에 붙이든 지킨다), 앱은 /api/admin 앞에서 한 번 더 검사한다(검사 없이 추가된 라우터를 막는다)

import type { Router } from "express";
import { adminRouter } from "./admin.ts";
import { aiLogRouter } from "./ai-log.ts";
import { appearanceRouter } from "./appearance.ts";
import { logFilesRouter } from "./log-files.ts";
import { loginBackgroundRouter } from "./login-background.ts";
import { resetRouter } from "./reset.ts";
import { serviceKeysRouter } from "./service-keys.ts";
import { settingsArchiveRouter } from "./settings-archive.ts";
import { snapshotsRouter } from "./snapshots.ts";
import { trackCacheRouter } from "./track-cache.ts";
import { tunablesRouter } from "./tunables.ts";
import { uploadsRouter } from "./uploads.ts";

/** [붙이는 주소, 라우터]. 앞의 것이 먼저 붙는다 */
const ADMIN_MOUNTS: ReadonlyArray<readonly [string, Router]> = [
  ["/api/admin/appearance/login-background", loginBackgroundRouter],
  ["/api/admin/appearance", appearanceRouter],
  ["/api/admin/service-keys", serviceKeysRouter],
  ["/api/admin/tunables", tunablesRouter],
  ["/api/admin/settings-archive", settingsArchiveRouter],
  ["/api/admin/snapshots", snapshotsRouter],
  ["/api/admin/track-cache", trackCacheRouter],
  ["/api/admin/reset", resetRouter],
  ["/api/admin/ai", aiLogRouter],
  ["/api/admin/logs", logFilesRouter],
  ["/api/admin/uploads", uploadsRouter],
  ["/api/admin", adminRouter],
];

export { ADMIN_MOUNTS };
