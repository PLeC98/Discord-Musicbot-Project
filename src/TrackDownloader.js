"use strict";

const fs = require("fs").promises;
const log = require("./logger").child({ category: "track" });
const fsSync = require("fs");
const { spawnFfmpeg, probeDurationSec } = require("./ffmpegProcess");
const YouTube = require("./YouTube");
const TrackResolver = require("./TrackResolver");
const DirectLink = require("./DirectLink");
const CacheManager = require("./CacheManager");
const SponsorBlock = require("./SponsorBlock");

/**
 * TrackDownloader — 오디오 파일 다운로드/사전 로드
 *
 * 진행 중인 다운로드(downloadingFiles)만 player에 둔다 — 재생 경로와 예열이 같은 맵을 봐야 같은 곡을 두 번 받지 않는다.
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
        player.scheduleStatePersist("download-cache-hit", 500);
        return filepath;
      }
    }

    // 이미 다운로드 중이면 그 promise를 그대로 대기 — 폴링 불필요, 실패도 즉시 전파
    const inFlight = player.downloadingFiles.get(filepath);
    if (inFlight) {
      const file = await inFlight;
      player.scheduleStatePersist("download-wait-complete", 500);
      return file;
    }

    const downloadPromise = (async () => {
      try {
        return await this._performDownload(track, filepath);
      } catch (err) {
        // 캐시 매핑의 유튜브 영상이 내려간(삭제/비공개) 경우 → 스테일 매핑 폐기 후 재검색해 새 대상으로 1회 재시도.
        // (극히 드문 케이스. _youtubeFromCache가 false면 신규 검색이므로 재발동 안 함 → 무한루프 방지.)
        if (YouTube.isVideoUnavailableError(err) && track._youtubeFromCache) {
          log.warn(`⚠️ 캐시된 유튜브 영상 접근 불가 (${track.title}) — 재검색 후 재시도`);
          const fresh = await TrackResolver.reresolveYouTube(track, player.guild?.id);
          if (fresh) return await this._performDownload(track, this.trackFilePath(track));
        }
        throw err;
      }
    })();
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

      // videoId가 확정된 지점(preload 경로) — SponsorBlock 구간을 미리 확보해 재생 시 지연 0.
      // 실패해도 다운로드/재생을 막지 않는다(fail-open, 내부 타임아웃 보유).
      try {
        await SponsorBlock.ensureForTrack(track, player.guild?.id);
      } catch {
        /* 무시 */
      }

      // ⚠️ 라이브 스트림은 캐시 다운로드 대상이 아니다 — 끝이 없어서 yt-dlp가 ffmpeg를 외부 다운로더로
      //    띄운 뒤 무한히 파일을 불린다. 재생(스트리밍)은 정상 진행되므로 여기서만 끊는다.
      if (track.isLive) {
        throw new Error("라이브 스트림은 캐시 다운로드 대상이 아님");
      }

      // YouTube, Spotify(YouTube 경유), SoundCloud(YouTube 경유)는 youtube-dl-exec 사용
      if (track.platform === "youtube" || track.platform === "spotify" || track.platform === "soundcloud") {
        // 연령 제한 영상은 runYtDlp가 쿠키 폴백을 처리(대개 getStream/getInfo에서 이미 표시돼 실패 없이 쿠키 직행).
        await YouTube.runYtDlp(downloadUrl, (forceCookies) =>
          YouTube.getYtDlpOptions(
            {
              output: filepath,
              format: "bestaudio/best",
              preferFreeFormats: true,
              // 2차 방어선: track.isLive를 못 잡은 경우(캐시된 매핑 등)에도 yt-dlp가 스스로 라이브를 건너뛴다.
              // 걸리면 다운로드를 시작조차 하지 않으므로 ffmpeg가 아예 뜨지 않는다.
              matchFilter: "!is_live",
              postprocessorArgs: {
                ffmpeg: ["-c:a", "libopus", "-b:a", "128k"],
              },
              extractAudio: true,
              audioFormat: "opus",
            },
            { forceCookies },
          ),
        );

        // match-filter에 걸리면 yt-dlp는 "skipping" 후 정상 종료(exit 0)하고 파일을 남기지 않는다.
        // 아래 fs.stat이 ENOENT로 터지면 원인을 알 수 없으므로 여기서 명확한 오류로 바꾼다.
        if (!fsSync.existsSync(filepath)) {
          throw new Error("yt-dlp가 대상을 건너뜀 (라이브 스트림 등) — 캐시 다운로드 불가");
        }
      } else {
        // DirectLink는 SSRF 가드(SafeUrl)를 통과해 가져온 뒤 FFmpeg로 opus 트랜스코딩.
        // 즉시재생과 별개의 요청이므로 소비 시점에 track.url을 다시 가드 fetch 한다.
        const audioStream = await DirectLink.getStream(track.url, player.guild?.id);

        // opus로 트랜스코딩. 출력이 파일이므로 stdout을 소비하지 않는다(killOnStdoutClose 해제).
        const ffmpeg = spawnFfmpeg(["-loglevel", "error", "-i", "pipe:0", "-f", "opus", "-ar", "48000", "-ac", "2", "-b:a", "128k", "-y", filepath], "download", { killOnStdoutClose: false });

        audioStream.pipe(ffmpeg.stdin);

        await new Promise((resolve, reject) => {
          ffmpeg.on("exit", (code, signal) => {
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg 종료 (code=${code}, signal=${signal})`));
          });
          ffmpeg.on("error", reject);
        });

        // getInfo의 Content-Length 추정은 VBR에서 크게 어긋난다 — 받아둔 파일에서 실제 길이로 교정.
        // 여기서 고쳐야 재생 표시·진행바와 캐시에 저장되는 duration_sec이 함께 맞는다.
        const probed = await probeDurationSec(filepath);
        if (probed) {
          track.duration = probed;
          track.durationSource = "실측";
        }
      }

      // 파일 검증
      const stats = await fs.stat(filepath);
      if (stats.size === 0) {
        await fs.unlink(filepath).catch(() => {});
        throw new Error("Downloaded file is empty");
      }

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
      log.info(`💾 캐시 다운로드 완료: "${track.title}"${track.platform === "spotify" && track.youtubeUrl ? ` (yt: ${track.youtubeUrl})` : ""}`);
      player.scheduleStatePersist("download-complete", 500);
      return filepath;
    } catch (error) {
      // 중단·실패한 다운로드가 남긴 .part/프래그먼트/중간 파일을 즉시 치운다.
      // (지금까지 아무도 안 치웠다 — _cleanOrphanFiles는 .opus만 훑어서 부스러기가 영구 잔류했다.)
      // 그리고 recordDownloadStart로 'downloading'이 된 DB 행을 'error'로 되돌린다.
      // (없으면 다음 부팅의 onStartup 리셋 때까지 유령 'downloading' 행이 남는다.)
      try {
        const removed = CacheManager.cleanPartials(filepath);
        if (removed > 0) log.debug(`중단된 다운로드 잔해 ${removed}개 정리: ${track.title}`);
        if (audioSourceKey) CacheManager.recordError(audioSourceKey);
      } catch {
        /* 정리 실패는 원래 오류를 가리면 안 된다 */
      }
      log.error(`❌ Download failed for ${track.title}:`, error.message);
      throw error;
    }
  }

  /** 캐시 파일이 이미 준비돼 있는가. "받을 필요가 없다"의 유일한 근거다. */
  isCached(track) {
    try {
      const filepath = this.trackFilePath(track);
      return fsSync.existsSync(filepath) && fsSync.statSync(filepath).size > 0;
    } catch {
      return false;
    }
  }

  /**
   * 한 곡을 캐시에 올린다. QueueWarmer가 부르는 유일한 진입점.
   *
   * **받기 전에 캐시 키를 반드시 확정해야 한다.** 키가 곧 파일 경로이고, downloadTrack은
   * 진입 시점의 경로로 파일을 쓰기 때문이다. 스포티파이 트랙은 유튜브 동등물을 찾아야 키가
   * 정해지는데, 그 검색이 다운로드 '안'에서 일어나면 파일은 스포티파이 URL 해시 경로에
   * 저장되고 DB 행도 남지 않는다(키가 그 시점에 null이라). 그러면 키가 생긴 다음 번에
   * 같은 곡을 한 번 더 받는다.
   *
   * 나머지 판정 — 이미 받았는가 / 받는 중인가 — 은 downloadTrack이 갖고 있으므로 여기서
   * 다시 하지 않는다. 실패는 그대로 던져 호출자가 판단하게 둔다.
   */
  async warm(track) {
    if (!track || !track.url) return;
    if (!TrackResolver.ensureAudioSourceKey(track)) {
      await TrackResolver.findYouTubeEquivalent(track, this.player.guild?.id);
    }
    await this.downloadTrack(track);
  }
}

module.exports = TrackDownloader;
