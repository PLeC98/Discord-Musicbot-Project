// play() 의 단계. play() 는 이 셋을 차례로 부르고, 둘째와 셋째 사이에서 소리를 연다(media/playback-input).
//   prepareStart   틀 곡과 시작 위치. 대기열에서 꺼내고 음성 채널에 붙고, 새로 트는 곡이면 인트로 끝을 시작 위치로
//   resolveSource  소리를 어디서 받나. 캐시 파일, 위치 이동이면 직전 재생의 주소, 없으면 새 스트림
//   commitPlaying  연 소리를 튼다. SponsorBlock · 볼륨 · 캐시 보호 · 재생 기록 · 멈춤 사유 · 위치 재개 정보 · 감시와 저장
// 플레이어의 상태를 읽고 쓰므로 플레이어를 받는다.

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import { TrackDownloader } from "../media/cache-download.ts";
import * as audioCache from "../store/audio-cache.ts";
import * as trackLookup from "../store/track-lookup.ts";
import * as trackState from "./track-state.ts";
import { audioKeyOf } from "../rules/audio-key-of.ts";
import { shownDuration } from "../rules/duration-shown.ts";
import { messageOf, codedError } from "../rules/error-kind.ts";
import type { Player } from "./player.ts";
import type { CurrentPlayback } from "./current-playback.ts";
import type { Resume } from "./current-playback.ts";
import type { QueuedTrack } from "./track.ts";
import type { StreamInfo } from "../sources/stream-url.ts";
import type { Segments } from "../sources/sponsor-block.ts";
import { logTitle } from "../infra/log/title.ts";

/** 소리를 어디서 받을지 정한 것 */
type Source = { cacheFile: string | null; streamInfo: StreamInfo | null; titleVerified: boolean; isLive: boolean | null; sponsor: Promise<Segments | null> };
// 안 정하면 libopus 기본값(실측 100k)으로 나간다. 캐시가 128k 라 거기에 맞춘다.
// 더 올릴 수는 있지만 prism 래퍼가 128k 에서 자르고, 청취로도 그 위는 구분되지 않았다.
const SEND_BITRATE = 128_000;
const INTRO_START_TOL_SEC = 1; // 0~1초 사이에서 시작하는 구간을 인트로로 본다
const RESUME_URL_MARGIN_MS = 60_000; // 직전 주소를 다시 쓸 때 남은 곡을 다 받고도 이만큼은 만료가 남아야 한다

/**
 * 틀 곡과 시작 위치.
 */
async function prepareStart(player: Player, seekMs: number): Promise<{ ok: true; startMs: number } | { ok: false; code: "queue-empty" }> {
  if (!player.currentTrack) {
    if (player.queue.length === 0) return { ok: false, code: "queue-empty" };
    trackState.shiftNext(player);
  }
  // 붙지 못하면 voice-failed 로 던진다. play() 의 실패 처리가 알리고 다음 곡으로 넘긴다
  if (!player.connection) await player.voice.connect();

  const wanted = Number(seekMs) || 0;
  let startMs = Math.max(0, Math.floor(wanted));
  // 새로 트는 곡(위치 이동 아님)이면 스트림을 열기 전에 영상 id 와 SponsorBlock 을 먼저 확보해
  // 인트로 끝을 시작 위치로 삼는다(0부터 틀고 옮기는 이중 재생을 피한다).
  if (wanted === 0) {
    const track = player.currentTrack;
    try {
      if (!track) throw new Error("틀 곡이 없습니다");
      if (!track.audioUrl) await player.io.findEquivalent(track); // 멱등. 영상 id 확정
      const introEnd = introOffsetMs(await player.io.sponsorFor(track, player.guild.id));
      if (introEnd > 0) startMs = introEnd;
    } catch {
      /* 조회 실패는 무시(fail-open). 오프셋 없이 재생 */
    }
  }
  return { ok: true, startMs };
}

/** 곡 첫머리(0 부근)에서 시작하는 건너뛸 구간의 끝(ms). 없으면 0 */
function introOffsetMs(sponsor: Partial<Pick<Segments, "skipSegments">> | null | undefined) {
  const segs = sponsor?.skipSegments;
  if (!segs || !segs.length) return 0;
  const intro = segs.find((s) => s.start <= INTRO_START_TOL_SEC);
  return intro && intro.end > 0 ? Math.round(intro.end * 1000) : 0;
}

/**
 * 소리를 어디서 받나. 캐시 파일이 있으면 yt-dlp 를 부르지 않는다.
 * 음원 주소가 정해졌으니 SponsorBlock 조회도 여기서 시작해 둔다(여는 동안 나란히 묻는다).
 * @param previousResume  직전 재생이 남긴 위치 재개 정보
 */
async function resolveSource(player: Player, track: QueuedTrack, startMs: number, previousResume: Resume | null | undefined): Promise<Source> {
  // 캐시 파일을 고르기 전에 보호를 건다. 고른 뒤에 걸면 그사이 퇴거가 삭제할 수 있다(틀지 못하고 나오면 play 가 푼다)
  const pickCacheFile = () => {
    audioCache.protect(player.guild.id, audioKeyOf(track.audioUrl));
    return TrackDownloader.findCacheFile(track);
  };
  // 키는 음원 주소에서 바로 나온다(스포티파이는 영상을 찾은 뒤)
  let cacheFile = pickCacheFile();
  // 위치 이동이면 직전 재생이 받은 주소를 다시 쓴다. 캐시 파일로 틀면 주소가 필요 없다
  let streamInfo: StreamInfo | null = startMs > 0 && !cacheFile ? resumeStream(track, previousResume, startMs) : null;

  if (!streamInfo && !cacheFile) {
    // 음원 주소가 없는 곡(스포티파이)은 유튜브 동등물을 먼저 찾는다. 그래야 캐시 키가 정해지므로
    // 캐시 파일을 한 번 더 보고, 있으면 스트림을 받지 않는다
    if (!track.audioUrl) {
      const ytUrl = await player.io.findEquivalent(track);
      if (!ytUrl) throw codedError("sp-no-youtube-match", `Spotify 트랙의 YouTube 동등물을 찾을 수 없음: ${logTitle(track.title)}`);
      cacheFile = pickCacheFile();
    }
    // 어느 사이트에서 받을지는 sources/stream-url 한 곳에서 분기한다
    if (!cacheFile) streamInfo = await player.io.getStream(track, { canPlayHls: player.io.ffmpegCapabilities().ok });
  }

  return {
    cacheFile,
    streamInfo,
    titleVerified: verifyTitle(track, streamInfo),
    isLive: liveAnswer(streamInfo, cacheFile),
    sponsor: player.io.sponsorFor(track, player.guild.id).catch(() => null),
  };
}

// 재생목록으로 담은 곡은 재생목록 페이지가 준 제목을 쓰고 있는데, 같은 영상인데도 다를 수 있다.
// 스트림을 가져왔다면 그 응답에 영상 자체의 제목이 실려 있으므로 왕복 없이 고칠 수 있다.
// (캐시로 재생하는 곡은 여기를 지나지 않는다. 그쪽은 다운로드할 때 고친다.)
// 스포티파이 곡은 제외한다: 유튜브 동등물의 제목은 다른 문자열이고, 사용자가 넣은 것은
// 스포티파이 곡이므로 표시는 그쪽이 맞다. 직접 지정한 음원으로 트는 곡도 제외한다(곡 정보는 요청의 것이다).
function verifyTitle(track: QueuedTrack, streamInfo: StreamInfo | null) {
  if (track.platform !== "youtube" || track.audioFoundBy === "pinned" || !streamInfo?.title) return false;
  if (streamInfo.title !== track.title) {
    log.debug(`제목 교정: "${logTitle(track.title)}" → "${streamInfo.title}"`);
    track.title = streamInfo.title;
  }
  return true;
}

// 지금 라이브인지는 yt-dlp 응답이 정본이다. 대기열에 담길 때 방송 중이었어도 그사이 끝나
// 다시보기가 됐을 수 있고, 반대로 라이브인 줄 모르고 담긴 것도 있다(재생목록 · 믹스).
// 캐시 파일이 있다는 것은 끝이 있는 음원이라는 뜻이다. 라이브는 다운로드하지 않는다. 모르면 null
function liveAnswer(streamInfo: StreamInfo | null, cacheFile: string | null) {
  if (streamInfo && "liveStatus" in streamInfo) return streamInfo.liveStatus === "is_live";
  return cacheFile ? false : null;
}

/**
 * 같은 곡 안에서 위치를 옮길 때 직전 재생이 받은 주소를 다시 쓴다(yt-dlp 를 다시 부르지 않는다).
 * 주소의 만료 시각(expire=)이 남은 곡을 다 받을 만큼 넉넉할 때만. 만료 시각을 모르는 주소는 다시 받는다
 */
function resumeStream(track: QueuedTrack, resume: Resume | null | undefined, startMs: number): StreamInfo | null {
  const key = resumeKeyOf(track);
  if (!resume?.url || !key || resume.trackKey !== key) return null;
  const expireMs = expireOf(resume.url);
  const remainingMs = Math.max(0, (resume.info.duration || track.duration || 0) * 1000 - startMs);
  if (!expireMs) {
    log.debug(`직전 스트림 주소는 만료 시각을 몰라 주소를 새로 받습니다: ${logTitle(track.title)}`);
    return null;
  }
  if (expireMs - Date.now() < remainingMs + RESUME_URL_MARGIN_MS) {
    log.debug(`직전 스트림 주소의 만료가 가까워 주소를 새로 받습니다: ${logTitle(track.title)} | 만료 ${Math.round((expireMs - Date.now()) / 1000)}초 후`);
    return null;
  }
  return { ...resume.info, url: resume.url };
}

// 주소가 알려 준 만료 시각(ms). 없으면 null
function expireOf(url: string) {
  try {
    const sec = Number(new URL(url).searchParams.get("expire"));
    return sec > 0 ? sec * 1000 : null;
  } catch {
    return null;
  }
}

function resumeKeyOf(track: QueuedTrack | null) {
  if (!track) return null;
  return track.id || track.requestKey || `${track.title ?? ""}-${track.duration}`;
}

/**
 * 연 소리를 튼다. 소리는 이미 pb.resource 에 있다.
 */
async function commitPlaying(player: Player, pb: CurrentPlayback, source: Source, { continued = false }: { continued?: boolean } = {}) {
  const track = pb.track;
  const { streamInfo } = source;
  const { resource } = pb;
  if (!resource) throw codedError("stream-failed", "열린 소리가 없습니다");

  // 자동 스킵 워처 가동. 구간 있으면 시작, 위치 이동이면 기준점을 그 위치로(수동 진입 허용)
  pb.sponsor = await source.sponsor;
  player.sponsorSkipper.onPlayStart(pb.startOffsetMs);

  resource.volume?.setVolume(player.volume / 100);
  resource.encoder?.setBitrate(SEND_BITRATE);

  const durationSec = audioDurationSec(track, streamInfo, pb.cacheFile);
  pb.lengthMs = durationSec ? durationSec * 1000 : null;
  // 표시는 처음 보인 값을 지킨다. 캐시 기록은 다운로드해 둔 음원을 잰 값, 스트림 정보는 출처가 준 값이다
  const shown = shownDuration(track, durationSec, pb.cacheFile ? "measured" : "provided");
  if (shown) Object.assign(track, shown);
  log.info(`재생: ${logTitle(track.title)} (${track.duration}s, offset: ${pb.startOffsetMs}ms, 출처=${pb.cacheFile ? "캐시" : "스트림"})`);

  const audioKey = audioKeyOf(track.audioUrl);
  player.audioPlayer.play(resource);
  // 라이브는 다운로드해 두지 않으므로 적을 것이 없다.
  if (audioKey && !player.isLive) recordPlayed(track, audioKey, source.titleVerified, { countPlay: !continued });

  if (player.pauseReasons.size > 0) {
    // 멈추는 건 Playing 리스너다. 지금은 아직 버퍼링이라 pause()가 먹지 않는다
    log.info(`곡을 불러와 일시정지 상태로 둠: 원인=${Array.from(player.pauseReasons).join(", ")}`);
    player.paused = true;
  }

  pb.resume = resumeInfo(track, streamInfo);

  // 끝을 알리지 못하는 입력의 마지막 그물. 곡 끝은 Idle 때 판정한다
  player.watch.startOverflow();

  player.persistence.startStateSync();
  player.warmer.start();
  await player.persistence.persistState(pb.startOffsetMs > 0 ? "resume-playback" : "play");

  // 다음 자동재생 곡을 미리 선택해 둔다. 기다리지 않는다. 재생 시작을 늦추면 안 된다.
  player.ensureAutoplayNext().catch((error) => log.warn(`자동재생 미리 선택 실패: ${messageOf(error)}`));
}

// 재생 통계와 "이 요청은 이 음원이다"를 DB에 기록. 같은 곡을 이어 틀 때는 재생 횟수를 세지 않는다(퇴거 점수가 본다).
// 부기일 뿐이므로 실패해도 재생을 끌어내리지 않는다. 여기서 던지면 방금 시작한 소리가 catch에서 멈춘다.
function recordPlayed(track: QueuedTrack, audioKey: string, titleVerified: boolean, { countPlay }: { countPlay: boolean }) {
  try {
    if (countPlay) audioCache.recordPlayback(audioKey);
    trackLookup.recordTrackLookup(track, { verified: titleVerified });
  } catch (error) {
    log.warn(`오디오 캐시 기록 실패(재생은 계속): ${messageOf(error)}`);
  }
}

// 같은 곡 안에서 위치를 옮길 때 주소를 다시 묻지 않도록 남겨 둔다
function resumeInfo(track: QueuedTrack, streamInfo: StreamInfo | null): Resume {
  return {
    trackKey: resumeKeyOf(track),
    url: streamInfo?.url ?? null,
    info: streamInfo ?? {},
  };
}

// 곡 끝 판정 · SponsorBlock 곡 끝 구간에 쓰는 실제 오디오 길이. 곡 메타데이터(스포티파이 등)는 오디오와 수 초씩 다르다
function audioDurationSec(track: Pick<QueuedTrack, "audioUrl"> | null, streamInfo: Pick<StreamInfo, "duration"> | null, cacheFile: string | null): number | null {
  const key = audioKeyOf(track?.audioUrl);
  if (cacheFile && key) {
    const cached = audioCache.lookupByAudioKey(key)?.duration_sec;
    if (cached && cached > 0) return cached;
  }
  const streamed = streamInfo?.duration;
  return streamed && streamed > 0 ? streamed : null;
}

export { prepareStart, resolveSource, commitPlaying, introOffsetMs, audioDurationSec };
export type { Source };
