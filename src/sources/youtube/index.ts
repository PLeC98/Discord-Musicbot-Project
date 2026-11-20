// 유튜브 인증, 실행, 오류, API를 한 이름으로 모은다. URL 해석은 rules/links에 있다.

import * as auth from "./auth.ts";
import * as clients from "./clients.ts";

// 테스트, 진단용
const _internals = {
  /** 플러그인을 실을 폴더(기동 시 정한 bgutil 빌드의 저장소 루트). 설치돼 있지 않으면 null */
  get bgutilPluginDirs() {
    return auth.bgutilPluginDirs();
  },
  findPluginRoot: auth.findPluginRoot,
  get playerClients() {
    return clients.playerClients();
  },
};

// 밖에서는 youtubeSource.searchVideos처럼 부른다
export { getYtDlpOptions, potEnabled, logAuthMode, statusSnapshot, cookieSource, cookiesConfigured } from "./auth.ts";
export * from "./ytdlp-run.ts";
export * from "./errors.ts";
export * from "./api.ts";
export { _internals };
export * from "./text-search.ts";
