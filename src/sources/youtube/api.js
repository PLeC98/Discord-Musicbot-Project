"use strict";

// 유튜브 검색 · 정보 · 스트림 · 재생목록.

const log = require("../../infra/log/logger").child({ category: "youtube" });
const links = require("../../rules/links");
const { canonicalUrl } = require("../../rules/canonicalUrl");
// youtube-dl-exec 직접 호출 금지. spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
const youtubedl = require("../ytdlpSpawn");
const config = require("../../../config");
const trackLookup = require("../../store/trackLookup");

class YouTubeApi {
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

  /**
   * 라이브의 종류를 가린다. `_detectLive`는 "라이브 계열인가"만 보지만,
   * 재생은 방송 중(is_live)과 시작 전(is_upcoming)을 다르게 다뤄야 한다. 틀 것이 없는 쪽은 거절한다.
   * @returns {"is_live"|"is_upcoming"|null}
   */
  static liveStatusOf(item) {
    if (!item) return null;
    if (item.live_status === "is_live" || item.live_status === "is_upcoming") return item.live_status;
    // 구버전 응답이나 flat 검색 항목에는 live_status 없이 is_live만 올 수 있다.
    if (item.live_status === undefined && item.is_live) return "is_live";
    return null;
  }

  /**
   * 표시용 제목. 라이브는 yt-dlp가 `title` 뒤에 조회 시각을 붙여 준다(예: `제목 2026-01-02 03:04`).
   * 조회할 때마다 달라지는 값이라 캐시·매칭에도 나쁘다. `fulltitle`이 그게 빠진 원제이고,
   * 라이브가 아니면 둘이 같다.
   */
  static titleOf(item) {
    if (!item) return null;
    const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
    const full = text(item.fulltitle);
    const title = text(item.title);
    if (this.liveStatusOf(item) && full) return full;
    return title || full;
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

  // 마지막 인자 { exec }: yt-dlp 를 실행하는 함수. 생략하면 진짜. getInfo · getStream · getPlaylist 도 같다
  static async search(query, limit = 1, { exec = youtubedl } = {}) {
    try {
      // 이미 YouTube URL인 경우 직접 정보를 가져옴
      if (links.isYouTubeURL(query)) {
        const info = await this.getInfo(query);
        return info ? [info] : [];
      }

      // 유튜브 검색에 yt-dlp 사용
      const searchQuery = `ytsearch${limit}:${query}`;

      const results = await exec(
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
      // 비디오가 아닌 검색 결과(채널·재생목록·핸들)를 제외. ytsearch가 이들을 섞어 반환하는데,
      // 재생 불가능한 채널 URL이 후보로 들어가면 매칭이 오염된다(예: 제목이 기호뿐인 곡에서 채널이 순위로 우승).
      const videoEntries = results.entries.filter((e) => this._isVideoEntry(e)).slice(0, limit);
      for (const item of videoEntries) {
        try {
          // 디버그: 항목 구조 기록

          const unknownTitle = "알 수 없는 제목";
          const unknownArtist = "알 수 없는 아티스트";

          const url = item.webpage_url || item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : null);
          const link = canonicalUrl(url);
          const track = {
            title: this.titleOf(item) || unknownTitle,
            artist: item.uploader || item.channel || unknownArtist,
            pageUrl: link,
            requestKey: link,
            audioUrl: link,
            duration: item.duration || 0,
            thumbnail: item.thumbnail || item.thumbnails?.[0]?.url,
            platform: "youtube",
            type: "track",
            id: item.id,
            views: item.view_count,
            uploadDate: item.upload_date,
            description: item.description,
            isLive: this._detectLive(item),
            liveStatus: this.liveStatusOf(item),
          };

          // 검색 결과에 길이가 없으면 getInfo에서 가져오기 시도
          // (라이브는 여기서 duration이 늘 0이라 이 분기를 타고, 상세 정보로 isLive가 확정된다.)
          if (!track.duration || track.duration === 0) {
            const detailedInfo = await this.getInfo(url);
            if (detailedInfo && detailedInfo.duration) {
              track.duration = detailedInfo.duration;
            }
            if (detailedInfo && detailedInfo.isLive) {
              track.isLive = true;
              track.liveStatus = detailedInfo.liveStatus;
            }
          }

          tracks.push(track);
        } catch (error) {
          continue;
        }
      }

      return tracks;
    } catch (error) {
      log.error("유튜브 검색 실패:", error.message || error);
      return [];
    }
  }

  static async getInfo(url, { exec } = {}) {
    try {
      const info = await this.runYtDlp(
        url,
        (forceCookies) =>
          this.getYtDlpOptions(
            {
              dumpSingleJson: true,
              preferFreeFormats: true,
            },
            { forceCookies },
          ),
        exec,
      );

      if (!info) {
        throw new Error("youtube-dl에서 정보를 반환하지 않음");
      }

      const unknownTitle = "알 수 없는 제목";
      const unknownArtist = "알 수 없는 아티스트";

      const link = canonicalUrl(info.webpage_url || url);
      const track = {
        title: this.titleOf(info) || unknownTitle,
        artist: info.uploader || info.channel || unknownArtist,
        pageUrl: link,
        requestKey: link,
        audioUrl: link,
        duration: info.duration || 0,
        thumbnail: info.thumbnail || info.thumbnails?.[0]?.url,
        platform: "youtube",
        type: "track",
        id: info.id,
        views: info.view_count,
        uploadDate: info.upload_date,
        description: info.description,
        formats: info.formats,
        isLive: this._detectLive(info),
        liveStatus: this.liveStatusOf(info),
      };

      return track;
    } catch (error) {
      log.error("영상 정보 조회 실패:", this.briefError(error));
      return null;
    }
  }

  static async getStream(url, startSeconds = 0, { exec } = {}) {
    try {
      if (!url) {
        throw new Error("URL이 필요함");
      }

      // 단순 형식으로 스트림 URL 가져오기
      const info = await this.runYtDlp(
        url,
        (forceCookies) =>
          this.getYtDlpOptions(
            {
              dumpSingleJson: true,
              format: "bestaudio/best",
            },
            { forceCookies },
          ),
        exec,
      );

      if (!info || !info.url) {
        throw new Error("스트림 URL을 찾을 수 없음");
      }

      const baseUrl = info.url;
      // HLS 재생목록 주소에는 `begin=`을 붙일 수 없다. 위치는 ffmpeg의 `-ss`가 정한다.
      const isHls = typeof info.protocol === "string" && info.protocol.startsWith("m3u8");
      const canSeek = !isHls && /googlevideo\.com/i.test(baseUrl);
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
        // 영상 자체의 제목. 재생목록 페이지가 주는 제목과 다를 수 있고, 이쪽이 정본이다
        // (watch 페이지의 videoDetails.title이라 요청 언어와 무관하게 원제가 온다).
        title: this.titleOf(info),
        type: info.acodec && info.acodec.includes("opus") ? "opus" : "arbitrary",
        duration: info.duration || 0,
        bitrate: info.abr || info.tbr || 0,
        canSeek,
        format: info.format,
        httpHeaders: info.http_headers || {},
        isLive: this._detectLive(info),
        liveStatus: this.liveStatusOf(info),
        // yt-dlp가 알려주는 전송 방식. m3u8 계열은 "받아 둔 바이트"가 아니라 "받아 올 주소"를
        // 줘야 하는 형식이라 파이프로 먹일 수 없다. 재생 쪽이 이 값으로 갈래를 고른다.
        protocol: info.protocol || null,
      };
    } catch (error) {
      log.error("스트림 URL 획득 실패:", this.briefError(error));
      throw error;
    }
  }

  // offset부터 limit개만 받는다. 유튜브는 시작점까지 이어 받기를 걸어가야 해서 비용이 끝 위치에 비례한다.
  // 총 곡 수(playlist_count)는 구간만 받아도 오지만, 믹스(RD…)는 끝이 없어 null이다.
  static async getPlaylist(url, { offset = 0, limit = config.bot.playlistAddDefault, exec = youtubedl } = {}) {
    try {
      const info = await exec(
        url,
        this.getYtDlpOptions({
          dumpSingleJson: true,
          flatPlaylist: true,
          playlistItems: `${offset + 1}:${offset + limit}`,
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
      for (const entry of info.entries) {
        if (entry && (entry.id || entry.url)) {
          try {
            const videoUrl = entry.webpage_url || entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null);
            const link = canonicalUrl(videoUrl);
            const track = {
              title: this.titleOf(entry) || unknownTitle,
              artist: entry.uploader || entry.channel || entry.uploader_id || unknownArtist,
              pageUrl: link,
              requestKey: link,
              audioUrl: link,
              duration: entry.duration || 0,
              thumbnail: entry.thumbnail || entry.thumbnails?.[0]?.url,
              platform: "youtube",
              type: "track",
              id: entry.id,
              isLive: this._detectLive(entry),
              liveStatus: this.liveStatusOf(entry),
            };

            // 이 영상의 제목을 전에 영상 자체에서 확인해 뒀다면 그걸 쓴다(로컬 DB 조회, 왕복 없음).
            // 재생목록 페이지의 제목은 낡을 수 있어서, 이게 없으면 곡이 재생되기 전까지 대기열에
            // 낡은 제목이 그대로 보인다.
            if (track.requestKey) {
              try {
                const known = trackLookup.getVerifiedTitle(track.requestKey);
                if (known) track.title = known;
              } catch {
                /* DB 미초기화 등. 재생목록 제목 그대로 간다 */
              }
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
        total: info.playlist_count ?? null,
        nextOffset: offset + info.entries.length,
        url: url,
        platform: "youtube",
        type: "playlist",
      };
    } catch (error) {
      log.error("재생목록 조회 실패:", error.message || error);
      return null;
    }
  }
}

module.exports = { YouTubeApi };
