const path = require('path');
const fs = require('fs');
const youtubedl = require('youtube-dl-exec');
const config = require('../config');

const BGUTIL_PLUGIN_DIR = path.join(__dirname, '..', 'bgutil-ytdlp-pot-provider', 'plugin');
const BGUTIL_AVAILABLE  = fs.existsSync(BGUTIL_PLUGIN_DIR);


class YouTube {
    // yt-dlp için ortak parametreleri döndüren yardımcı fonksiyon
    static getYtDlpOptions(extraOptions = {}) {
        const baseOptions = {
            noCheckCertificates: true,
            noWarnings: true,
            retries: 3,
            fragmentRetries: 3,
            jsRuntimes: `node:${process.execPath}`,
            addHeader: [
                'referer:youtube.com',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ],
            ...(BGUTIL_AVAILABLE && { pluginDirs: BGUTIL_PLUGIN_DIR }),
            ...extraOptions
        };

        // 인증 우선순위: 쿠키(브라우저) > 쿠키(파일) > iOS client (fallback)
        // POToken은 bgutil 플러그인이 자동 처리
        if (config.ytdl.cookiesFromBrowser) {
            baseOptions.cookiesFromBrowser = config.ytdl.cookiesFromBrowser;
        } else if (config.ytdl.cookiesFile) {
            baseOptions.cookies = config.ytdl.cookiesFile;
        } else {
            baseOptions.extractorArgs = 'youtube:player_client=ios';
        }

        return baseOptions;
    }

    static async search(query, limit = 1, guildId = null) {
        try {
            // If it's already a YouTube URL, get info directly
            if (this.isYouTubeURL(query)) {
                const info = await this.getInfo(query, guildId);
                return info ? [info] : [];
            }

            // Use yt-dlp for YouTube search
            const searchQuery = `ytsearch${limit}:${query}`;

            const results = await youtubedl(searchQuery, this.getYtDlpOptions({
                dumpSingleJson: true,
                flatPlaylist: true,
            }));

            if (!results || !results.entries) {

                return [];
            }

            const tracks = [];
            for (const item of results.entries.slice(0, limit)) {
                try {
                    // Debug: log item structure


                    const unknownTitle = '알 수 없는 제목';
                    const unknownArtist = '알 수 없는 아티스트';

                    const track = {
                        title: item.title || item.fulltitle || unknownTitle,
                        artist: item.uploader || item.channel || unknownArtist,
                        url: item.webpage_url || item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : null),
                        duration: item.duration || 0,
                        thumbnail: item.thumbnail || item.thumbnails?.[0]?.url,
                        platform: 'youtube',
                        type: 'track',
                        id: item.id,
                        views: item.view_count,
                        uploadDate: item.upload_date,
                        description: item.description,
                    };

                    // If duration is missing from search, try to get it from getInfo
                    if (!track.duration || track.duration === 0) {

                        const detailedInfo = await this.getInfo(track.url, guildId);
                        if (detailedInfo && detailedInfo.duration) {
                            track.duration = detailedInfo.duration;

                        }
                    }

                    tracks.push(track);
                } catch (error) {
                    continue;
                }
            }


            return tracks;

        } catch (error) {
            console.error('[YouTube] search() failed:', error.message || error);
            return [];
        }
    }

    static async getInfo(url, guildId = null) {
        try {

            const info = await youtubedl(url, this.getYtDlpOptions({
                dumpSingleJson: true,
                preferFreeFormats: true,
            }));

            if (!info) {
                throw new Error('youtube-dl에서 정보를 반환하지 않음');
            }

            const unknownTitle = '알 수 없는 제목';
            const unknownArtist = '알 수 없는 아티스트';

            const track = {
                title: info.title || unknownTitle,
                artist: info.uploader || info.channel || unknownArtist,
                url: info.webpage_url || url,
                duration: info.duration || 0,
                thumbnail: info.thumbnail || info.thumbnails?.[0]?.url,
                platform: 'youtube',
                type: 'track',
                id: info.id,
                views: info.view_count,
                uploadDate: info.upload_date,
                description: info.description,
                formats: info.formats,
            };

            return track;

        } catch (error) {
            console.error('[YouTube] getInfo() failed:', error.message || error);
            return null;
        }
    }

    static async getStream(url, guildId = null, startSeconds = 0) {
        try {

            if (!url) {
                throw new Error('URL이 필요함');
            }

            // Get stream URL with simple format
            const info = await youtubedl(url, this.getYtDlpOptions({
                dumpSingleJson: true,
                format: 'bestaudio/best',
            }));

            if (!info || !info.url) {
                throw new Error('스트림 URL을 찾을 수 없음');
            }

            const baseUrl = info.url;
            const canSeek = /googlevideo\.com/i.test(baseUrl);
            let finalUrl = baseUrl;

            const seekSeconds = Math.max(0, Number(startSeconds) || 0);
            if (seekSeconds > 0 && canSeek) {
                const startMs = Math.floor(seekSeconds * 1000);
                const separator = baseUrl.includes('?') ? '&' : '?';
                finalUrl = `${baseUrl}${separator}begin=${startMs}`;
            }

            return {
                url: finalUrl,
                rawUrl: baseUrl,
                type: info.acodec && info.acodec.includes('opus') ? 'opus' : 'arbitrary',
                duration: info.duration || 0,
                bitrate: info.abr || info.tbr || 0,
                canSeek,
                format: info.format,
                httpHeaders: info.http_headers || {}
            };

        } catch (error) {
            throw error;
        }
    }

    static async getPlaylist(url, guildId = null) {
        try {

            const info = await youtubedl(url, this.getYtDlpOptions({
                dumpSingleJson: true,
                flatPlaylist: true,
            }));

            if (!info) {
                throw new Error('재생목록 정보를 가져올 수 없음');
            }

            if (!info.entries || info.entries.length === 0) {
                throw new Error('재생목록 항목을 찾을 수 없음');
            }

            const unknownTitle = '알 수 없는 제목';
            const unknownArtist = '알 수 없는 아티스트';

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
                            platform: 'youtube',
                            type: 'track',
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
                throw new Error('재생목록에서 유효한 트랙을 찾을 수 없음');
            }

            const unknownPlaylist = '알 수 없는 재생목록';

            return {
                title: info.title || unknownPlaylist,
                tracks: tracks,
                totalTracks: info.playlist_count || tracks.length,
                url: url,
                platform: 'youtube',
                type: 'playlist',
            };

        } catch (error) {
            console.error('[YouTube] getPlaylist() failed:', error.message || error);
            return null;
        }
    }

    static isYouTubeURL(url) {
        const patterns = [
            /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/playlist\?list=)/,
            /^https?:\/\/(www\.)?youtube\.com\/embed\/[a-zA-Z0-9_-]+/,
            /^https?:\/\/(www\.)?youtube\.com\/v\/[a-zA-Z0-9_-]+/,
            /^https?:\/\/(www\.)?youtube\.com\/shorts\/[a-zA-Z0-9_-]+/,
        ];
        return patterns.some(pattern => pattern.test(url));
    }

    static isPlaylist(url) {
        return url.includes('list=') &&
            (url.includes('youtube.com/playlist') ||
                url.includes('youtube.com/watch') ||
                url.includes('youtu.be'));
    }

    static parseDuration(durationString) {
        if (!durationString) return 0;

        // Handle formats like "3:45", "1:23:45", etc.
        const parts = durationString.split(':').reverse();
        let seconds = 0;

        for (let i = 0; i < parts.length; i++) {
            seconds += parseInt(parts[i]) * Math.pow(60, i);
        }

        return seconds;
    }

    static formatDuration(seconds) {
        if (!seconds || seconds === 0) return '0:00';

        // Ensure we work with integers to avoid floating point errors
        const totalSeconds = Math.floor(Number(seconds) || 0);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const remainingSeconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
    }

    static async getRelatedVideos(videoId, limit = 5) {
        try {
            // This would implement getting related videos
            // For now, return empty array as YouTube API v3 doesn't provide related videos

            return [];
        } catch (error) {
            return [];
        }
    }

    static extractVideoId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/,
            /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
            /youtube\.com\/v\/([a-zA-Z0-9_-]+)/,
            /youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/,
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }

        return null;
    }

    static extractPlaylistId(url) {
        const match = url.match(/[&?]list=([a-zA-Z0-9_-]+)/);
        return match ? match[1] : null;
    }

    static createThumbnailUrl(videoId, quality = 'maxresdefault') {
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

            // Try to get basic info to validate
            const info = await youtubedl(url, this.getYtDlpOptions({
                dumpSingleJson: true,
                skipDownload: true,
            }));

            return !!info && !!info.title;
        } catch (error) {
            return false;
        }
    }
}

module.exports = YouTube;