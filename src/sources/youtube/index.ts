// 유튜브 인증·실행·오류·API를 한 이름으로 모은다. URL 해석은 rules/links 에 있다.

// youtube-dl-exec 직접 호출 금지. spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
import youtubedl from "../ytdlpSpawn.ts";
import * as links from "../../rules/links.ts";
import * as auth from "./auth.ts";
import * as clients from "./clients.ts";

function parseDuration(durationString: string | null | undefined): number {
  if (!durationString) return 0;

  // "3:45", "1:23:45" 같은 형식 처리
  const parts = durationString.split(":").reverse();
  let seconds = 0;

  for (let i = 0; i < parts.length; i++) {
    seconds += parseInt(parts[i]) * Math.pow(60, i);
  }

  return seconds;
}

async function validateUrl(url: string): Promise<boolean> {
  try {
    if (!links.isYouTubeURL(url)) {
      return false;
    }

    // 검증을 위해 기본 정보 가져오기 시도
    const info = await youtubedl(
      url,
      auth.getYtDlpOptions({
        dumpSingleJson: true,
        skipDownload: true,
      }),
    );

    return !!info && !!(info as { title?: unknown }).title;
  } catch (error) {
    return false;
  }
}

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
export { parseDuration, validateUrl, _internals };
