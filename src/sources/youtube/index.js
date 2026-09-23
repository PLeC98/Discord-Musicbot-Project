"use strict";

// 유튜브. 쪼갠 부분(인증 · 실행 · 오류 · API)을 한 이름으로 모은다. URL 해석은 여기 있다.

// youtube-dl-exec 직접 호출 금지. spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
const youtubedl = require("../ytdlpSpawn");
const auth = require("./auth");
const run = require("./ytdlpRun");
const { YouTubeErrors } = require("./errors");
const { YouTubeApi } = require("./api");

class YouTube {
  static _parseYouTubeURL(value) {
    if (typeof value !== "string") return null;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
      if (!["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(hostname)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /** 유튜브 호스트이기만 하면 참. 재생 가능한 형태인지는 보지 않는다(isYouTubeURL이 본다). */
  static isYouTubeHost(value) {
    return this._parseYouTubeURL(value) !== null;
  }

  // /live/ID는 라이브였던 영상의 링크일 뿐 다른 형태와 같은 영상 ID를 쓴다.
  // 지금 라이브인지는 URL이 아니라 메타데이터(is_live)가 정한다. 방송이 끝나면 같은 링크가 VOD가 된다.
  static isYouTubeURL(value) {
    const parsed = this._parseYouTubeURL(value);
    if (!parsed) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname === "youtu.be") return /^\/[a-zA-Z0-9_-]+/.test(parsed.pathname);
    if (parsed.pathname === "/watch") return /^[a-zA-Z0-9_-]+$/.test(parsed.searchParams.get("v") || "");
    if (parsed.pathname === "/playlist") return /^[a-zA-Z0-9_-]+$/.test(parsed.searchParams.get("list") || "");
    return /^\/(embed|v|shorts|live)\/[a-zA-Z0-9_-]+/.test(parsed.pathname);
  }

  static isPlaylist(value) {
    const parsed = this._parseYouTubeURL(value);
    if (!parsed || !/^[a-zA-Z0-9_-]+$/.test(parsed.searchParams.get("list") || "")) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    return hostname === "youtu.be" || parsed.pathname === "/playlist" || parsed.pathname === "/watch";
  }

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

  static extractVideoId(value) {
    const parsed = this._parseYouTubeURL(value);
    if (!parsed) return null;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    let videoId;
    if (hostname === "youtu.be") {
      videoId = parsed.pathname.split("/").filter(Boolean)[0] || null;
    } else if (parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v");
    } else {
      const match = parsed.pathname.match(/^\/(?:embed|v|shorts|live)\/([a-zA-Z0-9_-]+)/);
      videoId = match?.[1] || null;
    }
    return /^[a-zA-Z0-9_-]+$/.test(videoId || "") ? videoId : null;
  }

  static extractPlaylistId(url) {
    const match = url.match(/[&?]list=([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  static createThumbnailUrl(videoId, quality = "maxresdefault") {
    return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
  }

  static createVideoUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  static async validateUrl(url) {
    try {
      if (!this.isYouTubeURL(url)) {
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
