// 실제와 같은 모양의 오류. 종류는 글이 아니라 이름(code)으로 구분하므로 가짜도 이름을 단다.

import * as YouTube from "../../src/sources/youtube/index.ts";

/** fetch 가 연결하지 못했을 때의 모양: TypeError("fetch failed") 의 원인에 시스템 이름이 붙는다 */
function networkError(message = "fetch failed") {
  return Object.assign(new TypeError(message), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND example.invalid"), { code: "ENOTFOUND" }) });
}

/** yt-dlp 가 실패했을 때의 모양: 글은 stderr 그대로, 이름은 실행하는 곳(ytdlpSpawn)이 붙인다 */
function ytDlpError(stderr: string) {
  return Object.assign(new Error(stderr), { stderr, code: YouTube.codeOf(new Error(stderr)) ?? undefined });
}

export { networkError, ytDlpError };
