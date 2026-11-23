import type { CorsOptions } from "cors";
import logger from "../infra/log/logger.ts";
import { BOOT_HEADER } from "./contract/boot.ts";
import { L } from "../infra/log/text.ts";
import { logTextError } from "../infra/log/log-text.ts";
const log = logger.child({ category: "dashboard" });

const DEV_ORIGIN = "http://localhost:5173";
let warnedDevOrigin = false;

function normalizeDashboardOrigin(value: string) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw logTextError(L.dashboard.dashboardUrlNotHttp());
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw logTextError(L.dashboard.dashboardUrlNotOrigin());
  }
  return parsed.origin;
}

/**
 * 허용 출처는 대시보드 주소 하나뿐이다.
 *
 * Vite 개발 서버(5173)는 `pnpm run dev`로 실행했을 때만 허용
 */
function createCorsOptions(dashboardUrl: string, { allowDevOrigin = false }: { allowDevOrigin?: boolean } = {}) {
  const allowedOrigins = new Set([normalizeDashboardOrigin(dashboardUrl)]);
  if (allowDevOrigin) allowedOrigins.add(DEV_ORIGIN);

  return {
    credentials: true,
    // 개발 서버(다른 출처)의 화면도 기동 표시를 읽게
    exposedHeaders: [BOOT_HEADER],
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      if (!origin) return callback(null, true);
      let normalized;
      try {
        normalized = new URL(origin).origin;
      } catch {
        // Origin이 주소가 아니면 허용된 출처가 아니다. 차단은 브라우저가 한다
        return callback(null, false);
      }

      const allowed = allowedOrigins.has(normalized) && normalized === origin.replace(/\/$/, "");
      // 개발 서버가 막혔을 때 브라우저 콘솔만 보면 원인을 알기 어렵다. 켜는 방법을 한 번 알려 준다.
      if (!allowed && normalized === DEV_ORIGIN && !warnedDevOrigin) {
        warnedDevOrigin = true;
        log.warn(L.dashboard.devOriginBlocked());
      }
      return callback(null, allowed);
    },
  } satisfies CorsOptions;
}

export { createCorsOptions, normalizeDashboardOrigin };
