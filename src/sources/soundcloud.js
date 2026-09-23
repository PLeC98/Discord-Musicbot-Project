// youtube-dl-exec 직접 호출 금지. spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
const youtubedl = require("./ytdlpSpawn");
const links = require("../rules/links");
const config = require("../../config");
const { capabilities: ffmpegCapabilities } = require("../media/ffmpeg/path");

class SoundCloud {
  // SoundCloud는 더 이상 클라이언트 ID가 필요 없으므로 yt-dlp를 직접 사용

  static async search(query, limit = 1) {
    try {
      // 이미 SoundCloud URL이면 직접 정보 가져오기
      if (this.isSoundCloudURL(query)) {
        const info = await this.getInfo(query);
        return info ? [info] : [];
      }

      // yt-dlp의 네이티브 SoundCloud 검색 접두사 사용. (ytsearch + "site:"는 YouTube 결과만 반환했고, 아래 soundcloud.com 필터가 이를 버려 항상 비어 있었음)
      const searchQuery = `scsearch${limit}:${query}`;

      const results = await youtubedl(searchQuery, {
        dumpSingleJson: true,
        flatPlaylist: true,
        noWarnings: true,
      });

      if (!results || !results.entries) {
        return [];
      }

      const tracks = [];
      for (const item of results.entries.slice(0, limit)) {
        try {
          // SoundCloud 링크만 필터링
          if (item.webpage_url && this.isSoundCloudURL(item.webpage_url)) {
            const track = await this.formatTrack(item);
            if (track) {
              tracks.push(track);
            }
          }
        } catch (error) {
          continue;
        }
      }

      return tracks;
    } catch (error) {
      return [];
    }
  }

  static async getInfo(url) {
    try {
      // yt-dlp로 SoundCloud 정보 가져오기
      const info = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
      });

      if (!info) {
        throw new Error("SoundCloud에서 정보를 반환하지 않음");
      }

      const track = await this.formatTrack(info);

      return track;
    } catch (error) {
      return null;
    }
  }

  /**
   * 재생용 스트림 서술자. 주소만이 아니라 전송 방식까지 돌려준다.
   * 사운드클라우드의 최고 음질은 HLS(`hls_aac_96k` 등)라 파이프로는 열리지 않는다.
   * 재생 쪽이 `protocol`을 보고 주소를 주는 갈래로 보낸다.
   *
   * 탐색은 URL 매개변수가 아니라 ffmpeg가 처리한다.
   */
  static async getStream(url) {
    // HLS를 못 여는 ffmpeg 빌드에서는 애초에 받아 합칠 수 있는 포맷을 고른다.
    // 사운드클라우드는 progressive(`http_mp3_1_0`)를 함께 주므로 음질을 조금 내주고 재생을 지킨다.
    const format = ffmpegCapabilities().ok ? "bestaudio/best" : "bestaudio[protocol^=http]/best[protocol^=http]/bestaudio/best";

    const info = await youtubedl(url, {
      format,
      dumpSingleJson: true,
      noWarnings: true,
    });

    if (!info || !info.url) {
      throw new Error("스트림 URL을 찾을 수 없음");
    }

    return {
      url: info.url,
      protocol: info.protocol || null,
      duration: Math.round(Number(info.duration) || 0),
      bitrate: info.abr || info.tbr || 0,
      platform: "soundcloud",
      httpHeaders: info.http_headers || {},
    };
  }

  static async getPlaylist(url) {
    try {
      // yt-dlp로 재생목록 정보 가져오기
      const result = await youtubedl(url, {
        dumpSingleJson: true,
        flatPlaylist: true,
        noWarnings: true,
      });

      if (!result || !result.entries) {
        throw new Error("재생목록 트랙을 찾을 수 없음");
      }

      const tracks = [];
      for (const item of result.entries.slice(0, config.bot.playlistAddDefault)) {
        const formattedTrack = await this.formatTrack(item);
        if (formattedTrack) {
          tracks.push(formattedTrack);
        }
      }

      const unknownPlaylist = "알 수 없는 재생목록";

      return {
        title: result.title || result.playlist_title || unknownPlaylist,
        tracks: tracks,
        totalTracks: result.playlist_count || tracks.length,
        url: url,
        platform: "soundcloud",
        type: "playlist",
        description: result.description,
        user: result.uploader || result.playlist_uploader,
      };
    } catch (error) {
      return null;
    }
  }

  static async getUserTracks(userUrl, limit = 10) {
    try {
      // SoundCloud 사용자 프로필에 yt-dlp 사용
      // 사용자의 최신 트랙 가져오기
      const result = await youtubedl(userUrl, {
        dumpSingleJson: true,
        flatPlaylist: true,
        playlistEnd: limit,
        noWarnings: true,
      });

      if (!result || !result.entries) {
        return [];
      }

      const tracks = [];
      for (const item of result.entries.slice(0, limit)) {
        const formattedTrack = await this.formatTrack(item);
        if (formattedTrack) {
          tracks.push(formattedTrack);
        }
      }

      return tracks;
    } catch (error) {
      return [];
    }
  }

  static async formatTrack(soundcloudTrack) {
    try {
      const unknownTitle = "알 수 없는 제목";
      const unknownArtist = "알 수 없는 아티스트";

      const track = {
        title: soundcloudTrack.title || soundcloudTrack.fulltitle || unknownTitle,
        artist: soundcloudTrack.uploader || soundcloudTrack.artist || unknownArtist,
        url: soundcloudTrack.webpage_url || soundcloudTrack.url,
        duration: soundcloudTrack.duration || 0,
        thumbnail: soundcloudTrack.thumbnail,
        platform: "soundcloud",
        type: "track",
        id: soundcloudTrack.id,
        description: soundcloudTrack.description,
        uploadDate: soundcloudTrack.upload_date,
        viewCount: soundcloudTrack.view_count,
        likeCount: soundcloudTrack.like_count,
        channel: soundcloudTrack.channel,
        channelId: soundcloudTrack.channel_id,
      };

      return track;
    } catch (error) {
      return null;
    }
  }

  static isSoundCloudURL(url) {
    return links.isSoundCloudURL(url);
  }

  static isPlaylist(url) {
    return url.includes("/sets/");
  }

  static isTrack(url) {
    return this.isSoundCloudURL(url) && !this.isPlaylist(url) && !this.isUser(url);
  }

  static isUser(url) {
    // 사용자 프로필 URL인지 확인 (트랙 또는 재생목록 경로 없음)
    const match = url.match(/^https?:\/\/(www\.)?soundcloud\.com\/([\w-]+)$/);
    return !!match;
  }

  static extractUsername(url) {
    const match = url.match(/^https?:\/\/(www\.)?soundcloud\.com\/([\w-]+)/);
    return match ? match[2] : null;
  }

  static extractTrackSlug(url) {
    const match = url.match(/^https?:\/\/(www\.)?soundcloud\.com\/[\w-]+\/([\w-]+)/);
    return match ? match[2] : null;
  }

  static extractPlaylistSlug(url) {
    const match = url.match(/^https?:\/\/(www\.)?soundcloud\.com\/[\w-]+\/sets\/([\w-]+)/);
    return match ? match[2] : null;
  }

  static async validateUrl(url) {
    try {
      if (!this.isSoundCloudURL(url)) {
        return false;
      }

      // yt-dlp로 URL 검증
      const info = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
      });
      return !!info && !!info.title;
    } catch (error) {
      return false;
    }
  }

  static formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}:${remainingMinutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
    } else {
      return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
    }
  }

  static createTrackUrl(username, trackSlug) {
    return `https://soundcloud.com/${username}/${trackSlug}`;
  }
}

module.exports = SoundCloud;
