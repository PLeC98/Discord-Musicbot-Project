// 운영자 패널의 경로(/api/admin 아래)를 붙이는 표. createApp 이 이 차례로 붙이고(긴 주소가 먼저, adminRouter 가 마지막), 시험이 모든 경로를 훑는다.
// 라우터마다 맨 위에서 requireOwner 를 지나고(어디에 붙든 지킨다), 앱은 /api/admin 앞에서 한 번 더 본다(검사 없이 더한 라우터를 잡는다)

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
  ["/api/admin", adminRouter],
];

export { ADMIN_MOUNTS };
