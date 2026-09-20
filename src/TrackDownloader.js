"use strict";

const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
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
 * 진행 중인 다운로드는 **프로세스 전역**으로 모은다(inFlight). 재생 경로와 예열뿐 아니라 서버끼리도 같은 맵을 봐야
 * 같은 곡을 두 번 받지 않는다 — 캐시 파일 경로는 서버와 무관한 전역 경로다.
 *
 * Map<최종 경로, Promise<최종 경로>> — 진행 중인 다운로드의 promise를 그대로 await할 수 있어, 파일 존재 폴링이 필요 없다.
 *
 * 받는 동안에는 자기 임시 파일에만 쓰고 끝난 뒤 최종 경로로 옮긴다. 그래야 같은 곡이 어찌어찌 겹쳐도
 * 서로의 작업 파일에 쓰지 않고, 실패 정리가 남의 파일을 지우지 않는다.
 */
const inFlight = new Map(); // 최종 경로 → Promise<최종 경로>. 프로세스 전역 — 서버가 달라도 같은 곡은 한 번만 받는다.

/** 내 임시 경로 — 같은 폴더여야 옮기기가 원자적이고, .opus여야 yt-dlp가 확장자를 바꾸지 않는다 */
function tempPathFor(filepath) {
  const stem = path.basename(filepath, ".opus");
  return path.join(path.dirname(filepath), `${stem}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}.opus`);
}

/** 내 임시 파일과 그 부스러기(.part·조각·info.json)만 지운다 — 남이 받는 중인 파일은 건드리지 않는다 */
function cleanTemp(tempPath) {
  const dir = path.dirname(tempPath);
  const stem = path.basename(tempPath, ".opus");
  let removed = 0;
  let names;
  try {
    names = fsSync.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (name !== path.basename(tempPath) && !name.startsWith(`${stem}.`)) continue;
    try {
      fsSync.unlinkSync(path.join(dir, name));
      removed++;
    } catch {
      /* 아직 잠겨 있거나 이미 없음 — 기동 스윕이 처리 */
    }
  }
  return removed;
}

/**
 * 다 받은 임시 파일을 최종 경로로 올린다. 그 사이 다른 쪽이 먼저 끝냈으면 내 것을 버린다.
 *
 * 올리기 전에 최종 경로를 보호한다 — 옮긴 직후부터 DB에 기록되기 전까지는 DB에도 없는 파일이라
 * 그 순간 기동 스윕이 돌면 고아로 보고 지운다. 푸는 것은 받기가 끝날 때(_performDownload의 finally).
 */
async function publish(tempPath, filepath) {
  if (fsSync.existsSync(filepath) && fsSync.statSync(filepath).size > 0) {
    await fs.unlink(tempPath).catch(() => {});
    return false;
  }
  CacheManager.protectFile(filepath);
  await fs.rename(tempPath, filepath);
  return true;
}

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
    const filepath = this.trackFilePath(track);

    // 이미 다운로드되었는지 확인 (캐시 적중)
    if (fsSync.existsSync(filepath)) {
      const stats = await fs.stat(filepath);
      if (stats.size > 0) {
        return filepath;
      }
    }

    // 이미 다운로드 중이면 그 promise를 그대로 대기 — 폴링 불필요, 실패도 즉시 전파
    const running = inFlight.get(filepath);
    if (running) return await running;

    const downloadPromise = (async () => {
      try {
        return await this._performDownload(track, filepath);
      } catch (err) {
        // 캐시 매핑의 유튜브 영상이 내려간(삭제/비공개) 경우 → 스테일 매핑 폐기 후 재검색해 새 대상으로 1회 재시도.
        // (극히 드문 케이스. _youtubeFromCache가 false면 신규 검색이므로 재발동 안 함 → 무한루프 방지.)
        if (YouTube.isVideoUnavailableError(err) && track._youtubeFromCache) {
          log.warn({ tags: ["retry"] }, `캐시된 유튜브 영상 접근 불가 (${track.title}) — 재검색 후 재시도`);
          const fresh = await TrackResolver.reresolveYouTube(track);
          if (fresh) return await this._performDownload(track, this.trackFilePath(track));
        }
        throw err;
      }
    })();
    inFlight.set(filepath, downloadPromise);

    try {
      return await downloadPromise;
    } finally {
      if (inFlight.get(filepath) === downloadPromise) inFlight.delete(filepath);
    }
  }

  async _performDownload(track, filepath) {
    const player = this.player;
    const audioSourceKey = track.audioSourceKey;
    let verifiedTitle = null;
    let audioDurationSec = null; // 캐시에 남길 오디오 길이 — track.duration은 요청 쪽 메타데이터라 오디오와 다를 수 있다
    const tempPath = tempPathFor(filepath); // 다 받은 뒤 최종 경로로 옮긴다
    CacheManager.protectFile(tempPath); // 기동 스윕이 받는 중인 파일을 고아로 보고 지우지 않게

    try {
      if (audioSourceKey) CacheManager.recordDownloadStart(audioSourceKey, track);

      // Spotify와 SoundCloud는 DRM 보호가 있어 직접 다운로드할 수 없음 —
      // 대응되는 YouTube 영상 URL을 사용 (검색·캐시는 TrackResolver 한 곳에서)
      //
      // 자동재생이 출처에서 받아 온 곡(Last.fm·LB Radio·VocaDB·AnimeThemes)도 같은 처지다.
      // 다만 그쪽은 영상을 이미 찾아 두었으므로 다시 찾지 않는다.
      let downloadUrl = track.youtubeUrl || track.url;

      if (!track.youtubeUrl && (track.platform === "spotify" || track.platform === "soundcloud")) {
        downloadUrl = await TrackResolver.findYouTubeEquivalent(track);
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

      // YouTube, Spotify(YouTube 경유), SoundCloud(YouTube 경유), 그리고 영상을 찾아 둔 자동재생
      // 출처 트랙은 youtube-dl-exec 사용. 남는 것은 직접 링크뿐이다.
      if (track.youtubeUrl || track.platform === "youtube" || track.platform === "spotify" || track.platform === "soundcloud") {
        // 연령 제한 영상은 runYtDlp가 쿠키 폴백을 처리(대개 getStream/getInfo에서 이미 표시돼 실패 없이 쿠키 직행).
        await YouTube.runYtDlp(downloadUrl, (forceCookies) =>
          YouTube.getYtDlpOptions(
            {
              output: tempPath,
              // 이 다운로드에 곁들여 메타데이터를 파일로 받는다 — 왕복이 늘지 않는다.
              // stdout으로 받는 --print는 쓸 수 없다: yt-dlp가 시스템 코드페이지로 써서
              // 일본어·한국어 제목이 깨지고(실측 cp949), PYTHONIOENCODING으로도 안 바뀐다.
              // 파일은 UTF-8로 쓰이므로 어느 환경에서나 안전하다.
              writeInfoJson: true,
              format: "bestaudio/best",
              preferFreeFormats: true,
              // 2차 방어선: track.isLive를 못 잡은 경우(캐시된 매핑 등)에도 yt-dlp가 스스로 라이브를 건너뛴다.
              // 걸리면 다운로드를 시작조차 하지 않으므로 ffmpeg가 아예 뜨지 않는다.
              matchFilter: "!is_live",
              // 코덱은 yt-dlp 가 소스를 보고 정한다 — 이미 Opus 면 리먹싱, 아니면 libopus.
              // 여기서 코덱을 못 박으면 그 판단을 덮어 251 까지 다시 인코딩된다.
              // `-b:a` 는 스트림 카피에 무시되므로 두 경우 모두 맞는다.
              postprocessorArgs: {
                ffmpeg: ["-b:a", "128k"],
              },
              extractAudio: true,
              audioFormat: "opus",
            },
            { forceCookies },
          ),
        );

        // match-filter에 걸리면 yt-dlp는 "skipping" 후 정상 종료(exit 0)하고 파일을 남기지 않는다.
        // 아래 fs.stat이 ENOENT로 터지면 원인을 알 수 없으므로 여기서 명확한 오류로 바꾼다.
        if (!fsSync.existsSync(tempPath)) {
          throw new Error("yt-dlp가 대상을 건너뜀 (라이브 스트림 등) — 캐시 다운로드 불가");
        }

        const info = this._takeInfoJson(tempPath);
        verifiedTitle = info.title;
        audioDurationSec = info.durationSec;
      } else {
        // DirectLink는 SSRF 가드(SafeUrl)를 통과해 가져온 뒤 FFmpeg로 opus 트랜스코딩.
        // 즉시재생과 별개의 요청이므로 소비 시점에 track.url을 다시 가드 fetch 한다.
        const audioStream = await DirectLink.getStream(track.url);

        // opus로 트랜스코딩. 출력이 파일이므로 stdout을 소비하지 않는다(killOnStdoutClose 해제).
        const ffmpeg = spawnFfmpeg(["-loglevel", "error", "-i", "pipe:0", "-f", "opus", "-ar", "48000", "-ac", "2", "-b:a", "128k", "-y", tempPath], "download", { killOnStdoutClose: false });

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
        const probed = await probeDurationSec(tempPath);
        if (probed) {
          track.duration = probed;
          track.durationSource = "실측";
          audioDurationSec = probed;
        }
      }

      // 파일 검증 — 최종 경로로 올리기 전에
      const stats = await fs.stat(tempPath);
      if (stats.size === 0) {
        await fs.unlink(tempPath).catch(() => {});
        throw new Error("Downloaded file is empty");
      }
      const mine = await publish(tempPath, filepath);
      if (!mine) log.debug(`다른 쪽이 먼저 받아 둔 캐시를 쓴다: "${track.title}"`);

      // 유튜브 트랙만 제목을 교정한다. 스포티파이 트랙의 유튜브 동등물 제목은 다른 문자열이고
      // (「(Official Video)」 등이 붙는다), 사용자가 넣은 것은 스포티파이 곡이므로 표시는 그쪽이 맞다.
      if (verifiedTitle && track.platform === "youtube" && verifiedTitle !== track.title) {
        log.debug(`제목 교정: "${track.title}" → "${verifiedTitle}"`);
        track.title = verifiedTitle;
      }

      // 완료된 다운로드를 DB에 저장
      if (audioSourceKey) {
        try {
          const _finalSt = fsSync.statSync(filepath);
          CacheManager.recordDownloadComplete(audioSourceKey, filepath, _finalSt.size, track, { durationSec: audioDurationSec });
          CacheManager.recordTrackLookup(track.url, track.platform, audioSourceKey, track.title, track.artist, track.thumbnail, { verified: !!verifiedTitle && track.platform === "youtube" });
        } catch {
          /* 무시 */
        }
      }
      // 출처가 따로 있는 트랙은 어느 영상에서 소리를 가져왔는지 같이 남긴다 — 스포티파이만이 아니다
      log.info(`캐시 다운로드 완료: "${track.title}"${track.youtubeUrl && track.platform !== "youtube" ? ` (yt: ${track.youtubeUrl})` : ""}`);
      return filepath;
    } catch (error) {
      // 중단·실패한 다운로드가 남긴 .part/프래그먼트/중간 파일을 즉시 치운다 — **내 임시 파일만**.
      // (같은 곡의 부스러기를 전부 훑으면 다른 쪽이 받는 중인 작업 파일을 지운다.)
      // 그리고 recordDownloadStart로 'downloading'이 된 DB 행을 'error'로 되돌린다.
      // (없으면 다음 부팅의 onStartup 리셋 때까지 유령 'downloading' 행이 남는다.)
      try {
        const removed = cleanTemp(tempPath);
        if (removed > 0) log.debug(`캐시 다운로드 중단으로 생성된 조각 파일 ${removed}개 정리: ${track.title}`);
        if (audioSourceKey) CacheManager.recordError(audioSourceKey);
      } catch {
        /* 정리 실패는 원래 오류를 가리면 안 된다 */
      }
      log.error(`캐시 다운로드 실패 ("${track.title}"):`, error.message);
      throw error;
    } finally {
      CacheManager.unprotectFile(tempPath);
      CacheManager.unprotectFile(filepath);
    }
  }

  /**
   * 다운로드가 곁들여 남긴 info.json에서 제목과 오디오 길이를 꺼내고 파일을 치운다.
   *
   * yt-dlp는 출력 템플릿의 확장자를 벗기지 않고 `.info.json`을 덧붙이므로 `<파일>.info.json`이
   * 되지만, 버전에 따라 확장자를 바꾼 형태로 쓸 수도 있어 둘 다 본다.
   * 실패해도 다운로드 자체는 성공한 것이므로 모르는 값은 null로 돌려준다.
   * @returns {{title: string|null, durationSec: number|null}}
   */
  _takeInfoJson(filepath) {
    const candidates = [`${filepath}.info.json`, filepath.replace(/\.opus$/, "") + ".info.json"];
    for (const p of candidates) {
      try {
        if (!fsSync.existsSync(p)) continue;
        const info = JSON.parse(fsSync.readFileSync(p, "utf8"));
        fsSync.unlinkSync(p);
        return {
          title: typeof info?.title === "string" && info.title.trim() ? info.title : null,
          durationSec: Number(info?.duration) > 0 ? Number(info.duration) : null,
        };
      } catch {
        try {
          fsSync.unlinkSync(p);
        } catch {
          /* 남아도 부팅 스윕이 치운다 */
        }
      }
    }
    return { title: null, durationSec: null };
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
      await TrackResolver.findYouTubeEquivalent(track);
    }
    await this.downloadTrack(track);
  }
}

/** 이 경로를 지금 받고 있는가 — 서버와 무관하다 */
TrackDownloader.isDownloading = (filepath) => inFlight.has(filepath);

/** 받는 중이면 그 promise, 아니면 null */
TrackDownloader.waitFor = (filepath) => inFlight.get(filepath) ?? null;

module.exports = TrackDownloader;
module.exports._internals = { inFlight, tempPathFor, cleanTemp, publish };
