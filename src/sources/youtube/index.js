"use strict";

// 유튜브 인증·실행·오류·API를 한 이름으로 모은다. URL 해석은 여기 있다.

// youtube-dl-exec 직접 호출 금지. spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
const youtubedl = require("../ytdlpSpawn");
const links = require("../../rules/links");
const auth = require("./auth");
const run = require("./ytdlpRun");
const { YouTubeErrors } = require("./errors");
const { YouTubeApi } = require("./api");

class YouTube {
  static parseDuration(durationString) {
    if (!durationString) return 0;

    // "3:45", "1:23:45" 같은 형식 처리
    const parts = durationString.split(":").reverse();
    let seconds = 0;

    for (let i = 0; i < parts.length; i++) {
      seconds += parseInt(parts[i]) * Math.pow(60, i);
    }

    return seconds;
  }

  static async validateUrl(url) {
    try {
      if (!links.isYouTubeURL(url)) {
        return false;
      }

      // 검증을 위해 기본 정보 가져오기 시도
      const info = await youtubedl(
        url,
        this.getYtDlpOptions({
          dumpSingleJson: true,
          skipDownload: true,
        }),
      );

      return !!info && !!info.title;
    } catch (error) {
      return false;
    }
  }
}

// 나눠 둔 부분의 정적 메서드를 붙인다. 부분끼리는 this 로 서로 부르므로 여기 붙은 뒤에야 돈다
for (const part of [auth.YouTubeAuth, run.YouTubeRun, YouTubeErrors, YouTubeApi]) {
  for (const [name, desc] of Object.entries(Object.getOwnPropertyDescriptors(part))) {
    if (name !== "length" && name !== "name" && name !== "prototype") Object.defineProperty(YouTube, name, desc);
  }
}

YouTube._internals = { BGUTIL_DIR: auth.BGUTIL_DIR, BGUTIL_PLUGIN_ROOT: auth.BGUTIL_PLUGIN_ROOT, BGUTIL_AVAILABLE: auth.BGUTIL_AVAILABLE, findPluginRoot: auth.findPluginRoot, playerClients: run.playerClients };

module.exports = YouTube;
