import { codedError } from "../rules/error-kind.ts";
import config from "../config/index.ts";
import fsModule from "fs";
const fs = fsModule.promises;
import path from "path";
import crypto from "crypto";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "track" });
import fsSync from "fs";
import { pipeline } from "stream/promises";
import * as audioConvert from "./convert.ts";
import { probeDurationSec } from "./ffmpeg/process.ts";
import { shownDuration } from "../rules/duration-shown.ts";
import * as versionOf from "./audio-version.ts";
import { readInfo } from "../sources/ytdlp-info.ts";
import * as YouTube from "../sources/youtube/index.ts";
import * as equivalent from "../sources/youtube/equivalent.ts";
import { openDirectInput, type DirectInput } from "./direct-input.ts";
import { applyTags } from "../sources/direct-tags.ts";
import * as Tags from "../sources/file-tags.ts";
import { bakeCover, type Cover } from "../sources/cover.ts";
import * as embeddedArt from "../sources/embedded-art.ts";
import type { CacheTags } from "./convert.ts";
import type { TagInfo } from "../rules/track-tags.ts";
import * as SoundCloud from "../sources/soundcloud/index.ts";
import * as audioCache from "../store/audio-cache.ts";
import * as trackLookup from "../store/track-lookup.ts";
import * as SponsorBlock from "../sources/sponsor-block.ts";
import { leaveDeadPin } from "../sources/pinned-fallback.ts";
import { inputKind } from "../rules/input-kind.ts";
import { audioKeyOf } from "../rules/audio-key-of.ts";
import type { TrackInfo } from "../player/track.ts";

/** 다운로드하는 곡. 제목과 요청 키 말고는 없을 수 있다. 담은 곡(TrackInfo)이 그대로 맞는다 */
type DownloadTrack = Pick<TrackInfo, "title" | "requestKey"> & Partial<TrackInfo>;
/** 음원 주소만 보는 판정 */
type HasAudio = Partial<TrackInfo> | null | undefined;
import { bestEffort } from "../infra/best-effort.ts";
import { logTitle } from "../infra/log/title.ts";
import { addDownloaded } from "../infra/download-meter.ts";

// 다운로드에 부르는 소스와 변환에서 여기서 부르는 필드만
type Sources = {
  youtube: Pick<typeof YouTube, "downloadAudio" | "getYtDlpOptions">;
  soundcloud: Pick<typeof SoundCloud, "download">;
  direct: { getStream(url: string): Promise<DirectInput> };
  convert: { toCacheOpus(srcFile: string, outFile: string, cache?: CacheTags): Promise<{ durationSec: number | null }> };
  tags: { fromFile(file: string): Promise<(TagInfo & { picture?: { data: Uint8Array } | null }) | null> };
  measure: { durationSec(file: string): Promise<number | null> };
  sponsor: { forTrack(track: DownloadTrack, guildId: string): Promise<unknown> };
  equivalent: { findYouTubeEquivalent(track: DownloadTrack, opts?: { skipPin?: boolean }): Promise<string | null>; reresolveYouTube(track: DownloadTrack): Promise<string | null> };
};
/** 다운로드하는 쪽 플레이어에서 읽는 필드 */
type Owner = { guild: { id: string }; currentTrack?: unknown };
/**
 * TrackDownloader. 오디오 파일 다운로드/사전 로드
 *
 * 진행 중인 다운로드는 프로세스 전역으로 모은다(inFlight). 재생 경로와 예열뿐 아니라 서버끼리도 같은 맵을 봐야
 * 같은 곡을 두 번 다운로드하지 않는다. 캐시 파일 경로는 서버와 무관한 전역 경로다.
 *
 * Map<최종 경로, Promise<최종 경로>>. 진행 중인 다운로드의 promise를 그대로 await할 수 있어, 파일 존재 폴링이 필요 없다.
 *
 * 다운로드하는 동안에는 자기 임시 파일에만 쓰고 끝난 뒤 최종 경로로 옮긴다. 그래야 같은 곡이 어찌어찌 겹쳐도
 * 서로의 작업 파일에 쓰지 않고, 실패 정리가 남의 파일을 삭제하지 않는다.
 */
const inFlight = new Map<string, Promise<string>>(); // 최종 경로 → Promise<최종 경로>. 프로세스 전역. 서버가 달라도 같은 곡은 한 번만 다운로드한다.

/**
 * 이 트랙은 음원을 남에게서 빌려 와야 하는가. 음원 주소가 없는 곡, 곧 영상을 아직 못 찾은 스포티파이 곡뿐이다.
 *
 * 사운드클라우드는 DRM 이 없고 제 음원을 주므로 여기 해당하지 않는다. 묶어 두면 `sc:` 키 안에
 * 유튜브 음원이 들어가, 같은 곡이 처음 틀 때와 캐시로 틀 때 서로 다른 녹음이 된다.
 * 조건문 안에 묻어 두면 다시 끼워 넣게 되므로 규칙에 이름을 준다.
 */
function needsBorrowedAudio(track: HasAudio): boolean {
  return !!track && !track.audioUrl;
}

/** 내 임시 경로. 같은 폴더여야 옮기기가 원자적이고, .opus여야 yt-dlp가 확장자를 바꾸지 않는다 */
function tempPathFor(filepath: string): string {
  const stem = path.basename(filepath, ".opus");
  return path.join(path.dirname(filepath), `${stem}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}.opus`);
}

/** 내 임시 파일과 그 부스러기(.part·조각·info.json)만 삭제한다. 남이 다운로드 중인 파일은 건드리지 않는다 */
function cleanTemp(tempPath: string): number {
  const dir = path.dirname(tempPath);
  let removed = 0;
  let names: string[];
  try {
    names = fsSync.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!audioCache.isTempPiece(name, path.basename(tempPath))) continue;
    try {
      fsSync.unlinkSync(path.join(dir, name));
      removed++;
    } catch {
      /* 아직 잠겨 있거나 이미 없음. 기동 스윕이 처리 */
    }
  }
  return removed;
}

/**
 * 다운로드가 끝난 임시 파일을 최종 경로로 올린다. 그 사이 다른 쪽이 먼저 끝냈으면 내 것을 버린다.
 *
 * 올리기 전에 최종 경로를 보호한다. 옮긴 직후부터 DB에 기록되기 전까지는 DB에도 없는 파일이라
 * 그 순간 기동 스윕이 돌면 고아로 보고 삭제한다. 푸는 것은 다운로드가 끝날 때(_performDownload의 finally).
 */
/**
 * 다운로드한 것. verifiedTitle: 영상 자체의 제목(유튜브만) · tags: 받은 파일의 태그(직접 링크만) · audioDurationSec: 캐시에 남길 오디오 길이(track.duration은 요청 쪽
 * 메타데이터라 오디오와 다를 수 있다) · audioVersion: 다운로드한 음원의 버전(같은 주소에서 음원이 바뀐 것을 알아볼 값, audio-version.ts)
 */
// how: 어떻게 다운로드했나(로그 한 줄). 걸린 시간 · 포맷 · 옮겼나 구웠나
type Fetched = { verifiedTitle: string | null; tags?: TagInfo | null; cover?: Cover | null; audioDurationSec: number | null; audioVersion: string | null; how: string };

const secs = (ms: number) => (ms / 1000).toFixed(1);
// 다운로드한 포맷(로그용). info.json 의 필드
const formatOf = (info: { format_id?: string | null; protocol?: string | null; acodec?: string | null } | null | undefined) => ({ formatId: info?.format_id ?? null, protocol: info?.protocol ?? null, acodec: info?.acodec ?? null });
// yt-dlp 가 파일을 다 쓴 뒤 이보다 늦게 끝났으면 적는다(다운로드 · 굽기와 따로 걸린 시간)
const LINGER_LOG_MS = 5_000;

// 유튜브 트랙만 영상 자체의 제목으로 교정한다. 스포티파이 트랙의 유튜브 동등물 제목은 다른 문자열이고
// (「(Official Video)」 등이 붙는다), 사용자가 넣은 것은 스포티파이 곡이므로 표시는 그쪽이 맞다.
// 직접 지정한 음원으로 받은 곡도 교정하지 않는다(곡 정보는 요청의 것, 음원은 다른 곡일 수 있다). 직접 링크는 파일 태그로 고친다(sources/direct-tags)
function correctTitle(track: DownloadTrack, verifiedTitle: string | null) {
  if (!verifiedTitle || track.platform !== "youtube" || track.audioFoundBy === "pinned" || verifiedTitle === track.title) return;
  log.debug(`제목 교정: "${logTitle(track.title)}" → "${verifiedTitle}"`);
  track.title = verifiedTitle;
}

// 다운로드한 것으로 곡 정보를 고친다. 유튜브는 영상 자체의 제목, 직접 링크는 받은 파일의 태그
// (담을 때 태그를 읽지 못한 곡(끝 moov 에 이어 받기가 없는 서버 · 시간 초과 · 통신 오류)도 여기서 고쳐진다)
function correctInfo(track: DownloadTrack, got: Fetched) {
  correctTitle(track, got.verifiedTitle);
  if (got.tags) applyTags(track, got.tags);
}

// 파일 검증. 최종 경로로 올리기 전에
async function ensureNotEmpty(tempPath: string) {
  const stats = await fs.stat(tempPath);
  if (stats.size > 0) return;
  await bestEffort(log, fs.unlink(tempPath), "빈 임시 파일 삭제");
  throw codedError("stream-failed", "다운로드한 파일이 비어 있습니다");
}

// 완료된 다운로드를 DB에 남긴다. 못 남겨도 파일은 이미 올라갔다. 기록 없는 파일은 기동 정리가 치운다
function record(audioKey: string, filepath: string, track: DownloadTrack, { verifiedTitle, audioDurationSec, audioVersion }: Fetched) {
  try {
    const { size } = fsSync.statSync(filepath);
    audioCache.recordDownloadComplete(audioKey, filepath, size, track, { durationSec: audioDurationSec, audioVersion });
    trackLookup.recordTrackLookup(track, { verified: !!verifiedTitle && track.platform === "youtube" });
  } catch (error) {
    log.warn(`캐시 기록 실패 ("${logTitle(track.title)}"): ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 다운로드를 기록하고, 직접 링크면 캐시 파일에 넣은 태그 · 그림을 그림 찾기가 바로 알게 한다(대시보드 · 패널이 기다리지 않게)
function finish(audioKey: string, filepath: string, track: DownloadTrack, got: Fetched) {
  record(audioKey, filepath, track, got);
  if (got.tags !== undefined) embeddedArt.noteFile(audioKey, got.tags, got.cover ?? null);
}

async function publish(tempPath: string, filepath: string): Promise<boolean> {
  if (fsSync.existsSync(filepath) && fsSync.statSync(filepath).size > 0) {
    await bestEffort(log, fs.unlink(tempPath), "다운로드하던 임시 파일 삭제");
    return false;
  }
  audioCache.protectFile(filepath);
  await fs.rename(tempPath, filepath);
  return true;
}

// 다운로드에 부르는 소스와 변환. 테스트가 가짜를 넘긴다. 넘기지 않은 것은 진짜
const SOURCES: Sources = { youtube: YouTube, soundcloud: SoundCloud, direct: { getStream: (url) => openDirectInput(url) }, convert: audioConvert, tags: Tags, measure: { durationSec: probeDurationSec }, sponsor: SponsorBlock, equivalent };

// 출처가 유튜브가 아닌 곡을 유튜브에서 받았으면 그 영상(로그 꼬리)
const youtubeNote = (track: DownloadTrack) => (track.audioUrl && inputKind(track.audioUrl) === "youtube" && track.platform !== "youtube" ? ` (yt: ${track.audioUrl})` : "");

// 조각으로 다운로드하는 포맷(유튜브 post_live 의 DASH 조각 · 사운드클라우드 HLS)을 몇 개씩 나란히 다운로드하나. 조각이 아닌 포맷에는 걸리지 않는다.
// 유튜브는 넷 이상이면 도중에 HTTP 401 로 막히고 둘은 막히지 않는다(재생이 같은 곡을 나란히 다운로드해도). 사운드클라우드는 여덟까지 막히지 않는다.
const CONCURRENT_FRAGMENTS = { youtube: 2, soundcloud: 4 } as const;
class TrackDownloader {
  player: Owner;
  deps: Sources;

  constructor(player: Owner, deps: Partial<Sources> = {}) {
    this.player = player;
    this.deps = { ...SOURCES, ...deps };
  }

  /**
   * 트랙의 캐시 파일 경로 산출. 음원 주소가 아직 없으면(스포티파이 미해석) 요청 키를 해시한다.
   */
  trackFilePath(track: DownloadTrack): string {
    return audioCache.getFilePath(audioKeyOf(track.audioUrl) || track.requestKey);
  }

  /**
   * 오디오 스트림을 로컬 파일로 다운로드합니다.
   * YouTube, Spotify, SoundCloud, DirectLink를 지원합니다.
   *
   * 다운로드 전에 음원 주소부터 정한다. 캐시 키가 곧 파일 경로인데, 스포티파이는 유튜브 동등물을 찾아야
   * 키가 정해진다. 그 검색을 다운로드 도중에 하면 파일이 요청 키 경로에 저장되고 DB 행도 안 남아,
   * 키가 생긴 다음 번에 같은 곡을 또 다운로드한다.
   */
  async downloadTrack(track: DownloadTrack): Promise<string> {
    // 빌려 와야 하는 곡은 대응되는 YouTube 영상에서 다운로드한다(검색·캐시는 youtube/equivalent 한 곳에서).
    // 자동재생이 출처에서 가져온 곡(Last.fm·LB Radio·VocaDB·AnimeThemes)은 영상을 이미
    // 찾아 두었으므로 다시 찾지 않는다. 규칙은 needsBorrowedAudio 참조.
    if (needsBorrowedAudio(track)) {
      const found = await this.deps.equivalent.findYouTubeEquivalent(track).catch((error: unknown) => {
        throw this._failed(track, error);
      });
      if (!found) throw this._failed(track, codedError("sp-no-youtube-match", "유튜브에서 같은 곡을 찾지 못했습니다"));
    }
    const filepath = this.trackFilePath(track);

    // 이미 다운로드되었는지 확인 (캐시 적중)
    if (fsSync.existsSync(filepath)) {
      const stats = await fs.stat(filepath);
      if (stats.size > 0) {
        return filepath;
      }
    }

    // 이미 다운로드 중이면 그 promise를 그대로 대기. 폴링 불필요, 실패도 즉시 전파
    const running = inFlight.get(filepath);
    if (running) return await running;

    const downloadPromise = (async () => {
      try {
        return await this._performDownload(track, filepath);
      } catch (err) {
        // 직접 지정한 음원이 사라졌으면 지정을 건너뛰고 다시 찾아 한 번 더(sources/pinned-fallback)
        if (await leaveDeadPin(track, err, this.deps.equivalent)) return await this._redownload(track);
        // 캐시 매핑의 유튜브 영상이 내려간(삭제/비공개) 경우 → 스테일 매핑 폐기 후 재검색해 새 대상으로 1회 재시도.
        // (극히 드문 케이스. 새로 검색한 영상이면 재발동 안 함 → 무한루프 방지.)
        if (YouTube.isVideoUnavailableError(err) && track.audioFoundBy === "ledger") {
          log.warn({ tags: ["retry"] }, `캐시된 유튜브 영상 접근 불가 (${logTitle(track.title)}). 재검색 후 재시도`);
          const fresh = await this.deps.equivalent.reresolveYouTube(track);
          if (!fresh) throw err;
          return await this._redownload(track);
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

  // 음원을 다시 찾았다. 새 음원으로 다운로드한다. 지금 트는 곡이면 캐시 보호도 새 음원으로 옮긴다(재생은 옛 스트림으로 계속되고, 다음 재생부터 새 파일을 쓴다)
  _redownload(track: DownloadTrack) {
    if (this.player.currentTrack === track) audioCache.protect(this.player.guild.id, audioKeyOf(track.audioUrl));
    return this._performDownload(track, this.trackFilePath(track));
  }

  // 다운로드 실패는 여기서 한 번만 남긴다(까닭까지). 부르는 쪽(백그라운드 다운로드 · 사전 캐싱)은 그 결과만 debug 로 남긴다
  _failed(track: DownloadTrack, error: unknown) {
    log.error(`캐시 다운로드 실패 ("${logTitle(track.title)}"):`, YouTube.briefError(error));
    return error;
  }

  async _performDownload(track: DownloadTrack, filepath: string): Promise<string> {
    const player = this.player;
    const audioKey = audioKeyOf(track.audioUrl);
    const tempPath = tempPathFor(filepath); // 다운로드가 끝난 뒤 최종 경로로 옮긴다
    audioCache.protectFile(tempPath); // 기동 스윕이 다운로드 중인 파일을 고아로 보고 삭제하지 않게

    try {
      if (audioKey) audioCache.recordDownloadStart(audioKey, track);
      // 빌려 오는 곡은 downloadTrack 이 먼저 채웠다
      const downloadUrl = track.audioUrl;
      if (!downloadUrl) throw new Error("음원 주소가 없어 다운로드할 수 없습니다");

      // videoId가 확정된 지점(preload 경로). SponsorBlock 구간을 미리 확보해 재생 시 지연 0.
      // 실패해도 다운로드/재생을 막지 않는다(fail-open, 내부 타임아웃 보유).
      await bestEffort(log, this.deps.sponsor.forTrack(track, player.guild.id), "SponsorBlock 구간 미리 불러오기");

      // ⚠️ 라이브 스트림은 캐시 다운로드 대상이 아니다. 끝이 없어서 yt-dlp가 ffmpeg를 외부 다운로더로
      //    실행한 뒤 무한히 파일을 불린다. 재생(스트리밍)은 정상 진행되므로 여기서만 끊는다.
      if (track.isLive) {
        throw new Error("라이브 스트림은 캐시 다운로드 대상이 아님");
      }

      // yt-dlp가 다운로드하는 것들: 유튜브 영상(스포티파이 · 자동재생 곡이 찾아 둔 것 포함)과 사운드클라우드.
      // 남는 것은 직접 링크뿐이다. 곡이 어디서 왔는지가 아니라 음원 주소가 구분한다.
      const got = inputKind(downloadUrl) !== "direct" ? await this._fetchWithYtDlp(downloadUrl, tempPath) : await this._fetchDirect(downloadUrl, tempPath, track);

      await ensureNotEmpty(tempPath);
      // 음원 길이는 만든 .opus 를 재서 소수까지 적는다. 출처가 준 정수나 원본 헤더의 값보다 이 파일이 정본이다
      const measureStarted = Date.now();
      const measured = await this.deps.measure.durationSec(tempPath);
      const measureMs = Date.now() - measureStarted;
      // 다운로드한 양(봇 상태 탭의 다운로드). 먼저 끝낸 쪽이 있어 버려도 다운로드한 것은 다운로드한 것이다
      addDownloaded(fsSync.statSync(tempPath).size);
      const mine = await publish(tempPath, filepath);
      if (!mine) log.debug(`다른 쪽이 먼저 다운로드해 둔 캐시를 쓴다: "${logTitle(track.title)}"`);

      correctInfo(track, got);
      const shown = shownDuration(track, measured, "measured");
      if (shown) Object.assign(track, shown);

      // 먼저 끝낸 쪽이 그 파일의 기록(버전 · 길이)을 이미 남겼다. 버린 쪽의 값으로 덮지 않는다
      if (audioKey && mine) finish(audioKey, filepath, track, measured ? { ...got, audioDurationSec: measured } : got);
      // 출처가 따로 있는 트랙은 어느 영상에서 소리를 가져왔는지 같이 남긴다. 스포티파이만이 아니다.
      // 예열이 앞으로 여러 곡을 미리 다운로드하므로 곡당 한 줄씩 늘어난다. 무엇으로 틀었는지는
      // 재생 줄의 출처=캐시 가 말해 준다.
      // 걸린 시간을 단계마다 적는다. 긴 곡의 캐시가 어디서 오래 걸렸는지 구분할 근거다
      log.debug(`캐시 다운로드 완료: "${logTitle(track.title)}"${youtubeNote(track)} | ${got.how} · 길이 재기 ${secs(measureMs)}초`);
      return filepath;
    } catch (error) {
      // 중단·실패한 다운로드가 남긴 .part/프래그먼트/중간 파일을 즉시 치운다. 내 임시 파일만.
      // (같은 곡의 부스러기를 전부 훑으면 다른 쪽이 다운로드 중인 작업 파일을 삭제한다.)
      // 그리고 recordDownloadStart로 'downloading'이 된 DB 행을 'error'로 되돌린다.
      // (없으면 다음 기동의 onStartup 리셋 때까지 유령 'downloading' 행이 남는다.)
      try {
        const removed = cleanTemp(tempPath);
        if (removed > 0) log.debug(`캐시 다운로드 중단으로 생성된 조각 파일 ${removed}개 정리: ${logTitle(track.title)}`);
        if (audioKey) audioCache.recordError(audioKey);
      } catch {
        /* 정리 실패는 원래 오류를 가리면 안 된다 */
      }
      throw this._failed(track, error);
    } finally {
      audioCache.unprotectFile(tempPath);
      audioCache.unprotectFile(filepath);
    }
  }

  // yt-dlp 로 다운로드한다. 변환은 yt-dlp의 ExtractAudio가 소스 코덱을 보고 한다. 사운드클라우드의 HLS도 스스로
  // 조립하므로 우리가 손댈 것이 없다.
  async _fetchWithYtDlp(downloadUrl: string, tempPath: string): Promise<Fetched> {
    const flags = {
      output: tempPath,
      // 이 다운로드에 곁들여 메타데이터를 파일로 다운로드한다. 왕복이 늘지 않는다.
      // stdout으로 받는 --print는 쓸 수 없다: yt-dlp가 시스템 코드페이지로 써서
      // 일본어·한국어 제목이 깨지고(Windows 의 cp949), PYTHONIOENCODING으로도 안 바뀐다.
      // 파일은 UTF-8로 쓰이므로 어느 환경에서나 안전하다.
      writeInfoJson: true,
      format: YouTube.AUDIO_FORMAT,
      preferFreeFormats: true,
      // 2차 방어선: track.isLive를 못 잡은 경우(캐시된 매핑 등)에도 yt-dlp가 스스로 라이브를 건너뛴다.
      // 걸리면 다운로드를 시작조차 하지 않으므로 ffmpeg가 아예 실행되지 않는다.
      matchFilter: "!is_live",
      // 코덱은 yt-dlp 가 소스를 보고 정한다. 이미 Opus 면 리먹싱, 아니면 libopus.
      // 여기서 코덱을 못 박으면 그 판단을 덮어 251 까지 다시 인코딩된다.
      // `-b:a` 는 스트림 카피에 무시되므로 두 경우 모두 맞는다.
      // 목표 비트레이트는 직접 링크 분기와 같은 곳에서 가져온다. 숫자가 어긋나지 않게.
      postprocessorArgs: audioConvert.ytdlpPostprocessorArgs(),
      extractAudio: true,
      audioFormat: "opus",
    };
    // 사운드클라우드는 공통 옵션과 재생 포맷만(유튜브 전용 옵션 · 클라이언트 바꾸기 · 쿠키가 없다)
    const started = Date.now();
    if (inputKind(downloadUrl) === "soundcloud") await this.deps.soundcloud.download(downloadUrl, { ...flags, concurrentFragments: CONCURRENT_FRAGMENTS.soundcloud });
    // 받아 둔 영상 정보가 있으면 다시 추출하지 않고 받는다. 없으면 추출부터: 연령 제한 영상은 runYtDlp가 쿠키 폴백을 처리(대개 getStream/getInfo에서 이미 표시돼 실패 없이 쿠키 직행).
    else await this.deps.youtube.downloadAudio(downloadUrl, (forceCookies) => this.deps.youtube.getYtDlpOptions({ ...flags, concurrentFragments: CONCURRENT_FRAGMENTS.youtube }, { forceCookies }));

    // match-filter에 걸리면 yt-dlp는 "skipping" 후 정상 종료(exit 0)하고 파일을 남기지 않는다.
    // 아래 fs.stat이 ENOENT로 터지면 원인을 알 수 없으므로 여기서 명확한 오류로 바꾼다.
    if (!fsSync.existsSync(tempPath)) {
      throw new Error("yt-dlp가 대상을 건너뜀 (라이브 스트림 등). 캐시 다운로드 불가");
    }
    const ended = Date.now();
    const info = this._takeInfoJson(tempPath);
    // 사운드클라우드가 미리듣기 조각(30초)만 준 곡: 곡처럼 캐시하지 않는다(넣은 뒤 권리자가 미리듣기로 돌린 곡)
    if (/_preview$/.test(info.formatId ?? "")) throw codedError("sc-preview-only", `미리듣기만 열린 곡이라 캐시하지 않습니다: ${downloadUrl}`);
    // 다운로드한 포맷과 옮겼나 구웠나(yt-dlp 의 ExtractAudio 는 Opus 면 옮기고 아니면 굽는다)
    const codec = info.acodec?.split(".")[0] ?? "?";
    const format = `포맷 ${info.formatId ?? "?"}(${info.protocol ?? "?"}, ${codec === "opus" ? "옮김" : `${codec} → opus 구움`})`;
    const lingerMs = ended - fsSync.statSync(tempPath).mtimeMs;
    const linger = lingerMs > LINGER_LOG_MS ? ` · 파일을 다 쓰고 ${secs(lingerMs)}초 뒤에 끝남` : "";
    return { verifiedTitle: info.title, audioDurationSec: info.durationSec, audioVersion: info.version, how: `yt-dlp ${secs(ended - started)}초 · ${format}${linger}` };
  }

  // 직접 링크(파일 · HLS VOD). SSRF 가드(SafeUrl)를 통과해 가져온다(media/direct-input).
  // 즉시재생과 별개의 요청이므로 소비 시점에 음원 주소를 다시 가드 fetch 한다.
  async _fetchDirect(downloadUrl: string, tempPath: string, track: DownloadTrack): Promise<Fetched> {
    // 같은 파일의 머리 읽기(담을 때 · 그림 찾기)를 끊는다. 연결이 셋 열리지 않게. 태그는 받은 파일이 채운다
    const key = audioKeyOf(downloadUrl);
    if (key) embeddedArt.cancelSource(key);
    const audioStream = await this.deps.direct.getStream(downloadUrl);
    // 끝이 없는 것(인터넷 라디오 · 라이브 HLS)은 받지 않는다. 담을 때 라이브로 적어 여기 오지 않지만, 직접 지정한 음원은 그 검사를 거치지 않는다
    if (audioStream.live) {
      audioStream.destroy();
      throw codedError(track.audioFoundBy === "pinned" ? "pinned-live" : "stream-failed", `끝이 없는 라이브(인터넷 라디오 · 라이브 HLS)라 캐시하지 않습니다: ${downloadUrl}`);
    }
    const audioVersion = versionOf.fromHeaders(audioStream.headers);

    // 일단 다운로드해 둔 다음에 무엇인지 물어본다. 스트림인 채로는 알 수 없고, 안에 든 것을
    // 모르면 이미 Opus 인 음원까지 다시 굽게 된다.
    const rawPath = `${tempPath.replace(/\.opus$/, "")}.raw`;
    audioCache.protectFile(rawPath);
    try {
      const started = Date.now();
      await pipeline(audioStream, fsSync.createWriteStream(rawPath));
      const received = Date.now();
      // 받은 파일이 태그의 정본이다(곡에 반영하는 것은 다운로드를 마친 뒤). 캐시 파일에도 이 태그와 다시 구운 그림을 적는다
      const tags = await this.deps.tags.fromFile(rawPath);
      const cover = tags?.picture ? await bakeCover(tags.picture.data) : null;
      // 무엇을 할지는 audioConvert 한 곳이 정한다. 리먹싱이냐 변환이냐, 목표가 몇이냐.
      const made = await this.deps.convert.toCacheOpus(rawPath, tempPath, { tags, cover });
      // 옮겼나 구웠나는 변환이 제 줄에 남긴다
      const how = `다운로드 ${secs(received - started)}초 · 변환 ${secs(Date.now() - received)}초`;
      return { verifiedTitle: null, tags, cover, audioDurationSec: made.durationSec || null, audioVersion, how };
    } finally {
      audioCache.unprotectFile(rawPath);
      try {
        fsSync.unlinkSync(rawPath);
      } catch {
        /* 이미 없거나 잠겨 있음. cleanTemp와 기동 스윕이 받는다 */
      }
    }
  }

  /**
   * 다운로드가 곁들여 남긴 info.json에서 제목과 오디오 길이를 꺼내고 파일을 치운다.
   *
   * yt-dlp는 출력 템플릿의 확장자를 벗기지 않고 `.info.json`을 덧붙이므로 `<파일>.info.json`이
   * 되지만, 버전에 따라 확장자를 바꾼 형태로 쓸 수도 있어 둘 다 본다.
   * 실패해도 다운로드 자체는 성공한 것이므로 모르는 값은 null로 돌려준다.
   */
  _takeInfoJson(filepath: string): { title: string | null; durationSec: number | null; version: string | null; formatId?: string | null; protocol?: string | null; acodec?: string | null } {
    const candidates = [`${filepath}.info.json`, filepath.replace(/\.opus$/, "") + ".info.json"];
    for (const p of candidates) {
      try {
        if (!fsSync.existsSync(p)) continue;
        const info = readInfo(JSON.parse(fsSync.readFileSync(p, "utf8")));
        fsSync.unlinkSync(p);
        return {
          title: typeof info?.title === "string" && info.title.trim() ? info.title : null,
          durationSec: Number(info?.duration) > 0 ? Number(info?.duration) : null,
          version: versionOf.fromYtDlpInfo(info),
          ...formatOf(info),
        };
      } catch {
        try {
          fsSync.unlinkSync(p);
        } catch {
          /* 남아도 기동 스윕이 치운다 */
        }
      }
    }
    return { title: null, durationSec: null, version: null };
  }

  /** 캐시 파일이 이미 준비돼 있는가. "다운로드할 필요가 없다"의 유일한 근거다. */
  isCached(track: HasAudio): boolean {
    return TrackDownloader.findCacheFile(track) !== null;
  }

  /**
   * 한 곡을 캐시에 올린다. QueueWarmer가 부르는 유일한 진입점.
   * 이미 다운로드했는지, 다운로드 중인지는 downloadTrack이 판정하므로 여기서 다시 하지 않는다.
   */
  async warm(track: DownloadTrack | null | undefined): Promise<void> {
    if (!track || !track.requestKey) return;
    await this.downloadTrack(track);
  }

  /** 이 경로를 지금 다운로드하고 있는가. 서버와 무관하다 */
  /** 지금 다운로드 중인 곡 수 */
  static activeCount(): number {
    return inFlight.size;
  }

  static isDownloading(filepath: string): boolean {
    return inFlight.has(filepath);
  }

  /** 다운로드 중이면 그 promise, 아니면 null */
  static waitFor(filepath: string): Promise<string> | null {
    return inFlight.get(filepath) ?? null;
  }

  /**
   * 이 곡의 캐시 파일. 다운로드가 끝난 것만 돌려준다(키 경로에 있고, 비어 있지 않고, 다운로드 중이 아님). 없으면 null.
   * 다운로드는 임시 파일에 쓰고 끝나면 옮기므로 키 경로에 있으면 다운로드가 끝난 것이다. 다운로드 중 확인은 그래도 한 번 더 본다.
   * 음원 주소가 아직 없으면(스포티파이가 영상을 찾기 전) 키도 없어 null 이다.
   */
  static findCacheFile(track: HasAudio): string | null {
    const key = audioKeyOf(track?.audioUrl);
    if (!key) return null;
    const file = audioCache.getFilePath(key);
    try {
      return fsSync.statSync(file).size > 0 && !TrackDownloader.isDownloading(file) ? file : null;
    } catch {
      return null;
    }
  }

  static _internals = { inFlight, tempPathFor, cleanTemp, publish, needsBorrowedAudio };
}

/** 캐시하기에 너무 긴 길이(초)인가(CACHE_MAX_TRACK_MINUTES, 0 이면 상한 없음). 길이를 모르면 아니다 */
function tooLongToCache(seconds: number | null | undefined) {
  const max = config.cache.maxTrackSec;
  return max > 0 && (seconds ?? 0) > max;
}

export { TrackDownloader, tooLongToCache };
export type { DownloadTrack, Sources };
