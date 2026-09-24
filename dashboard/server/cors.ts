// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
import logger from "../../src/infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });

const DEV_ORIGIN = "http://localhost:5173";
let warnedDevOrigin = false;

function normalizeDashboardOrigin(value) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("DASHBOARD_URL must use http or https");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("DASHBOARD_URL must be a plain origin");
  }
  return parsed.origin;
}

/**
 * 허용 출처는 대시보드 주소 하나뿐이다.
 *
 * Vite 개발 서버(5173)는 `pnpm run dev`로 띄웠을 때만 허용
 */
function createCorsOptions(dashboardUrl, { allowDevOrigin = false } = {}) {
  const allowedOrigins = new Set([normalizeDashboardOrigin(dashboardUrl)]);
  if (allowDevOrigin) allowedOrigins.add(DEV_ORIGIN);

  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      let normalized;
      try {
        normalized = new URL(origin).origin;
      } catch {
        return callback(null, false);
      }

      const allowed = allowedOrigins.has(normalized) && normalized === origin.replace(/\/$/, "");
      // 개발 서버가 막혔을 때 브라우저 콘솔만 보면 원인을 알기 어렵다. 켜는 방법을 한 번 알려 준다.
      if (!allowed && normalized === DEV_ORIGIN && !warnedDevOrigin) {
        warnedDevOrigin = true;
        log.warn("개발 서버(5173)에서 온 요청을 막았습니다. 대시보드 UI를 개발 중이라면 `pnpm run dev`로 봇을 실행하세요.");
      }
      return callback(null, allowed);
    },
  };
}

const exported = { createCorsOptions, normalizeDashboardOrigin };
export default exported;
export { exported as "module.exports" };
