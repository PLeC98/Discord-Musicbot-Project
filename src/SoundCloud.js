// youtube-dl-exec 직접 호출 금지 — spawn된 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
const youtubedl = require("./ytdlp");
const config = require("../config");

class SoundCloud {
  // SoundCloud는 더 이상 클라이언트 ID가 필요 없으므로 yt-dlp를 직접 사용

  static async search(query, limit = 1, guildId = null) {
    try {
      // 이미 SoundCloud URL이면 직접 정보 가져오기
      if (this.isSoundCloudURL(query)) {
        const info = await this.getInfo(query, guildId);
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
            const track = await this.formatTrack(item, guildId);
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

  static async getInfo(url, guildId = null) {
    try {
      // yt-dlp로 SoundCloud 정보 가져오기
      const info = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
      });

      if (!info) {
        throw new Error("SoundCloud에서 정보를 반환하지 않음");
      }

      const track = await this.formatTrack(info, guildId);

      return track;
    } catch (error) {
      return null;
    }
  }

  static async getStream(url, _guildId = null, _startSeconds = 0) {
    // yt-dlp로 오디오 스트림 가져오기
    const result = await youtubedl(url, {
      format: "bestaudio/best",
      getUrl: true,
      noWarnings: true,
    });

    if (!result) {
      throw new Error("스트림 URL을 찾을 수 없음");
    }

    // 참고: SoundCloud 스트림은 일반적으로 URL 매개변수를 통한 탐색을 지원하지 않음
    // 탐색은 MusicPlayer의 FFmpeg가 처리
    return result;
  }

  static async getPlaylist(url, guildId = null) {
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
      for (const item of result.entries.slice(0, config.bot.maxPlaylistSize)) {
        const formattedTrack = await this.formatTrack(item, guildId);
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

  static async getUserTracks(userUrl, limit = 10, guildId = null) {
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
        const formattedTrack = await this.formatTrack(item, guildId);
        if (formattedTrack) {
          tracks.push(formattedTrack);
        }
      }

      return tracks;
    } catch (error) {
      return [];
    }
  }

  static async formatTrack(soundcloudTrack, _guildId = null) {
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
    const patterns = [
      /^https?:\/\/(www\.|m\.)?soundcloud\.com\/[\w-]+\/[\w-]+/,
      /^https?:\/\/(www\.|m\.)?soundcloud\.com\/[\w-]+\/sets\/[\w-]+/,
      /^https?:\/\/(www\.|m\.)?soundcloud\.com\/[\w-]+$/,
      // 모바일 앱 공유용 짧은 링크 (yt-dlp가 리디렉션을 따라감)
      /^https?:\/\/on\.soundcloud\.com\/[\w-]+/,
    ];
    return patterns.some((pattern) => pattern.test(url));
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

  static createPlaylistUrl(username, playlistSlug) {
    return `https://soundcloud.com/${username}/sets/${playlistSlug}`;
  }

  static createUserUrl(username) {
    return `https://soundcloud.com/${username}`;
  }

  static async getRelatedTracks(_trackUrl, _limit = 5) {
    // 여기에 관련 트랙 가져오기 구현 가능. 복잡한 구현이 필요하므로 현재는 빈 배열 반환.
    return [];
  }

  static async searchAdvanced(query, options = {}, guildId = null) {
    // yt-dlp를 사용한 고급 검색 (간소화).
    try {
      return await this.search(query, options.limit || 20, guildId);
    } catch (error) {
      return [];
    }
  }
}

module.exports = SoundCloud;
