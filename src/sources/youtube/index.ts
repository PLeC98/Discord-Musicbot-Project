// 유튜브 인증·실행·오류·API를 한 이름으로 모은다. URL 해석은 rules/links 에 있다.

import * as auth from "./auth.ts";
import * as clients from "./clients.ts";

// 테스트 · 진단용
const _internals = {
  BGUTIL_DIR: auth.BGUTIL_DIR,
  BGUTIL_PLUGIN_ROOT: auth.BGUTIL_PLUGIN_ROOT,
  BGUTIL_AVAILABLE: auth.BGUTIL_AVAILABLE,
  findPluginRoot: auth.findPluginRoot,
  get playerClients() {
    return clients.playerClients();
  },
};

// 나눠 둔 부분의 함수를 한 이름으로 모은다. 밖에서는 YouTube.search 처럼 부른다
export { useFfmpeg, getYtDlpOptions, potEnabled, logAuthMode, statusSnapshot, cookiesConfigured } from "./auth.ts";
export * from "./ytdlpRun.ts";
export * from "./errors.ts";
export * from "./api.ts";
export { _internals };
