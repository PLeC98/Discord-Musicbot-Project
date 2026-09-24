// play() 의 단계. play() 는 이 셋을 차례로 부르고, 둘째와 셋째 사이에서 소리를 연다(media/playbackInput).
//   prepareStart   틀 곡과 시작 위치. 대기열에서 꺼내고 음성 채널에 붙고, 새로 트는 곡이면 인트로 끝을 시작 위치로
//   resolveSource  소리를 어디서 받나. 받아 둔 파일, 위치 이동이면 직전 재생의 주소, 없으면 새 스트림
//   commitPlaying  연 소리를 튼다. SponsorBlock · 음량 · 캐시 보호 · 장부 · 멈춤 사유 · 위치 재개 정보 · 감시와 저장
// 플레이어의 상태를 읽고 쓰므로 플레이어를 받는다.

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import equivalent from "../sources/youtube/equivalent.js";
import SponsorBlock from "../sources/sponsorBlock.js";
import TrackDownloader from "../media/cacheDownload.js";
import audioCache from "../store/audioCache.js";
import trackLookup from "../store/trackLookup.js";
import trackState from "./trackState.js";
import { audioKeyOf } from "../rules/audioKeyOf.ts";
// 안 정하면 libopus 기본값(실측 100k)으로 나간다. 캐시가 128k 라 거기에 맞춘다.
// 더 올릴 수는 있지만 prism 래퍼가 128k 에서 자르고, 청취로도 그 위는 구분되지 않았다.
const SEND_BITRATE = 128_000;
const INTRO_START_TOL_SEC = 1; // 0~1초 사이에서 시작하는 구간을 인트로로 본다

/**
 * 틀 곡과 시작 위치.
 * @returns {Promise<{ok: true, startMs: number} | {ok: false, code: "queue-empty" | "voice-failed"}>}
 */
async function prepareStart(player, seekMs) {
  if (!player.currentTrack) {
    if (player.queue.length === 0) return { ok: false, code: "queue-empty" };
    trackState.shiftNext(player);
  }
  if (!player.connection && !(await player.connect())) {
    return { ok: false, code: "voice-failed" };
  }

  const wanted = Number(seekMs) || 0;
  let startMs = Math.max(0, Math.floor(wanted));
  // 새로 트는 곡(위치 이동 아님)이면 스트림을 열기 전에 영상 id 와 SponsorBlock 을 먼저 확보해
  // 인트로 끝을 시작 위치로 삼는다(0부터 틀고 옮기는 이중 재생을 피한다).
  if (wanted === 0) {
    const track = player.currentTrack;
    try {
      if (!track.audioUrl) await equivalent.findYouTubeEquivalent(track); // 멱등. 영상 id 확정
      const introEnd = introOffsetMs(await SponsorBlock.forTrack(track, player.guild.id));
      if (introEnd > 0) startMs = introEnd;
    } catch {
      /* 조회 실패는 무시(fail-open). 오프셋 없이 재생 */
    }
  }
  return { ok: true, startMs };
}

/** 곡 첫머리(0 부근)에서 시작하는 건너뛸 구간의 끝(ms). 없으면 0 */
function introOffsetMs(sponsor) {
  const segs = sponsor?.skipSegments;
  if (!segs || !segs.length) return 0;
  const intro = segs.find((s) => s.start <= INTRO_START_TOL_SEC);
  return intro && intro.end > 0 ? Math.round(intro.end * 1000) : 0;
}

/**
 * 소리를 어디서 받나. 받아 둔 파일이 있으면 yt-dlp 를 부르지 않는다.
 * 음원 주소가 정해졌으니 SponsorBlock 조회도 여기서 시작해 둔다(여는 동안 나란히 묻는다).
 * @param {object | null} previousResume  직전 재생이 남긴 위치 재개 정보
 * @returns {Promise<{cacheFile: string | null, streamInfo: object | null, titleVerified: boolean, isLive: boolean | null, sponsor: Promise<object | null>}>}
 */
async function resolveSource(player, track, startMs, previousResume) {
  // 열쇠는 음원 주소에서 바로 나온다(스포티파이는 영상을 찾은 뒤)
  let cacheFile = TrackDownloader.findCacheFile(track);
  // 위치 이동이면 직전 재생이 받은 주소를 다시 쓴다
  let streamInfo = startMs > 0 ? resumeStream(track, previousResume, startMs / 1000) : null;

  if (!streamInfo && !cacheFile) {
    // 음원 주소가 없는 곡(스포티파이)은 유튜브 동등물을 먼저 찾는다. 그래야 캐시 열쇠가 정해지므로
    // 캐시 파일을 한 번 더 보고, 있으면 스트림을 받지 않는다
    if (!track.audioUrl) {
      const ytUrl = await equivalent.findYouTubeEquivalent(track);
      if (!ytUrl) throw new Error(`Spotify 트랙의 YouTube 동등물을 찾을 수 없음: ${track.title}`);
      cacheFile = TrackDownloader.findCacheFile(track);
    }
    // 어느 사이트에서 받을지는 sources/streamUrl 한 곳에서 가른다
    if (!cacheFile) streamInfo = await player.io.getStream(track, startMs / 1000, { canPlayHls: player.io.ffmpegCapabilities().ok });
  }
  if (!streamInfo && !cacheFile) throw new Error("오디오 스트림 가져오기 실패");

  return {
    cacheFile,
    streamInfo,
    titleVerified: verifyTitle(track, streamInfo),
    isLive: liveAnswer(streamInfo, cacheFile),
    sponsor: SponsorBlock.forTrack(track, player.guild.id).catch(() => null),
  };
}

// 재생목록으로 담은 곡은 재생목록 페이지가 준 제목을 쓰고 있는데, 같은 영상인데도 다를 수 있다.
// 스트림을 가져왔다면 그 응답에 영상 자체의 제목이 실려 있으므로 왕복 없이 고칠 수 있다.
// (캐시로 재생하는 곡은 여기를 지나지 않는다. 그쪽은 받을 때 고친다.)
// 스포티파이 곡은 제외한다: 유튜브 동등물의 제목은 다른 문자열이고, 사용자가 넣은 것은
// 스포티파이 곡이므로 표시는 그쪽이 맞다.
function verifyTitle(track, streamInfo) {
  if (track.platform !== "youtube" || !streamInfo?.title) return false;
  if (streamInfo.title !== track.title) {
    log.debug(`제목 교정: "${track.title}" → "${streamInfo.title}"`);
    track.title = streamInfo.title;
  }
  return true;
}

// 지금 라이브인지는 yt-dlp 응답이 정본이다. 대기열에 담길 때 방송 중이었어도 그사이 끝나
// 다시보기가 됐을 수 있고, 반대로 라이브인 줄 모르고 담긴 것도 있다(재생목록 · 믹스).
// 캐시 파일이 있다는 것은 끝이 있는 음원이라는 뜻이다. 라이브는 받지 않는다. 모르면 null
function liveAnswer(streamInfo, cacheFile) {
  if (streamInfo && "liveStatus" in streamInfo) return streamInfo.liveStatus === "is_live";
  return cacheFile ? false : null;
}

/** 위치 재개 정보가 이 곡의 것이고 주소로 위치를 옮길 수 있으면, 그 위치의 스트림 서술자 */
function resumeStream(track, resume, seekSeconds) {
  if (!resume) return null;
  const key = resumeKeyOf(track);
  if (!key || resume.trackKey !== key) return null;
  if (!resume.resumeSupported || !resume.baseUrl) return null;
  const url = seekUrl(resume.baseUrl, seekSeconds);
  if (!url) return null;
  return { ...resume.info, url, canSeek: true, fromCache: true, duration: resume.info?.duration || track.duration };
}

function resumeKeyOf(track) {
  if (!track) return null;
  return track.id || track.requestKey || `${track.title}-${track.duration}`;
}

// 주소에 시작 위치를 싣는다. 지금은 유튜브 스트림 주소만 된다
function seekUrl(baseUrl, seekSeconds) {
  if (!baseUrl) return null;
  if (seekSeconds <= 0) return baseUrl;
  const url = baseUrl.replace(/(&|\?)begin=\d+/g, "").replace(/(&|\?)start=\d+/g, "");
  if (!/googlevideo\.com/i.test(url)) return null;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}begin=${Math.max(0, Math.floor(seekSeconds * 1000))}`;
}

/**
 * 연 소리를 튼다. 소리는 이미 pb.resource 에 있다.
 * @param {{streamInfo: object | null, titleVerified: boolean, sponsor: Promise<object | null>}} source
 */
async function commitPlaying(player, pb, source) {
  const track = pb.track;
  const { streamInfo } = source;

  // 자동 스킵 워처 가동. 구간 있으면 시작, 위치 이동이면 기준점을 그 위치로(수동 진입 허용)
  pb.sponsor = await source.sponsor;
  player.sponsorSkipper.onPlayStart(pb.startOffsetMs);

  pb.resource.volume?.setVolume(player.volume / 100);
  pb.resource.encoder?.setBitrate(SEND_BITRATE);

  const durationSec = audioDurationSec(track, streamInfo, pb.cacheFile);
  if (durationSec) track.duration = durationSec;
  log.info(`재생: ${track.title} (${track.duration}s, offset: ${pb.startOffsetMs}ms, 출처=${pb.cacheFile ? "캐시" : "스트림"})`);

  const audioKey = audioKeyOf(track.audioUrl);
  protectAudio(player, audioKey);
  player.audioPlayer.play(pb.resource);
  // 라이브는 받아 두지 않으므로 적을 것이 없다.
  if (audioKey && !player.isLive) recordPlayed(track, audioKey, source.titleVerified);

  if (player.pauseReasons.size > 0) {
    // 멈추는 건 Playing 리스너다. 지금은 아직 버퍼링이라 pause()가 먹지 않는다
    log.info(`곡을 불러와 일시정지 상태로 둠: 원인=${Array.from(player.pauseReasons).join(", ")}`);
    player.paused = true;
  }

  pb.resume = resumeInfo(track, streamInfo);

  // 정상 완료를 보장하고 성급한 전환을 막기 위해 종료 감시 예약
  player.watch.scheduleEnd(streamInfo);

  player.startStateSync();
  player.warmer.start();
  await player.persistState(pb.startOffsetMs > 0 ? "resume-playback" : "play");

  // 다음 자동재생 곡을 미리 뽑아 둔다. 기다리지 않는다. 재생 시작을 늦추면 안 된다.
  player.ensureAutoplayNext().catch((error) => log.warn(`자동재생 미리 뽑기 실패: ${error?.message || error}`));
}

// 재생 중인 곡을 퇴거 대상에서 보호한다(해제는 releaseAudioProtection)
function protectAudio(player, audioKey) {
  if (player._protectedAudioKey && player._protectedAudioKey !== audioKey) {
    audioCache.unprotect(player._protectedAudioKey);
    player._protectedAudioKey = null;
  }
  if (audioKey) {
    player._protectedAudioKey = audioKey;
    audioCache.protect(audioKey);
  }
}

// 재생 통계와 "이 요청은 이 음원이다"를 DB에 기록.
// 부기일 뿐이므로 실패해도 재생을 끌어내리지 않는다. 여기서 던지면 방금 시작한 소리가 catch에서 멈춘다.
function recordPlayed(track, audioKey, titleVerified) {
  try {
    audioCache.recordPlayback(audioKey);
    trackLookup.recordTrackLookup(track, { verified: titleVerified });
  } catch (error) {
    log.warn(`캐시 장부 기록 실패(재생은 계속): ${error?.message || error}`);
  }
}

// 같은 곡 안에서 위치를 옮길 때 주소를 다시 묻지 않도록 남겨 둔다
function resumeInfo(track, streamInfo) {
  return {
    trackKey: resumeKeyOf(track),
    platform: track.platform,
    fetchedAt: Date.now(),
    resumeSupported: Boolean(streamInfo?.canSeek),
    baseUrl: streamInfo?.rawUrl || streamInfo?.url || null,
    info: streamInfo ?? {},
  };
}

// 조기 종료 · SponsorBlock 곡 끝 판정에 쓰는 실제 오디오 길이. 곡 메타데이터(스포티파이 등)는 오디오와 수 초씩 다르다
function audioDurationSec(track, streamInfo, cacheFile) {
  const key = audioKeyOf(track?.audioUrl);
  if (cacheFile && key) {
    const cached = audioCache.lookupByAudioKey(key)?.duration_sec;
    if (cached > 0) return cached;
  }
  return streamInfo?.duration > 0 ? streamInfo.duration : null;
}

const exported = { prepareStart, resolveSource, commitPlaying, introOffsetMs, audioDurationSec };
export default exported;
export { exported as "module.exports" };
