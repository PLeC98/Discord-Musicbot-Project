// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// 소리를 여는 곳. 받아 둔 파일 · HLS 주소 · 스트림 파이프 셋 중 하나로 ffmpeg 를 띄우고 오디오 리소스를 만든다.
// 어느 갈래로 갈지는 transportOf 가 정했다. 스트림 파이프가 열리지 않으면 나란히 받던 캐시 파일로 연다.

import { StreamType } from "@discordjs/voice";
import { Readable } from "stream";
import fs from "fs";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import config from "../../config.ts";
import audioSplicer from "./audioSplicer.ts";
const { AudioSplicer } = audioSplicer;
import chunkedStream from "./chunkedStream.ts";
const { contentLengthFromUrl, describeStreamError } = chunkedStream;
import args from "./ffmpeg/args.ts";
const { buildFfmpegArgs } = args;

const SWITCH_FADE_MS = 40; // 캐시로 갈아탈 때 등출력 크로스페이드 길이

const sec = (ms) => (ms == null ? "?" : (ms / 1000).toFixed(1));

/**
 * @param {object} o
 * @param {object} o.io  바깥 경계(spawnFfmpeg · createAudioResource · ffmpegCapabilities · openChunkedStream · fetch · directStream)
 * @param {{via: "url" | "pipe" | "file", live: boolean}} o.transport
 * @param {object | null} o.streamInfo  스트림 서술자. 받아 둔 파일로 틀면 없을 수 있다
 * @param {string | null} o.cacheFile  받아 둔 파일
 * @param {number} o.startMs  곡 안의 시작 위치
 * @param {{title: string, url: string, duration: number}} o.meta  리소스에 붙일 곡 정보
 * @param {{start: () => void, filePath: string, wait: (file: string) => Promise<string> | null} | null} o.download
 *   나란히 받는 캐시. 받아 둔 파일이 없고 캐시할 수 있을 때만 있다
 * @param {(splicer: AudioSplicer) => boolean} o.onStreamLost  스트림이 끊기면 캐시로 갈아탈 예약. 예약했으면 true
 * @param {() => void} o.onProgress  입력이 들어왔다(버퍼링 감시가 본다)
 * @param {(code: number | null) => void} o.onExit  주소 갈래 ffmpeg 가 끝났다. 신호로 죽었으면 -1
 * @param {string} o.label  로그용 곡 이름
 * @returns {Promise<{resource: object | null, cacheFile: string | null}>} cacheFile 은 결국 파일로 열었으면 그 경로
 */
async function openInput(o) {
  if (o.transport.via === "url") return openUrl(o);
  if (o.transport.via === "pipe" && o.download) {
    const opened = await openPipe(o);
    if (opened.resource || !opened.cacheFile) return opened;
    return openFile({ ...o, cacheFile: opened.cacheFile });
  }
  return o.cacheFile ? openFile(o) : { resource: null, cacheFile: null };
}

function resourceOf(o, input, duration) {
  return o.io.createAudioResource(input, {
    inputType: StreamType.Raw,
    inlineVolume: true,
    metadata: { title: o.meta.title, url: o.meta.url, duration, bitrate: o.streamInfo?.bitrate || 128 },
  });
}

// 목록에 필요한 ffmpeg 능력. 모르는 방식은 https 만 있으면 ffmpeg 에 맡겨 본다
const CAN_OPEN = {
  hls: (caps) => caps.ok,
  dash: (caps) => caps.https && caps.dash,
  other: (caps) => caps.https,
};

// HLS · DASH. 목록은 "받아 둔 바이트"가 아니라 "받아 올 주소"를 줘야 열린다
function openUrl(o) {
  // 입구(playRequest)와 사운드클라우드 포맷 선택이 먼저 거르지만, 여기까지 온 것은 막는다.
  const list = o.transport.list ?? "hls";
  if (!CAN_OPEN[list](o.io.ffmpegCapabilities())) {
    throw new Error(`이 ffmpeg 빌드로는 ${list === "other" ? o.streamInfo.protocol : list.toUpperCase()} 스트림을 재생할 수 없습니다`);
  }

  // 라이브가 아닌 HLS(사운드클라우드 등)는 평소대로 캐시를 받아 둔다. 재생은 기다리지 않는다.
  o.download?.start();

  const live = o.transport.live;
  const ffmpeg = o.io.spawnFfmpeg(buildFfmpegArgs({ url: o.streamInfo.url, hls: list === "hls", seekMs: live ? 0 : o.startMs, caps: o.io.ffmpegCapabilities() }), "stream");
  // 캐시 전환(AudioSplicer)은 걸지 않는다. 라이브는 갈아탈 캐시가 없고, 잔끊김은
  // ffmpeg의 재접속이 먹는다. 거기서도 못 살리면 종료 코드로 갈라 다시 연다(handleTrackEnd).
  ffmpeg.once("exit", (code, signal) => o.onExit(code === null && signal ? -1 : code));

  // 파이프 갈래는 Node가 받는 바이트로 정체를 재지만 여기엔 그 스트림이 없다.
  // ffmpeg 출력이 곧 "살아 있다"의 증거다.
  ffmpeg.stdout.on("data", () => o.onProgress());

  return { resource: resourceOf(o, ffmpeg.stdout, live ? 0 : o.streamInfo.duration || o.meta.duration), cacheFile: null };
}

// 받아 둔 파일. 미리 받았거나, 스트림이 열리지 않아 나란히 받던 것을 기다렸다
function openFile(o) {
  const ffmpeg = o.io.spawnFfmpeg(buildFfmpegArgs({ file: o.cacheFile, seekMs: o.startMs }), "playback");
  return { resource: resourceOf(o, ffmpeg.stdout, o.streamInfo?.duration || o.meta.duration), cacheFile: o.cacheFile };
}

// 스트림 파이프. 캐시를 나란히 받으면서 기다리지 않고 바로 튼다. 이 갈래에서는 네트워크를 Node가 담당하고
// ffmpeg에는 pipe로만 넣는다. URL을 직접 주면 yt-dlp가 준 httpHeaders가 빠지고, 아래 실패
// 폴백을 건너뛰며, 재생이 ffmpeg 빌드의 네트워크 스택에 의존한다(정적 빌드는 SIGSEGV로 죽는다).
// 그래서 URL 입력은 그렇게 할 수밖에 없는 HLS 갈래에만 두었다.
async function openPipe(o) {
  o.download.start();

  // 청크 스트림이 끊겼을 때 부를 훅. 스플라이서가 만들어진 뒤 채운다
  const hooks = {
    interrupt: () => false,
    resumed: () => {
      /* 스플라이서가 생기기 전에는 알릴 곳이 없다 */
    },
  };
  let audioStream = null;
  if (typeof o.streamInfo?.url === "string") {
    try {
      audioStream = await openStream(o, hooks);
    } catch (error) {
      // 스트리밍 실패. 위에서 시작한 받기로 넘어간다
      return { resource: null, cacheFile: await cacheFallback(o.download, error) };
    }
  }
  if (!audioStream) return { resource: null, cacheFile: o.cacheFile };
  return { resource: pipeResource(o, audioStream, hooks), cacheFile: null };
}

// 스트림을 연다. 첫 요청까지 여기서 끝내 실패가 캐시 폴백으로 가게 한다
async function openStream(o, hooks) {
  const { streamInfo } = o;
  // 트랙의 platform이 아니라 서술자를 본다. AnimeThemes처럼 출처 이름을 platform에
  // 쓰면서 음원을 직접 받는 곡이 있다(streamUrl.getStream이 direct 서술자를 돌려준다).
  // 직접 링크는 SSRF 가드(SafeUrl)를 통과해 스트림을 연다
  if (streamInfo.platform === "direct") return o.io.directStream(streamInfo.url);

  // 오프셋 재생이면 begin= 없는 원본 URL을 받아 `-ss`가 단독으로 위치를 정하게 한다(이중 seek 방지).
  const url = o.startMs > 0 && streamInfo.rawUrl ? streamInfo.rawUrl : streamInfo.url;
  // 평상시엔 yt-dlp가 준 것을 그대로 쓴다. 클라이언트마다 다른 값을 저쪽이 골라 준다.
  // 폴백은 yt-dlp를 안 거친 입력을 위한 것이다.
  const headers = streamInfo.httpHeaders || { "User-Agent": config.userAgents.browser };

  // 전체 길이를 알면 Range로 나눠 받는다. 순차 GET은 서버가 재생시간의 약 2배속으로 조인다.
  // 길이를 모르는 입력은 나눌 수가 없으므로 예전 방식 그대로.
  const totalBytes = contentLengthFromUrl(url);
  if (totalBytes) {
    return o.io.openChunkedStream({
      url,
      headers,
      totalBytes,
      chunkSize: config.stream.chunkBytes,
      onInterrupt: (err) => hooks.interrupt(err),
      onResumed: (info) => hooks.resumed(info),
    });
  }
  const response = await o.io.fetch(url, { headers });
  if (!response.ok) throw new Error(`Failed to fetch stream: ${response.status}`);
  return typeof response.body?.getReader === "function" && typeof Readable.fromWeb === "function" ? Readable.fromWeb(response.body) : response.body;
}

// 스트림이 열리지 않았다. 나란히 받던 캐시가 다 받아졌거나 받는 중이면 그것을 쓴다. 없으면 원래 오류
async function cacheFallback(download, streamError) {
  const file = download.filePath;
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  const inFlight = download.wait(file);
  if (inFlight) {
    try {
      return await inFlight;
    } catch {
      /* 받기도 실패. 원래 스트리밍 오류를 던진다 */
    }
  }
  throw streamError;
}

function pipeResource(o, audioStream, hooks) {
  const ffmpeg = o.io.spawnFfmpeg(buildFfmpegArgs({ seekMs: o.startMs }), "stream");

  // 소스를 갈아끼울 수 있게 리소스 아래에 Splicer를 둔다. 스트림이 죽으면 AudioPlayer를
  // 거치지 않고 캐시 파일로 넘어가므로 공백이 들리지 않는다(onStreamLost).
  const playSource = new AudioSplicer(ffmpeg.stdout, { fadeMs: SWITCH_FADE_MS });

  const streamDetail = () => {
    const st = audioStream.stats?.();
    return st ? `청크 #${st.requests} · ${st.received}/${st.totalBytes}B · 마지막 수신 ${sec(st.idleMs)}초 전 · URL 만료 ${st.expiresInS ?? "?"}초 후` : "단일 GET";
  };
  // 끊기면 캐시 전환을 먼저 시도한다. 예약되면 청크 스트림은 이어받지 않고 받아 둔 데까지만 흘린다
  hooks.interrupt = (err) => {
    log.debug(`스트림 중단: ${describeStreamError(err)} | ${streamDetail()}`);
    return o.onStreamLost(playSource);
  };
  hooks.resumed = ({ attempts, downtimeMs, starvedMs }) => {
    const line = `스트림 이어받음: ${o.label} | 재시도 ${attempts}회, ${sec(downtimeMs)}초`;
    if (starvedMs > 0) log.warn({ tags: ["retry"] }, `${line}. 그동안 공급이 ${sec(starvedMs)}초 끊겼습니다`);
    else log.info({ tags: ["retry", "recovered"] }, line);
  };
  // 이어받기로도 못 살렸다. ffmpeg 입력을 닫아야 출력이 끝나 예약된 전환이나 Idle(→ 끊긴 위치부터 재개)로 넘어간다
  audioStream.on("error", (err) => {
    log.debug(`스트림 중단(복구 불가): ${describeStreamError(err)} | ${streamDetail()}`);
    o.onStreamLost(playSource);
    if (!ffmpeg.stdin.destroyed && !ffmpeg.stdin.writableEnded) ffmpeg.stdin.end();
  });
  // ffmpeg가 끝나면 입력 스트림도 닫는다. .pipe 바깥이라 자동 정리 대상이 아니다.
  ffmpeg.once("exit", () => audioStream.destroy());
  audioStream.pipe(ffmpeg.stdin);
  // pipe 뒤에 붙인다. 먼저 붙이면 흐르기 시작한 데이터가 목적지 없이 버려진다
  audioStream.on("data", () => o.onProgress());

  return resourceOf(o, playSource, o.streamInfo.duration || o.meta.duration);
}

const exported = { openInput };
export default exported;
export { exported as "module.exports" };
