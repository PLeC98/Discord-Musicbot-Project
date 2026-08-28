const path = require("path");
const log = require("./logger").child({ category: "youtube" });
const fs = require("fs");
// youtube-dl-exec 직접 호출 금지 — spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
const youtubedl = require("./ytdlp");
const config = require("../config");
const CacheManager = require("./CacheManager");
const { ffmpegPath } = require("./ffmpegPath");

const BGUTIL_PLUGIN_DIR = path.join(__dirname, "..", "bgutil-ytdlp-pot-provider", "plugin");
const BGUTIL_AVAILABLE = fs.existsSync(BGUTIL_PLUGIN_DIR);

class YouTube {
  // yt-dlp용 공통 매개변수를 반환하는 헬퍼 함수
  static getYtDlpOptions(extraOptions = {}, { forceCookies = false } = {}) {
    const baseOptions = {
      noWarnings: true,
      retries: 3,
      fragmentRetries: 3,
      // 재생과 같은 ffmpeg를 쓰게 한다. 지정하지 않으면 yt-dlp가 PATH에서 제멋대로 찾아
      // 재생(ffmpegPath 해석기)과 캐시 변환이 서로 다른 바이너리를 쓰게 된다 — 실제로 그래왔다.
      ffmpegLocation: ffmpegPath(),
      jsRuntimes: `node:${process.execPath}`,
      addHeader: ["referer:youtube.com", "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"],
      ...(BGUTIL_AVAILABLE && { pluginDirs: BGUTIL_PLUGIN_DIR }),
      ...extraOptions,
    };

    // 인증 모델:
    //  - bgutil(POToken) 사용 가능 시: 평상시 쿠키 없이 bgutil 기본 클라이언트로 처리(계정 노출 최소화).
    //    연령 제한 등으로 실패하면 forceCookies=true로 재시도해 쿠키를 사용(runYtDlp의 폴백).
    //  - bgutil 미사용 시: 쿠키가 있으면 그대로 1차 인증으로 사용(기존 동작).
    // ⚠️ 과거의 "쿠키 없으면 player_client=ios 강제" 폴백은 금지 — ios는 자체 POT 없이 포맷을
    //    안 주고 bgutil도 ios용 POT은 못 만들어 전 영상 재생 불능이 됐다(2026-07-11 실증).
    if (forceCookies || !BGUTIL_AVAILABLE) {
      if (config.ytdl.cookiesFromBrowser) {
        baseOptions.cookiesFromBrowser = config.ytdl.cookiesFromBrowser;
      } else if (config.ytdl.cookiesFile) {
        baseOptions.cookies = config.ytdl.cookiesFile;
      }
    }

    return baseOptions;
  }

  /** 쿠키(브라우저/파일)가 설정돼 있는가 — 연령 제한 폴백 가능 여부 */
  static cookiesConfigured() {
    return !!(config.ytdl.cookiesFromBrowser || config.ytdl.cookiesFile);
  }

  /** yt-dlp 오류가 연령 제한(로그인 필요)인지 판별 */
  static isAgeRestrictedError(error) {
    const msg = (error && (error.stderr || error.message)) || String(error || "");
    return /confirm your age|inappropriate for some users/i.test(msg);
  }

  /**
   * yt-dlp 오류가 "영상 자체가 내려감/삭제/비공개"인지 판별.
   * 캐시된 매핑의 영상이 사라진 경우 재검색으로 보내기 위한 신호.
   * ⚠️ 일시적 네트워크·봇 감지·연령 제한과는 구별(그것들은 재검색 대상 아님).
   */
  static isVideoUnavailableError(error) {
    const msg = (error && (error.stderr || error.message)) || String(error || "");
    return /video unavailable|no longer available|has been removed|removed by (the )?(uploader|user)|private video|account associated with this video has been terminated|this video is not available|content isn.?t available|violat(?:ing|ion) of youtube/i.test(msg);
  }

  /**
   * ytsearch 결과 항목이 "재생 가능한 단일 비디오"인지 판별.
   * yt-dlp flat 검색은 채널/재생목록/핸들을 섞어 반환하므로 이들을 제외한다.
   * 비디오 id는 11자, 채널은 UC…(24자)·/channel//@handle//playlist 형태.
   */
  /**
   * yt-dlp 응답이 "지금 진행 중이거나 예정된 라이브"인지 판별.
   * 라이브는 끝이 없어 캐시 다운로드가 무한히 커지고(yt-dlp가 ffmpeg를 외부 다운로더로 띄운다),
   * Spotify 동등물 후보로서는 언제나 오답이다. flat 검색 항목/상세 정보 양쪽에 같은 필드가 온다.
   */
  static _detectLive(item) {
    if (!item) return false;
    return Boolean(item.is_live) || item.live_status === "is_live" || item.live_status === "is_upcoming";
  }

  static _isVideoEntry(item) {
    if (!item) return false;
    if (item.ie_key && item.ie_key !== "Youtube") return false; // YoutubeTab(채널/재생목록) 등
    const u = item.webpage_url || item.url || "";
    if (/youtube\.com\/(channel\/|@|playlist|user\/|results)/i.test(u)) return false;
    if (item.id && /^[A-Za-z0-9_-]{11}$/.test(item.id)) return true; // 비디오 id
    if (/[?&]v=[A-Za-z0-9_-]{11}/.test(u)) return true; // watch?v= URL
    return false;
  }

  /**
   * yt-dlp 호출을 연령 제한 폴백과 함께 실행.
   *  - 해당 videoId가 이미 연령 제한으로 알려져 있으면 처음부터 쿠키 사용(실패 시도 생략 → 영상당 실패 1회 보장).
   *  - 평상시(bgutil) 시도가 연령 제한으로 실패하면 videoId를 기록하고 쿠키로 1회 재시도.
   * @param {string} url
   * @param {(forceCookies:boolean)=>object} buildOptions  forceCookies를 받아 yt-dlp 옵션을 만드는 함수
   */
  static async runYtDlp(url, buildOptions) {
    const videoId = this.extractVideoId(url);
    let known = false;
    try {
      known = videoId ? CacheManager.isAgeRestricted(videoId) : false;
    } catch {
      /* 캐시 미초기화 등 — 기본값 false */
    }

    try {
      return await youtubedl(url, buildOptions(known));
    } catch (error) {
      if (!known && videoId && this.isAgeRestrictedError(error) && this.cookiesConfigured()) {
        try {
          CacheManager.markAgeRestricted(videoId);
        } catch {
          /* 기록 실패는 무시 */
        }
        log.warn(`연령 제한 감지 (${videoId}) — 쿠키로 폴백 재시도`);
        return await youtubedl(url, buildOptions(true));
      }
      throw error;
    }
  }

  static async search(query, limit = 1, guildId = null) {
    try {
      // 이미 YouTube URL인 경우 직접 정보를 가져옴
      if (this.isYouTubeURL(query)) {
        const info = await this.getInfo(query, guildId);
        return info ? [info] : [];
      }

      // 유튜브 검색에 yt-dlp 사용
      const searchQuery = `ytsearch${limit}:${query}`;

      const results = await youtubedl(
        searchQuery,
        this.getYtDlpOptions({
          dumpSingleJson: true,
          flatPlaylist: true,
        }),
      );

      if (!results || !results.entries) {
        return [];
      }

      const tracks = [];
      // 비디오가 아닌 검색 결과(채널·재생목록·핸들)를 제외 — ytsearch가 이들을 섞어 반환하는데,
      // 재생 불가능한 채널 URL이 후보로 들어가면 매칭이 오염된다(예: 제목이 기호뿐인 곡에서 채널이 순위로 우승).
      const videoEntries = results.entries.filter((e) => YouTube._isVideoEntry(e)).slice(0, limit);
      for (const item of videoEntries) {
        try {
          // 디버그: 항목 구조 기록

          const unknownTitle = "알 수 없는 제목";
          const unknownArtist = "알 수 없는 아티스트";

          const track = {
            title: item.title || item.fulltitle || unknownTitle,
            artist: item.uploader || item.channel || unknownArtist,
            url: item.webpage_url || item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : null),
            duration: item.duration || 0,
            thumbnail: item.thumbnail || item.thumbnails?.[0]?.url,
            platform: "youtube",
            type: "track",
            id: item.id,
            views: item.view_count,
            uploadDate: item.upload_date,
            description: item.description,
            isLive: YouTube._detectLive(item),
          };

          // 검색 결과에 길이가 없으면 getInfo에서 가져오기 시도
          // (라이브는 여기서 duration이 늘 0이라 이 분기를 타고, 상세 정보로 isLive가 확정된다.)
          if (!track.duration || track.duration === 0) {
            const detailedInfo = await this.getInfo(track.url, guildId);
            if (detailedInfo && detailedInfo.duration) {
              track.duration = detailedInfo.duration;
            }
            if (detailedInfo && detailedInfo.isLive) {
              track.isLive = true;
            }
          }

          tracks.push(track);
        } catch (error) {
          continue;
        }
      }

      return tracks;
    } catch (error) {
      log.error("search() failed:", error.message || error);
      return [];
    }
  }

  static async getInfo(url, _guildId = null) {
    try {
      const info = await this.runYtDlp(url, (forceCookies) =>
        this.getYtDlpOptions(
          {
            dumpSingleJson: true,
            preferFreeFormats: true,
          },
          { forceCookies },
        ),
      );

      if (!info) {
        throw new Error("youtube-dl에서 정보를 반환하지 않음");
      }

      const unknownTitle = "알 수 없는 제목";
      const unknownArtist = "알 수 없는 아티스트";

      const track = {
        title: info.title || unknownTitle,
        artist: info.uploader || info.channel || unknownArtist,
        url: info.webpage_url || url,
        duration: info.duration || 0,
        thumbnail: info.thumbnail || info.thumbnails?.[0]?.url,
        platform: "youtube",
        type: "track",
        id: info.id,
        views: info.view_count,
        uploadDate: info.upload_date,
        description: info.description,
        formats: info.formats,
        isLive: YouTube._detectLive(info),
      };

      return track;
    } catch (error) {
      log.error("getInfo() failed:", error.message || error);
      return null;
    }
  }

  static async getStream(url, _guildId = null, startSeconds = 0) {
    try {
      if (!url) {
        throw new Error("URL이 필요함");
      }

      // 단순 형식으로 스트림 URL 가져오기
      const info = await this.runYtDlp(url, (forceCookies) =>
        this.getYtDlpOptions(
          {
            dumpSingleJson: true,
            format: "bestaudio/best",
          },
          { forceCookies },
        ),
      );

      if (!info || !info.url) {
        throw new Error("스트림 URL을 찾을 수 없음");
      }

      const baseUrl = info.url;
      const canSeek = /googlevideo\.com/i.test(baseUrl);
      let finalUrl = baseUrl;

      const seekSeconds = Math.max(0, Number(startSeconds) || 0);
      if (seekSeconds > 0 && canSeek) {
        const startMs = Math.floor(seekSeconds * 1000);
        const separator = baseUrl.includes("?") ? "&" : "?";
        finalUrl = `${baseUrl}${separator}begin=${startMs}`;
      }

      return {
        url: finalUrl,
        rawUrl: baseUrl,
        type: info.acodec && info.acodec.includes("opus") ? "opus" : "arbitrary",
        duration: info.duration || 0,
        bitrate: info.abr || info.tbr || 0,
        canSeek,
        format: info.format,
        httpHeaders: info.http_headers || {},
        isLive: YouTube._detectLive(info),
      };
    } catch (error) {
      log.error("getStream() failed:", error.message || error);
      throw error;
    }
  }

  static async getPlaylist(url, _guildId = null) {
    try {
      const info = await youtubedl(
        url,
        this.getYtDlpOptions({
          dumpSingleJson: true,
          flatPlaylist: true,
        }),
      );

      if (!info) {
        throw new Error("재생목록 정보를 가져올 수 없음");
      }

      if (!info.entries || info.entries.length === 0) {
        throw new Error("재생목록 항목을 찾을 수 없음");
      }

      const unknownTitle = "알 수 없는 제목";
      const unknownArtist = "알 수 없는 아티스트";

      const tracks = [];
      for (const entry of info.entries.slice(0, config.bot.maxPlaylistSize)) {
        if (entry && (entry.id || entry.url)) {
          try {
            const track = {
              title: entry.title || entry.fulltitle || unknownTitle,
              artist: entry.uploader || entry.channel || entry.uploader_id || unknownArtist,
              url: entry.webpage_url || entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null),
              duration: entry.duration || 0,
              thumbnail: entry.thumbnail || entry.thumbnails?.[0]?.url,
              platform: "youtube",
              type: "track",
              id: entry.id,
            };

            if (track.url) {
              tracks.push(track);
            }
          } catch (entryError) {
            continue;
          }
        }
      }

      if (tracks.length === 0) {
        throw new Error("재생목록에서 유효한 트랙을 찾을 수 없음");
      }

      const unknownPlaylist = "알 수 없는 재생목록";

      return {
        title: info.title || unknownPlaylist,
        tracks: tracks,
        totalTracks: info.playlist_count || tracks.length,
        url: url,
        platform: "youtube",
        type: "playlist",
      };
    } catch (error) {
      log.error("getPlaylist() failed:", error.message || error);
      return null;
    }
  }

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

  static isYouTubeURL(value) {
    const parsed = this._parseYouTubeURL(value);
    if (!parsed) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname === "youtu.be") return /^\/[a-zA-Z0-9_-]+/.test(parsed.pathname);
    if (parsed.pathname === "/watch") return /^[a-zA-Z0-9_-]+$/.test(parsed.searchParams.get("v") || "");
    if (parsed.pathname === "/playlist") return /^[a-zA-Z0-9_-]+$/.test(parsed.searchParams.get("list") || "");
    return /^\/(embed|v|shorts)\/[a-zA-Z0-9_-]+/.test(parsed.pathname);
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
      const match = parsed.pathname.match(/^\/(?:embed|v|shorts)\/([a-zA-Z0-9_-]+)/);
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

module.exports = YouTube;
