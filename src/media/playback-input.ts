// 소리를 여는 곳. 캐시 파일 · HLS 주소 · 스트림 파이프 셋 중 하나로 ffmpeg 를 실행하고 오디오 리소스를 만든다.
// 어느 분기로 갈지는 transportOf 가 정했다. 스트림 파이프가 열리지 않으면 나란히 다운로드하던 캐시 파일로 연다.

import { codedError } from "../rules/error-kind.ts";
import { StreamType } from "@discordjs/voice";
import { Readable, type Writable } from "stream";
import type { ReadableStream as WebStream } from "stream/web";
import fs from "fs";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import config from "../config/index.ts";
import { AudioSplicer } from "./audio-splicer.ts";
import { contentLengthFromUrl, describeStreamError, isSeekMismatch } from "./chunked-stream.ts";
import { buildFfmpegArgs } from "./ffmpeg/args.ts";
import { InputHealth } from "./input-health.ts";
import type { Capabilities } from "./ffmpeg/path.ts";
import type { ChunkedOptions } from "./chunked-stream.ts";
import type { FragmentOptions } from "./fragment-stream.ts";
import type { DirectInputOptions, Resumable } from "./direct-input.ts";
import type { SeekRequest, SeekAnswer } from "./seek-start.ts";
import type { StreamInfo } from "../sources/stream-url.ts";
import type { Transport } from "../rules/transport-of.ts";

type Splicer = InstanceType<typeof AudioSplicer>;
type ResourceMeta = { title: string | null; url: string; duration: number; bitrate: number };
// 바깥 경계에서 여기서 부르고 읽는 필드만. R 은 오디오 리소스(건드리지 않고 돌려준다)
type FfmpegChild = { stdout: Readable; stderr: Readable; stdin: Writable; kill(signal?: NodeJS.Signals): boolean; once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown };
// startedAtMs: 곡 안의 어디부터 흘리나(조각 스트림은 위치가 든 조각부터, 청크 스트림은 위치 앞의 키프레임부터 받는다. 나머지는 ffmpeg 의 -ss). describe: 끊겼을 때 남길 입력 상태.
// bounded: 직접 링크가 끝이 있고 크기 · 길이를 안다(나란히 다운로드해도 된다). resumable: 끊기면 이을 수 있다(media/direct-input)
type OpenedStream = Readable & {
  headers?: Record<string, unknown>;
  bounded?: boolean;
  resumable?: Resumable;
  stats?(): { requests: number; received: number; totalBytes: number; idleMs: number | null; expiresInS: number | null; resuming?: boolean; startByte?: number };
  startedAtMs?: number;
  describe?(): string;
};
type InputIo<R> = {
  spawnFfmpeg(args: string[], label: string): FfmpegChild;
  createAudioResource(input: Readable, options: { inputType: StreamType; inlineVolume: boolean; metadata: ResourceMeta }): R;
  ffmpegCapabilities(): Capabilities;
  openChunkedStream(opts: ChunkedOptions): Promise<OpenedStream>;
  seekStart(request: SeekRequest): Promise<SeekAnswer>;
  openFragmentStream(opts: FragmentOptions): OpenedStream;
  fetch(url: string, init: { headers: Record<string, string> }): Promise<{ ok: boolean; status: number; body: WebStream<Uint8Array> | Readable | null }>;
  directStream(url: string, opts: DirectInputOptions): Promise<OpenedStream>;
  sleep(ms: number): Promise<void>;
};
type Download = { start(): void; filePath: string; wait(file: string): Promise<string> | null };
type InputOptions<R> = {
  io: InputIo<R>;
  transport: Transport;
  streamInfo: StreamInfo | null;
  cacheFile: string | null;
  startMs: number;
  meta: { title: string | null; url: string; duration: number };
  download: Download | null;
  onStreamLost(splicer: Splicer): boolean;
  onProgress(): void;
  /** 라이브로 담은 곡이다(직접 링크 HLS 의 목록이 끝났으면 live-ended) */
  liveOnly?: boolean;
  /** 주소를 새로 받는다. 부르는 쪽은 다시 쓴 주소(streamInfo.reused)일 때만 주고, 열리지 않으면 한 번 부른다 */
  refresh?: (() => Promise<StreamInfo>) | null;
  label: string;
};
/** streamInfo: 새로 받은 주소로 열었으면 그 서술자(다시 열 때 그것을 쓰게) */
type Opened<R> = { resource: R | null; cacheFile: string | null; health: InputHealth | null; streamInfo?: StreamInfo };
type Hooks = { interrupt(err: unknown): boolean; resumed(info: { attempts: number; downtimeMs: number; starvedMs: number }): void };

const SWITCH_FADE_MS = 40; // 캐시로 갈아탈 때 등출력 크로스페이드 길이

const sec = (ms: number | null | undefined) => (ms == null ? "?" : (ms / 1000).toFixed(1));

/**
 * @param o.io  바깥 경계(spawnFfmpeg · createAudioResource · ffmpegCapabilities · openChunkedStream · fetch · directStream)
 * @param o.streamInfo  스트림 서술자. 캐시 파일로 틀면 없을 수 있다
 * @param o.cacheFile  캐시 파일
 * @param o.startMs  곡 안의 시작 위치
 * @param o.meta  리소스에 붙일 곡 정보
 * @param o.download
 *   나란히 다운로드하는 캐시. 캐시 파일이 없고 캐시할 수 있을 때만 있다. 없으면 스트림만 튼다
 * @param o.onStreamLost  스트림이 끊기면 캐시로 갈아탈 예약. 예약했으면 true
 * @param o.onProgress  입력이 들어왔다(버퍼링 감시가 본다)
 * @param o.label  로그용 곡 이름
 * @returns cacheFile 은 결국 파일로 열었으면 그 경로. health 는 연 소스의 온전함(곡 끝 판정이 본다)
 */
async function openInput<R>(o: InputOptions<R>): Promise<Opened<R>> {
  // 주소 분기는 스트림 주소가 있어야 정해진다(transportOf)
  if (o.transport.via === "url" && o.streamInfo) return openUrl(o, o.streamInfo);
  if (o.transport.via === "pipe") {
    const opened = await openPipe(o, o.download);
    if (opened.resource || !opened.cacheFile) return opened;
    return openFile({ ...o, cacheFile: opened.cacheFile });
  }
  return o.cacheFile ? openFile(o) : { resource: null, cacheFile: null, health: null };
}

function resourceOf<R>(o: InputOptions<R>, input: Readable, duration: number): R {
  return o.io.createAudioResource(input, {
    inputType: StreamType.Raw,
    inlineVolume: true,
    metadata: { title: o.meta.title, url: o.meta.url, duration, bitrate: o.streamInfo?.bitrate || 128 },
  });
}

// 목록에 필요한 ffmpeg 능력. 모르는 방식은 https 만 있으면 ffmpeg 에 맡겨 본다
const CAN_OPEN: Record<"hls" | "dash" | "other", (caps: Capabilities) => boolean> = {
  hls: (caps) => caps.ok,
  dash: (caps) => caps.https && caps.dash,
  other: (caps) => caps.https,
};

// HLS · DASH. 목록은 "받아 둔 바이트"가 아니라 "받아 올 주소"를 줘야 열린다
function openUrl<R>(o: InputOptions<R>, streamInfo: StreamInfo): Opened<R> {
  // 진입점(playRequest)과 사운드클라우드 포맷 선택이 먼저 필터링하지만, 여기까지 온 것은 막는다.
  const list = o.transport.list ?? "hls";
  if (!CAN_OPEN[list](o.io.ffmpegCapabilities())) {
    throw codedError("stream-failed", `이 ffmpeg 빌드로는 ${list === "other" ? (streamInfo.protocol ?? "없음") : list.toUpperCase()} 스트림을 재생할 수 없습니다`);
  }

  // 라이브가 아닌 HLS(사운드클라우드 등)는 평소대로 캐시를 다운로드해 둔다. 재생은 기다리지 않는다.
  o.download?.start();

  const live = o.transport.live;
  const ffmpeg = o.io.spawnFfmpeg(buildFfmpegArgs({ url: streamInfo.url, hls: list === "hls", seekMs: live ? 0 : o.startMs, caps: o.io.ffmpegCapabilities() }), "stream");
  // 캐시 전환(AudioSplicer)은 걸지 않는다. 라이브는 갈아탈 캐시가 없고, 잔끊김은
  // ffmpeg의 재접속이 먹는다. 거기서도 못 살리면 종료 코드로 구분해 다시 연다(onTrackEnd).
  const health = new InputHealth(list === "hls" ? "HLS" : list === "dash" ? "DASH" : "주소").watch(ffmpeg);
  if (list === "hls") watchSegmentSkips(o, ffmpeg, health, live);

  // 파이프 분기는 Node가 받는 바이트로 정체를 재지만 여기엔 그 스트림이 없다.
  // ffmpeg 출력이 곧 "살아 있다"의 증거다.
  ffmpeg.stdout.on("data", () => o.onProgress());

  return { resource: resourceOf(o, ffmpeg.stdout, live ? 0 : streamInfo.duration || o.meta.duration), cacheFile: null, health };
}

// HLS 는 세그먼트를 끝내 못 받으면 건너뛰고 이어 흘린 뒤 0 으로 끝난다(빠진 만큼 소리가 짧다).
// 다시보기는 그 자리에서 입력을 끊는다. 이어 흘린 채 끝나면 끊긴 위치가 빠진 길이만큼 앞당겨져, 그 위치부터 다시 열 때 들은 끝부분을 되풀이한다.
// 끊어 두면 곡 끝 판정이 입력 깨짐으로 보고 빠진 세그먼트 앞에서 다시 연다. 라이브는 짧은 빈틈보다 다시 붙는 공백이 길어 이어 튼다
const SEGMENT_SKIPPED = /failed too many times, skipping/;

function watchSegmentSkips<R>(o: InputOptions<R>, ffmpeg: FfmpegChild, health: InputHealth, live: boolean) {
  let pending = "";
  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    const lines = (pending + chunk.toString()).split(/\r?\n/);
    pending = lines.pop() ?? "";
    const skipped = lines.find((line) => SEGMENT_SKIPPED.test(line));
    if (!skipped) return;
    const what = skipped.replace(/^\[[^\]]*\]\s*/, "").trim();
    if (live) {
      log.warn(`라이브 HLS 세그먼트를 건너뛰고 이어 틉니다: ${o.label} | ${what}`);
      return;
    }
    log.warn(`HLS 세그먼트를 받지 못해 입력을 끊고 그 위치부터 다시 엽니다: ${o.label} | ${what}`);
    health.mark(`HLS 세그먼트를 건너뜀: ${what}`);
    ffmpeg.kill("SIGKILL");
  });
}

// 캐시 파일. 미리 다운로드했거나, 스트림이 열리지 않아 나란히 다운로드하던 것을 기다렸다
function openFile<R>(o: InputOptions<R>): Opened<R> {
  const ffmpeg = o.io.spawnFfmpeg(buildFfmpegArgs({ file: o.cacheFile, seekMs: o.startMs }), "playback");
  return { resource: resourceOf(o, ffmpeg.stdout, o.streamInfo?.duration || o.meta.duration), cacheFile: o.cacheFile, health: new InputHealth("파일").watch(ffmpeg) };
}

// 스트림 파이프. 캐시를 나란히 다운로드하면서 기다리지 않고 바로 튼다. 이 분기에서는 네트워크를 Node가 담당하고
// ffmpeg에는 pipe로만 넣는다. URL을 직접 주면 yt-dlp가 준 httpHeaders가 빠지고, 아래 실패
// 폴백을 건너뛰며, 재생이 ffmpeg 빌드의 네트워크 스택에 의존한다(정적 빌드는 SIGSEGV로 죽는다).
// 그래서 URL 입력은 그렇게 할 수밖에 없는 HLS 분기에만 두었다.
async function openPipe<R>(o: InputOptions<R>, download: Download | null): Promise<Opened<R>> {
  // 직접 링크는 연 것을 보고 다운로드할지 정한다. 끝을 알 수 없는 스트림을 나란히 다운로드하면 디스크를 한도까지 채운다
  const direct = o.streamInfo?.platform === "direct";
  if (!direct) download?.start();

  // 청크 스트림이 끊겼을 때 부를 훅. 스플라이서가 만들어진 뒤 채운다
  const hooks: Hooks = {
    interrupt: () => false,
    resumed: () => {
      /* 스플라이서가 생기기 전에는 알릴 곳이 없다 */
    },
  };
  let streamInfo = o.streamInfo;
  let audioStream: OpenedStream | null = null;
  if (typeof streamInfo?.url === "string") {
    try {
      audioStream = await openStream(o, streamInfo, hooks);
    } catch (error) {
      const again = await reopenFresh(o, hooks, error);
      if (!again) return fallBack(o, download, direct, error);
      ({ streamInfo, audioStream } = again);
    }
  }
  if (!audioStream || !streamInfo) return { resource: null, cacheFile: o.cacheFile, health: null };
  if (direct && download) {
    if (audioStream.bounded) download.start();
    else log.debug(`끝이나 크기를 모르는 입력이라 다운로드해 두지 않고 스트림으로만 틉니다: ${o.label}`);
  }
  return { ...pipeResource(o, streamInfo, audioStream, hooks), ...(streamInfo !== o.streamInfo ? { streamInfo } : {}) };
}

// 스트리밍 실패. 다운로드로 넘어간다. 다운로드하지 않는 곡이면 원래 오류
async function fallBack<R>(o: InputOptions<R>, download: Download | null, direct: boolean, error: unknown): Promise<Opened<R>> {
  if (!download) throw error;
  if (direct) download.start();
  const file = await cacheFallback(download, error);
  log.info(`스트림을 열지 못해 다운로드한 캐시로 틉니다: ${o.label} | ${describeStreamError(error)}`);
  return { resource: null, cacheFile: file, health: null };
}

// 다시 쓴 주소(받아 둔 영상 정보 · 직전 재생의 주소)가 열리지 않았다. 주소는 추출한 IP 에 묶여 망을 옮기면 안 열린다.
// 새로 받아 한 번 더 연다. 그것도 안 되면 null(원래 오류로 캐시 폴백에 맡긴다)
async function reopenFresh<R>(o: InputOptions<R>, hooks: Hooks, error: unknown): Promise<{ streamInfo: StreamInfo; audioStream: OpenedStream | null } | null> {
  if (!o.refresh) return null;
  log.info(`다시 쓴 스트림 주소가 열리지 않아 주소를 새로 받습니다: ${o.label} | ${describeStreamError(error)}`);
  try {
    const streamInfo = await o.refresh();
    return { streamInfo, audioStream: await openStream(o, streamInfo, hooks) };
  } catch (again) {
    log.debug(`새로 받은 주소도 열리지 않았습니다: ${o.label} | ${describeStreamError(again)}`);
    return null;
  }
}

// 앞 광고를 이보다 오래 기다리지는 않는다. 넘으면 원래 오류로 캐시 폴백에 맡긴다
const AD_WAIT_MAX_MS = 60_000;

/**
 * 스트림을 연다. 첫 요청까지 여기서 끝내 실패가 캐시 폴백으로 가게 한다.
 * 유튜브는 앞 광고가 붙은 응답이면 광고가 끝날 때까지 본편 요청을 403 으로 막는다(클라이언트에 따라 막지 않기도 한다).
 * 곧바로 열어 보고, 막혔는데 광고가 끝나는 시각(availableAt)이 아직이면 그때까지 기다려 한 번 더 연다
 */
async function openStream<R>(o: InputOptions<R>, streamInfo: StreamInfo, hooks: Hooks): Promise<OpenedStream | null> {
  try {
    return await openStreamOnce(o, streamInfo, hooks);
  } catch (error) {
    const waitMs = adWaitMs(error, streamInfo.availableAt, Date.now());
    if (waitMs === null) throw error;
    log.debug(`스트림이 앞 광고 시간이라 막혀 있어 ${sec(waitMs)}초 기다렸다 다시 엽니다: ${o.label}`);
    await o.io.sleep(waitMs);
    return openStreamOnce(o, streamInfo, hooks);
  }
}

// 403 이고 광고가 끝나는 시각(초)이 아직이면 기다릴 ms. 아니면 null(다른 까닭의 실패)
function adWaitMs(error: unknown, availableAt: number | null | undefined, now: number): number | null {
  if ((error as { status?: unknown } | null)?.status !== 403 || typeof availableAt !== "number") return null;
  const ms = availableAt * 1000 - now;
  return ms > 0 && ms <= AD_WAIT_MAX_MS ? ms : null;
}

async function openStreamOnce<R>(o: InputOptions<R>, streamInfo: StreamInfo, hooks: Hooks): Promise<OpenedStream | null> {
  // 트랙의 platform이 아니라 서술자를 본다. AnimeThemes처럼 출처 이름을 platform에
  // 쓰면서 음원을 직접 받는 곡이 있다(streamUrl.getStream이 direct 서술자를 돌려준다).
  if (streamInfo.platform === "direct") return openDirect(o, streamInfo.url, hooks);

  const { url } = streamInfo;
  // 평상시엔 yt-dlp가 준 것을 그대로 쓴다. 클라이언트마다 다른 값을 저쪽이 선택해 준다.
  // 폴백은 yt-dlp를 안 거친 입력을 위한 것이다.
  const headers = streamInfo.httpHeaders || { "User-Agent": config.userAgents.browser };

  // 조각 목록. 위치가 든 조각부터 받는다
  if (streamInfo.fragments) return o.io.openFragmentStream({ fragments: streamInfo.fragments, durationMs: (streamInfo.duration || o.meta.duration) * 1000, startMs: o.startMs, headers });

  // 전체 길이를 알면 Range로 나눠 받는다. 순차 GET은 서버가 재생시간의 약 2배속으로 조인다.
  // 길이를 모르는 입력은 나눌 수가 없으므로 예전 방식 그대로(처음부터 받고 위치는 ffmpeg 의 -ss 가 정한다).
  const totalBytes = contentLengthFromUrl(url);
  if (totalBytes) return openChunked(o, { url, headers, totalBytes, durationMs: (streamInfo.duration || o.meta.duration) * 1000 }, hooks);
  const response = await o.io.fetch(url, { headers });
  if (!response.ok) throw Object.assign(codedError("stream-failed", `스트림을 받지 못했습니다(HTTP ${response.status})`), { status: response.status });
  const { body } = response;
  return body && "getReader" in body ? Readable.fromWeb(body) : body;
}

/**
 * 청크 스트림. 먼 위치면 파일의 색인으로 목표 앞의 키프레임 바이트부터 받고(머리를 먼저 흘린다, media/seek-start) 나머지는 ffmpeg 의 -ss 가 맞춘다.
 * 색인이 없거나 · 받지 못하거나 · 그 자리가 색인 탓으로 열리지 않으면 처음부터 받는다(주소 · 네트워크 탓의 실패는 그대로 던진다)
 */
async function openChunked<R>(o: InputOptions<R>, { url, headers, totalBytes, durationMs }: { url: string; headers: Record<string, string>; totalBytes: number; durationMs: number }, hooks: Hooks): Promise<OpenedStream> {
  const chunkSize = config.stream.chunkBytes;
  const base: ChunkedOptions = { url, headers, totalBytes, chunkSize, onInterrupt: (err) => hooks.interrupt(err), onResumed: (info) => hooks.resumed(info) };
  if (!(o.startMs > 0)) return o.io.openChunkedStream(base);
  const seek = await o.io.seekStart({ url, headers, totalBytes, startMs: o.startMs, durationMs, chunkBytes: chunkSize });
  if (!seek.ok) {
    if (seek.slow) log.warn(`색인을 받지 못해 처음부터 받습니다: ${o.label} | ${seek.why}`);
    else if (!seek.near) log.debug(`색인을 쓰지 않고 처음부터 받습니다: ${o.label} | ${seek.why}`);
    return o.io.openChunkedStream(base);
  }
  const { header, startByte, startedAtMs, expectStart } = seek.start;
  try {
    const stream = await o.io.openChunkedStream({ ...base, startByte, prefix: header, expectStart });
    log.debug(`색인으로 키프레임부터 받습니다: ${o.label} | ${sec(startedAtMs)}초 지점(${startByte}B)에서 ${sec(o.startMs - startedAtMs)}초 풀어 버림`);
    return Object.assign(stream, { startedAtMs });
  } catch (error) {
    if (!isSeekMismatch(error)) throw error;
    log.warn(`색인이 가리킨 자리로 열지 못해 처음부터 받습니다: ${o.label} | ${describeStreamError(error)}`);
    return o.io.openChunkedStream(base);
  }
}

/**
 * 직접 링크는 SSRF 가드(SafeUrl)를 통과해 연다. HLS VOD 는 위치가 든 조각부터 받는다.
 * 이을 수 있는 파일은 청크 스트림으로: 연 응답을 끝까지 흘리고, 끊기면 캐시 전환을 먼저 묻고 받은 자리부터 Range 로 잇는다
 */
async function openDirect<R>(o: InputOptions<R>, url: string, hooks: Hooks): Promise<OpenedStream> {
  const input = await o.io.directStream(url, { startMs: o.startMs, liveOnly: o.liveOnly });
  if (!input.resumable) return input;
  const { totalBytes, validator, fetch } = input.resumable;
  const chunked = await o.io.openChunkedStream({
    url,
    totalBytes,
    chunkSize: config.stream.chunkBytes,
    first: input,
    ifRange: validator,
    fetchImpl: fetch,
    onInterrupt: (err) => hooks.interrupt(err),
    onResumed: (info) => hooks.resumed(info),
  });
  return Object.assign(chunked, { headers: input.headers, bounded: input.bounded });
}

// 스트림이 열리지 않았다. 나란히 다운로드하던 캐시가 다운로드가 끝났거나 다운로드 중이면 그것을 쓴다. 없으면 원래 오류
async function cacheFallback(download: Download, streamError: unknown): Promise<string> {
  const file = download.filePath;
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  const inFlight = download.wait(file);
  if (inFlight) {
    try {
      return await inFlight;
    } catch {
      /* 다운로드도 실패. 원래 스트리밍 오류를 던진다 */
    }
  }
  throw streamError;
}

function pipeResource<R>(o: InputOptions<R>, streamInfo: StreamInfo, audioStream: OpenedStream, hooks: Hooks): Opened<R> {
  // 스트림이 곡 중간부터 흘리면(조각 스트림) 그 앞은 이미 건너뛰었다
  const ffmpeg = o.io.spawnFfmpeg(buildFfmpegArgs({ seekMs: o.startMs - (audioStream.startedAtMs ?? 0) }), "stream");
  // 입력을 닫아 ffmpeg 가 0 으로 끝나도 스트림이 깨졌으면 끝이 아니다. 오류와 덜 받은 채 끝남을 따로 적는다
  const kind = streamInfo.fragments ? "조각" : audioStream.stats ? "청크" : streamInfo.platform === "direct" ? "직접 링크" : "단일 GET";
  const health = new InputHealth(kind).watch(ffmpeg);

  // 소스를 교체할 수 있게 리소스 아래에 Splicer를 둔다. 스트림이 죽으면 AudioPlayer를
  // 거치지 않고 캐시 파일로 넘어가므로 공백이 들리지 않는다(onStreamLost).
  const playSource = new AudioSplicer(ffmpeg.stdout, { fadeMs: SWITCH_FADE_MS });

  const streamDetail = () => {
    const st = audioStream.stats?.();
    if (audioStream.describe) return audioStream.describe();
    return st ? `청크 #${st.requests} · ${st.received}/${st.totalBytes}B · 마지막 수신 ${sec(st.idleMs)}초 전 · URL 만료 ${st.expiresInS ?? "?"}초 후${st.startByte ? ` · 시작 ${st.startByte}B` : ""}${st.resuming ? " · 이어받는 중" : ""}` : "단일 GET";
  };
  health.detail = () => (audioStream.stats || audioStream.describe ? streamDetail() : null);
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
  audioStream.on("error", (err: Error) => {
    log.debug(`스트림 중단(복구 불가): ${describeStreamError(err)} | ${streamDetail()}`);
    health.mark(`입력 스트림 오류: ${describeStreamError(err)}`);
    o.onStreamLost(playSource);
    if (!ffmpeg.stdin.destroyed && !ffmpeg.stdin.writableEnded) ffmpeg.stdin.end();
  });
  // ffmpeg가 끝나면 입력 스트림도 닫는다. .pipe 바깥이라 자동 정리 대상이 아니다.
  ffmpeg.once("exit", () => audioStream.destroy());
  audioStream.pipe(ffmpeg.stdin);
  // 캐시로 넘겨주기로 한 청크 스트림은 받은 데까지만 흘리고 끝난다. 전체 크기를 아는 스트림만 구분할 수 있다
  audioStream.once("end", () => {
    const st = audioStream.stats?.();
    if (st && st.received < st.totalBytes) health.mark(`입력 스트림이 덜 받고 끝남 (${st.received}/${st.totalBytes}B)`);
  });
  // pipe 뒤에 붙인다. 먼저 붙이면 흐르기 시작한 데이터가 목적지 없이 버려진다
  audioStream.on("data", () => o.onProgress());

  return { resource: resourceOf(o, playSource, streamInfo.duration || o.meta.duration), cacheFile: null, health };
}

export { openInput };
