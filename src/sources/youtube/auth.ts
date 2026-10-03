// 유튜브에 어떻게 붙는가. POToken 플러그인 · 쿠키 · 유튜브용 yt-dlp 옵션 · 인증 상태 로그.

import path from "path";
import type { YtDlpFlags as Flags } from "../ytdlpSpawn.ts";
import fs from "fs";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "youtube" });
import config from "../../../config.ts";
import { baseOptions } from "../ytdlpOptions.ts";
import { NEEDS_POT, KNOWN, playerClients } from "./clients.ts";
import { PROJECT } from "../../infra/projectPaths.ts";

// yt-dlp의 --plugin-dirs는 하위 디렉터리마다 yt_dlp_plugins가 들어 있는 루트를 기대한다
// (`<지정한 경로>/<아무 이름>/yt_dlp_plugins/...`). yt_dlp_plugins를 직접 담은 디렉터리를 주면
// 한 단계 더 들어가 찾다가 아무것도 못 찾고 조용히 넘어간다. 오류도 경고도 없다.
// 그래서 plugin/ 이 아니라 그 부모인 저장소 루트를 넘긴다.
const BGUTIL_DIR = PROJECT.bgutil;
// 있는지 확인하는 것으로 그치지 않고 yt-dlp의 규칙 그대로 훑는다.
// 경로만 확인하면 상대 위치가 또 어긋났을 때 다시 조용히 죽는다.
function findPluginRoot(dir: string): string | null {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null; // 설치 안 됨
  }
  for (const e of entries) {
    if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, "yt_dlp_plugins"))) return path.join(dir, e.name, "yt_dlp_plugins");
  }
  return null;
}
const BGUTIL_PLUGIN_ROOT = findPluginRoot(BGUTIL_DIR);
const BGUTIL_AVAILABLE = BGUTIL_PLUGIN_ROOT !== null;
import * as cookieConfig from "../../config/cookies.ts";

// 유튜브용 yt-dlp 옵션. 공통(ytdlpOptions) 위에 유튜브 전용을 얹는다
function getYtDlpOptions(extraOptions: Flags = {}, { forceCookies = false } = {}): Flags {
  const options = baseOptions({
    jsRuntimes: `node:${process.execPath}` as const,
    // User-Agent를 우리가 덮지 않는다. yt-dlp는 클라이언트마다 다른 값을 골라 주고, 그 값이
    // http_headers로 실려 와 재생 요청 헤더가 된다. 우리가 덮으면 그게 낡은 단일 값으로 뭉개진다.
    ...(potEnabled() && { pluginDirs: BGUTIL_DIR }),
    ...extraOptions,
  });

  // 인증 모델: 평상시 쿠키 없이, 연령 제한에만 쿠키. bgutil 유무와 무관하다.
  // 쿠키는 계정 밴 위험이 있다. 노출 지점을 연령 제한 한 곳으로 묶는다.
  //   "player_client=ios 강제" 폴백은 금지. ios는 자체 POT 없이 포맷을 안 주고
  //   bgutil도 ios용 POT은 못 만들어 전 영상 재생 불능이 됐다.
  if (forceCookies) {
    if (config.ytdlp.cookiesFromBrowser) {
      options.cookiesFromBrowser = config.ytdlp.cookiesFromBrowser;
    } else if (config.ytdlp.useCookieFile && cookieConfig.cookiesReady()) {
      options.cookies = cookieConfig.cookiesPath();
    }
  }

  return options;
}

/** POToken 공급자를 실제로 쓰는가. 설치돼 있고 + 켜져 있을 때만 */
function potEnabled() {
  return BGUTIL_AVAILABLE && config.bgutil.enabled;
}

/**
 * 기동 시 한 줄로 인증 상태를 남긴다. "지금 무엇으로 유튜브에 붙고 있나"를 한눈에.
 */
function logAuthMode() {
  const clients = config.ytdlp.playerClients;
  const pot = potEnabled() ? "사용" : config.bgutil.enabled ? "설정됨(설치 없음)" : "미사용";
  // 파일 방식인데 아직 안 올렸으면 그렇다고 적는다. 연령 제한 영상이 나오고서야 아는 것보다 낫다
  const cookie = config.ytdlp.cookiesFromBrowser ? `브라우저 ${config.ytdlp.cookiesFromBrowser}(연령 제한 폴백 전용)` : config.ytdlp.useCookieFile ? (cookieConfig.cookiesReady() ? "파일(연령 제한 폴백 전용)" : "파일(아직 비어 있음. 대시보드에서 넣으세요)") : "없음";
  log.info({ tags: ["startup"] }, `재생 인증: 클라이언트=${clients.length ? clients.join(",") : "yt-dlp 기본값"} | POToken=${pot} | 쿠키=${cookie}`);

  // POToken이 있어야 제대로 도는 클라이언트를 적어놓고 공급자를 안 켰으면 알려준다.
  // 막지는 않는다. 이 표는 오늘의 유튜브일 뿐이고, 진짜 판정은 실행이 한다.
  const needy = clients.filter((c) => NEEDS_POT.includes(c));
  if (needy.length && !potEnabled()) {
    log.warn(`${needy.join(", ")} 은(는) POToken이 있어야 제대로 동작합니다. BGUTIL_ENABLED=true로 켜거나 목록에서 빼세요`);
  }

  // 우리가 아는 목록에 없는 이름. 걸러내지 않는다. yt-dlp가 새로 추가한 것일 수 있고,
  // 유효한지는 yt-dlp가 판단한다. 알고 넣은 사람은 이 줄을 무시하면 되고,
  // 오타였다면 "넣으라는 대로 넣었는데 왜?"의 답이 여기 있다.
  const unknown = clients.filter((c) => !KNOWN.includes(c));
  if (unknown.length) {
    log.warn(`${unknown.join(", ")} 은(는) 확인된 클라이언트 목록에 없습니다. yt-dlp가 받아들이면 그대로 동작하고, 아니면 아래에 경고가 뜹니다`);
  }
}

/**
 * 대시보드용. 지금 유튜브에 어떻게 붙고 있고, 어느 경로가 살아 있나.
 * 기동 로그는 시작 시점의 설정만 보여주지만 여기는 실행 중 바뀌는 상태(제외된 경로)를 담는다.
 */
function statusSnapshot() {
  const snap = playerClients().snapshot();
  const fails = (h: Array<"ok" | "ng"> | undefined) => (h || []).filter((x) => x === "ng").length;
  return {
    pot: potEnabled() ? "on" : config.bgutil.enabled ? "missing" : "off",
    cookies: config.ytdlp.cookiesFromBrowser ? "browser" : config.ytdlp.useCookieFile ? "file" : "none",
    configured: snap.order.length > 0,
    clients: snap.order.map((name) => ({
      name,
      excluded: snap.excluded.includes(name),
      tried: (snap.history[name] || []).length,
      failed: fails(snap.history[name]),
      needsPot: NEEDS_POT.includes(name),
      known: KNOWN.includes(name),
    })),
  };
}

/**
 * 쿠키(브라우저/파일)를 지금 쓸 수 있는가. 연령 제한 폴백 가능 여부.
 *
 * 파일 쪽은 기동 시점이 아니라 물어볼 때마다 본다. 대시보드로 갈아 끼우면 봇을 다시 띄우지
 * 않아도 다음 판정부터 반영돼야 한다. 빈도가 낮아(연령 제한에서만 불린다) stat 값이 아깝지 않다.
 */
function cookiesConfigured() {
  if (config.ytdlp.cookiesFromBrowser) return true;
  return config.ytdlp.useCookieFile && cookieConfig.cookiesReady();
}

export { getYtDlpOptions, potEnabled, logAuthMode, statusSnapshot, cookiesConfigured, BGUTIL_DIR, BGUTIL_PLUGIN_ROOT, BGUTIL_AVAILABLE, findPluginRoot };
