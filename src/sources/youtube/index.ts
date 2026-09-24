// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// 유튜브 인증·실행·오류·API를 한 이름으로 모은다. URL 해석은 rules/links 에 있다.

// youtube-dl-exec 직접 호출 금지. spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
import youtubedl from "../ytdlpSpawn.ts";
import * as links from "../../rules/links.ts";
import auth from "./auth.ts";
import run from "./ytdlpRun.ts";
import errors from "./errors.ts";
import api from "./api.ts";
import clients from "./clients.ts";

function parseDuration(durationString) {
  if (!durationString) return 0;

  // "3:45", "1:23:45" 같은 형식 처리
  const parts = durationString.split(":").reverse();
  let seconds = 0;

  for (let i = 0; i < parts.length; i++) {
    seconds += parseInt(parts[i]) * Math.pow(60, i);
  }

  return seconds;
}

async function validateUrl(url) {
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

    return !!info && !!info.title;
  } catch (error) {
    return false;
  }
}

// 나눠 둔 부분의 함수를 한 이름으로 모은다. 밖에서는 YouTube.search 처럼 부른다
const { BGUTIL_DIR, BGUTIL_PLUGIN_ROOT, BGUTIL_AVAILABLE, findPluginRoot, ...authFns } = auth;
const YouTube = {
  parseDuration,
  validateUrl,
  ...authFns,
  ...run,
  ...errors,
  ...api,
  _internals: {
    BGUTIL_DIR,
    BGUTIL_PLUGIN_ROOT,
    BGUTIL_AVAILABLE,
    findPluginRoot,
    get playerClients() {
      return clients.playerClients();
    },
  },
};

export default YouTube;
export { YouTube as "module.exports" };
