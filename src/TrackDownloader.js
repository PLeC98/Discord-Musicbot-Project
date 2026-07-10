"use strict";

const fs = require("fs").promises;
const fsSync = require("fs");
const prism = require("prism-media");
const ffmpegPath = require("ffmpeg-static");
const YouTube = require("./YouTube");
const TrackResolver = require("./TrackResolver");
const DirectLink = require("./DirectLink");
const CacheManager = require("./CacheManager");

/**
 * TrackDownloader — 오디오 파일 다운로드/사전 로드
 *
 * 상태 필드(downloadedFiles, downloadingFiles, preloadedStreams, preloadingQueue)는 기존 외부 참조를 깨지 않도록 player 인스턴스에 유지.
 *
 * downloadingFiles는 Map<filepath, Promise<filepath>> — 진행 중인 다운로드의 promise를 그대로 await할 수 있어, 기존의 1초×60회 파일 존재 폴링과 타임아웃 경계 조건이 필요 없다.
 */
class TrackDownloader {
  constructor(player) {
    this.player = player;
  }

  /**
   * 트랙의 캐시 파일 경로 산출 — audioSourceKey가 없으면(스포티파이 미해석 등)
   * 소스 URL을 그대로 해시. getFilePath가 md5(입력)로 경로를 만들므로
   * 기존 인라인 폴백(track_md5(url).opus)과 동일한 경로가 나온다.
   */
  trackFilePath(track) {
    return CacheManager.getFilePath(track.audioSourceKey || track.url);
  }

  /**
   * 오디오 스트림을 로컬 파일로 다운로드합니다.
   * YouTube, Spotify, SoundCloud, DirectLink를 지원합니다.
   */
  async downloadTrack(track) {
    const player = this.player;
    const filepath = this.trackFilePath(track);

    // 이미 다운로드되었는지 확인 (캐시 적중)
    if (fsSync.existsSync(filepath)) {
      const stats = await fs.stat(filepath);
      if (stats.size > 0) {
        player.downloadedFiles.add(filepath);
        player.scheduleStatePersist("download-cache-hit", 500);
        return filepath;
      }
    }

    // 이미 다운로드 중이면 그 promise를 그대로 대기 — 폴링 불필요, 실패도 즉시 전파
    const inFlight = player.downloadingFiles.get(filepath);
    if (inFlight) {
      const file = await inFlight;
      player.downloadedFiles.add(file);
      player.scheduleStatePersist("download-wait-complete", 500);
      return file;
    }

    const downloadPromise = this._performDownload(track, filepath);
    player.downloadingFiles.set(filepath, downloadPromise);

    try {
      return await downloadPromise;
    } finally {
      player.downloadingFiles.delete(filepath);
    }
  }

  async _performDownload(track, filepath) {
    const player = this.player;
    const audioSourceKey = track.audioSourceKey;

    try {
      if (audioSourceKey) CacheManager.recordDownloadStart(audioSourceKey, track);

      // Spotify와 SoundCloud는 DRM 보호가 있어 직접 다운로드할 수 없음 —
      // 대응되는 YouTube 영상 URL을 사용 (검색·캐시는 TrackResolver 한 곳에서)
      let downloadUrl = track.url;

      if (track.platform === "spotify" || track.platform === "soundcloud") {
        downloadUrl = await TrackResolver.findYouTubeEquivalent(track, player.guild?.id);
        if (!downloadUrl) {
          throw new Error("Could not find YouTube equivalent");
        }
      }

      // YouTube, Spotify(YouTube 경유), SoundCloud(YouTube 경유)는 youtube-dl-exec 사용
      if (track.platform === "youtube" || track.platform === "spotify" || track.platform === "soundcloud") {
        const youtubedl = require("youtube-dl-exec");

        await youtubedl(
          downloadUrl,
          YouTube.getYtDlpOptions({
            output: filepath,
            format: "bestaudio/best",
            preferFreeFormats: true,
            postprocessorArgs: {
              ffmpeg: ["-c:a", "libopus", "-b:a", "128k"],
            },
            extractAudio: true,
            audioFormat: "opus",
          }),
        );
      } else {
        // DirectLink는 SSRF 가드(SafeUrl)를 통과해 가져온 뒤 FFmpeg로 opus 트랜스코딩.
        // 즉시재생과 별개의 요청이므로 소비 시점에 track.url을 다시 가드 fetch 한다.
        const audioStream = await DirectLink.getStream(track.url, player.guild?.id);

        // opus로 트랜스코딩
        const ffmpegProcess = new prism.FFmpeg({
          command: ffmpegPath,
          args: ["-i", "pipe:0", "-f", "opus", "-ar", "48000", "-ac", "2", "-b:a", "128k", "-y", filepath],
        });

        audioStream.pipe(ffmpegProcess);

        await new Promise((resolve, reject) => {
          ffmpegProcess.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg exited with code ${code}`));
          });
          ffmpegProcess.on("error", reject);
        });
      }

      // 파일 검증
      const stats = await fs.stat(filepath);
      if (stats.size === 0) {
        await fs.unlink(filepath).catch(() => {});
        throw new Error("Downloaded file is empty");
      }

      player.downloadedFiles.add(filepath);
      // 완료된 다운로드를 DB에 저장
      if (audioSourceKey) {
        try {
          const _finalSt = fsSync.statSync(filepath);
          CacheManager.recordDownloadComplete(audioSourceKey, filepath, _finalSt.size, track);
          CacheManager.recordTrackLookup(track.url, track.platform, audioSourceKey, track.title, track.artist, track.thumbnail);
        } catch {
          /* 무시 */
        }
      }
      player.scheduleStatePersist("download-complete", 500);
      return filepath;
    } catch (error) {
      console.error(`❌ Download failed for ${track.title}:`, error.message);
      throw error;
    }
  }

  /**
   * 다운로드한 오디오 파일을 삭제합니다.
   */
  async deleteDownloadedFile(filepath) {
    const player = this.player;
    if (!filepath) return;

    try {
      await fs.unlink(filepath);
      player.downloadedFiles.delete(filepath);
      player.scheduleStatePersist("download-removed", 500);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error(`❌ Failed to delete file ${filepath}:`, error.message);
      }
    }
  }

  /**
   * 트랙을 사전 로드합니다 — 스트림 해석 후 백그라운드 다운로드까지 완료.
   */
  async preloadTrack(track) {
    const player = this.player;
    if (!track || !track.url) return;

    // 파일 조회용 audioSourceKey 계산 (spotify는 YouTube 검색 후 getStream 내부에서 해석됨)
    TrackResolver.ensureAudioSourceKey(track);
    const filepath = this.trackFilePath(track);

    if (fsSync.existsSync(filepath)) {
      const stats = fsSync.statSync(filepath);
      if (stats.size > 0) {
        return; // 이미 다운로드됨
      }
    }

    // 이미 사전 로드/다운로드 중인지 확인 (downloadingFiles 맵 포함)
    if (player.preloadedStreams.has(track.url) || player.preloadingQueue.includes(track.url) || player.downloadingFiles.has(filepath)) {
      return;
    }

    player.preloadingQueue.push(track.url);

    try {
      // 스트림 획득 (플랫폼 스위치·Spotify→YouTube 변환은 TrackResolver 한 곳에서)
      const streamInfo = await TrackResolver.getStream(track, player.guild.id);

      if (streamInfo) {
        // 백그라운드에서 트랙 다운로드 (다운로드 URL은 track에서 파생 — streamInfo는 프리로드 캐시용)
        await this.downloadTrack(track);

        // 사전 로드됨으로 표시
        player.preloadedStreams.set(track.url, {
          info: streamInfo,
          track: track,
          downloaded: true,
        });
      }
    } catch (error) {
      if (error && error.message) {
        console.error(`❌ Pre-download failed for ${track.title}:`, error.message);
      }
    } finally {
      // 사전 로드 대기열에서 제거
      const index = player.preloadingQueue.indexOf(track.url);
      if (index > -1) player.preloadingQueue.splice(index, 1);
    }
  }
}

module.exports = TrackDownloader;
