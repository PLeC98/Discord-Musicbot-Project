// 직접 링크의 HLS: 재생목록을 읽고(rules/hls-playlist) 받을 세그먼트를 차례로 내놓는다. 받아 흘리는 것은 media/fragment-stream 이 한다.
// 모든 요청(상위, 하위 목록, 세그먼트, 초기화 세그먼트, 키)이 SafeUrl(가드)을 지난다. ffmpeg 는 주소를 보지 않는다.
//   상위 목록   오디오 전용 하위 목록이 있으면 그것, 없으면 대역폭이 가장 낮은 화질(chooseMedia). 하위 목록을 한 번 더 받는다
//   VOD        끝 표시(EXT-X-ENDLIST)가 있다. 위치가 든 세그먼트부터, 끝까지 받으면 끝. 받은 크기를 합쳐 음원 상한으로 센다
//   라이브      끝에서 LIVE_EDGE 세그먼트 앞부터. 목록을 목표 길이마다 다시 받아(바뀌지 않았으면 그 절반 뒤) 순번으로 잇는다.
//              끝 표시가 생기면 깨끗이 끝나고, 목록을 연달아 받지 못하면 오류로 끝난다(끝 판정이 "방송이 끝남"으로 읽지 않게)
//   암호화     AES-128 은 키를 받아 복호화하고(IV 가 없으면 세그먼트 순번), 그 밖(SAMPLE-AES 등 DRM)은 거절한다. 초기화 세그먼트는 복호화하지 않는다
// 바이트 구간(EXT-X-BYTERANGE)은 끝이 있는 Range로 받아 모은다. 구간을 무시하고 200으로 주는 서버면 그 구간만 잘라 쓴다(구간 끝이 세그먼트 상한 안일 때).
// 구간 없는 세그먼트는 작고 빨리 오면 모으고(실패하면 처음부터 다시), 크거나 늦으면 모으지 않고 받는 쪽(media/direct-input)에 넘긴다(HlsPour).
// 모으는 동안은 ffmpeg에 입력이 없어 재생 쪽 감시(끊김 10초, 버퍼링 15초)에 걸린다. 넘긴 세그먼트는 받는 쪽이 흘리고, 알린 크기가 있으면 끊긴 위치부터 잇는다

import crypto from "node:crypto";
import type { Readable } from "node:stream";
import * as SafeUrl from "../infra/safe-url.ts";
import { codedError, codeOf, messageOf } from "../rules/error-kind.ts";
import { parsePlaylist, chooseMedia, lengthOf, type MediaPlaylist, type Segment, type ByteRange, type Key } from "../rules/hls-playlist.ts";
import type { AudioStream, StreamNet } from "./direct-open.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "link" });

/** 받을 것 하나: 세그먼트거나, 초기화 세그먼트가 바뀌었을 때의 초기화 세그먼트 */
type HlsPart = { url: string; range: ByteRange | null; key: Key | null; sequence: number };
/**
 * 모으지 않고 넘긴 세그먼트. 받는 쪽(media/direct-input)이 주인이 되어 흘리고 닫는다.
 * totalBytes: 알린 크기로 곧바로 넘겼다(body는 처음부터 남아 있다. 끊기면 url로 Range 이어 받기). null이면 모으다 넘겼다(head 뒤에 body의 나머지, 잇지 않는다).
 * key, iv: AES-128일 때. get: 이어 받기, 끝 블록 확인에 쓰는 요청(이 HLS의 net). count: VOD 합계에 받은 바이트(암호문)를 더한다(넘으면 던진다)
 */
type HlsPour = {
  kind: "pour";
  url: string;
  body: AudioStream;
  head: Buffer | null;
  headers: Record<string, unknown>;
  totalBytes: number | null;
  key: Buffer | null;
  iv: Buffer | null;
  idleMs: number;
  get: StreamNet["getStream"];
  count(bytes: number): void;
};
/** media/fragment-stream의 출처 모양(레이어 순서상 그 타입을 쓰지 않는다). 넘긴 세그먼트는 받는 쪽이 흘릴 스트림으로 바꾼다 */
type HlsFragments = {
  next(): Promise<HlsPart | null>;
  fetch(part: HlsPart, signal: AbortSignal, progress?: () => void): Promise<Buffer | HlsPour>;
  startedAtMs: number;
  describe(sent: number): string;
  close(): void;
};
type Hls = {
  live: boolean;
  /** VOD 의 길이(EXTINF 의 합). 라이브는 null */
  durationMs: number | null;
  /** startMs 가 든 세그먼트부터 받는 출처(라이브는 위치를 보지 않는다) */
  fragments(startMs?: number): HlsFragments;
  /** 세그먼트 받기의 무응답 한도(받는 쪽의 세그먼트 스트림, 이어 받기도 같은 값) */
  idleMs: number;
};
/** bodyIdleMs: 세그먼트 본문의 무응답 한도(여는 쪽이 정한다. 없으면 HLS_IDLE_MS) */
type HlsOptions = { net?: StreamNet; sleep?: (ms: number) => Promise<void>; bodyIdleMs?: number };

/** 목록, 키는 작다 */
const LIST_ACCEPT: SafeUrl.Accept = { contentType: /(?:)/, maxBytes: 1024 * 1024, timeoutMs: SafeUrl.HEAD_TIMEOUT_MS };
const KEY_ACCEPT: SafeUrl.Accept = { contentType: /(?:)/, maxBytes: 1024, timeoutMs: SafeUrl.HEAD_TIMEOUT_MS };
/** 바이트 구간 세그먼트를 모으는 상한(받는 것과 미리 받는 것이 함께 메모리에 있다). 형식은 판정하지 않는다(ffmpeg의 형식 필터가 본다) */
const PART_ACCEPT: SafeUrl.Accept = { ...SafeUrl.DIRECT_LINK, contentType: /(?:)/, maxBytes: 64 * 1024 * 1024 };
/** 바이트 구간 세그먼트. 구간을 무시하는 서버는 파일 전체의 크기를 알려 오니 파일 상한으로 열고, 모으는 양은 구간 끝까지로 묶는다(fetchPart) */
const RANGED_ACCEPT: SafeUrl.Accept = { ...PART_ACCEPT, maxBytes: SafeUrl.MAX_BYTES };
/** 구간 없는 세그먼트. 크면 모으지 않고 흘리니 파일 상한으로 연다 */
const WHOLE_ACCEPT: SafeUrl.Accept = { ...PART_ACCEPT, maxBytes: SafeUrl.MAX_BYTES };
/** 여는 쪽이 무응답 한도를 주지 않을 때(캐시 다운로드). 재생은 플레이어가 버티는 10초보다 짧게 준다 */
const HLS_IDLE_MS = 10_000;
/** 이보다 크거나 모으는 데 이보다 오래 걸리면(응답 헤더부터) 모으지 않고 넘긴다. 0.6Mbps에서 1MB가 버퍼링 감시(15초) 안이다 */
const GATHER_MAX_BYTES = 1024 * 1024;
const GATHER_MAX_MS = 3000;
/** 키를 몇 개까지 기억하나(키를 돌리는 라이브는 새 키만 쓴다) */
const KEYS_KEPT = 4;
/** 라이브를 끝에서 몇 세그먼트 앞부터 트나 */
const LIVE_EDGE = 3;
/** 라이브 목록을 연달아 이만큼 받지 못하면 오류로 끝난다 */
const RELOAD_FAILURES = 3;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const ignore = () => {
  /* 받는 쪽이 오류를 따로 처리한다 */
};

/** 다시 받아도 같은 실패(4xx, 상한, DRM) */
const permanent = (error: Error) => Object.assign(error, { permanent: true });
/** 가드가 막은 요청(내부 주소, 크기 상한, 받는 형식)과 4xx 로 거절한 요청은 다시 받지 않는다 */
async function settled<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    throw error instanceof SafeUrl.SsrfError || (typeof status === "number" && status < 500) ? permanent(error as Error) : error;
  }
}

/** 본문을 끝까지(slice가 있으면 그 구간까지만) 모은다. 청크마다 progress. signal이 끊으면(이미 끊겼어도) 본문을 강제로 닫고 그 사유로 던진다 */
async function collect(body: Readable, { signal, slice, progress }: { signal?: AbortSignal; slice?: ByteRange | null; progress?: () => void } = {}): Promise<Buffer> {
  const stop = () => body.destroy(signal?.reason instanceof Error ? signal.reason : new Error("그만 받음"));
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    const end = slice ? slice.offset + slice.length : Infinity;
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      length += chunk.length;
      progress?.();
      if (length >= end) break;
    }
    const all = Buffer.concat(chunks);
    return slice ? all.subarray(slice.offset, end) : all;
  } finally {
    signal?.removeEventListener("abort", stop);
    body.destroy();
  }
}

/**
 * 구간 없는 세그먼트를 모은다. 끝나면 { done }, GATHER_MAX_BYTES를 넘거나 GATHER_MAX_MS가 지나면 본문을 멈추고(부수지 않는다) 모은 앞부분 { head }.
 * 청크마다 progress. signal이 끊으면 본문을 강제로 닫고 그 사유로 던진다
 */
function gather(body: Readable, signal: AbortSignal, progress: () => void): Promise<{ done: Buffer } | { head: Buffer }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    const cleanup = () => {
      clearTimeout(timer);
      body.off("data", onData);
      body.off("end", onEnd);
      body.off("error", onError);
      body.off("close", onClose);
      signal.removeEventListener("abort", onAbort);
    };
    const handOff = () => {
      body.pause();
      cleanup();
      resolve({ head: Buffer.concat(chunks) });
    };
    // 문자열 청크는 바이트로. 그 밖(객체)은 그 세그먼트의 실패로(이벤트 안에서 던지면 아무도 받지 못한다)
    const onData = (chunk: unknown) => {
      const piece = Buffer.isBuffer(chunk) ? chunk : typeof chunk === "string" ? Buffer.from(chunk) : null;
      if (!piece) {
        body.destroy();
        return onError(new TypeError(`세그먼트 본문의 청크가 바이트가 아닙니다(${typeof chunk})`));
      }
      chunks.push(piece);
      length += piece.length;
      progress();
      if (length > GATHER_MAX_BYTES) handOff();
    };
    const onEnd = () => {
      cleanup();
      resolve({ done: Buffer.concat(chunks) });
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    // 오류 없이 닫혔다(끝 전에). 다시 받을 수 있는 실패
    const onClose = () => {
      if (!body.readableEnded) onError(Object.assign(new Error("세그먼트 본문이 끝나기 전에 닫혔습니다"), { code: "ERR_STREAM_PREMATURE_CLOSE" }));
    };
    const onAbort = () => {
      cleanup();
      body.destroy();
      reject(signal.reason);
    };
    const timer = setTimeout(handOff, GATHER_MAX_MS);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    body.on("data", onData);
    body.once("end", onEnd);
    body.once("error", onError);
    body.once("close", onClose);
  });
}

/** 현재 대기만 신호로 끊는다(진행 중인 요청은 그대로 둔다. 키는 다른 세그먼트도 기다린다) */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/** 목록 하나를 받아 하위 목록으로(상위 목록이면 고른 하위 목록을 한 번 더). 상대 주소는 리다이렉트를 거친 마지막 주소 기준 */
async function mediaOf(text: string, url: string, net: StreamNet, depth = 0): Promise<{ playlist: MediaPlaylist; url: string }> {
  const playlist = parsePlaylist(text, url);
  if (!playlist) throw codedError("unsupported-link", "HLS 재생목록이 아닙니다");
  if (playlist.kind === "media") return { playlist, url };
  const chosen = chooseMedia(playlist);
  if (!chosen || depth > 0) throw codedError("unsupported-link", "HLS 상위 목록에 받을 하위 목록이 없습니다");
  const next = await fetchList(chosen, net);
  return mediaOf(next.text, next.url, net, depth + 1);
}

async function fetchList(url: string, net: StreamNet): Promise<{ text: string; url: string }> {
  const body = await net.getStream(url, undefined, { accept: LIST_ACCEPT });
  const finalUrl = body.url ?? url;
  return { text: (await collect(body)).toString("utf8"), url: finalUrl };
}

/** DRM(AES-128 밖의 암호)이 걸린 세그먼트가 있으면 거절 */
function assertPlayable(playlist: MediaPlaylist): void {
  if (playlist.segments.some((segment) => segment.key?.method === "OTHER")) throw permanent(codedError("unsupported-link", "DRM 으로 잠긴 HLS 입니다"));
}

/** 세그먼트 순번의 IV(16바이트 빅엔디언) */
function sequenceIv(sequence: number): Buffer {
  const iv = Buffer.alloc(16);
  iv.writeBigUInt64BE(BigInt(sequence), 8);
  return iv;
}

/** AES-128-CBC 복호화. 실패하면(키, IV 가 틀림) 다시 받아도 같다 */
function decrypt(bytes: Buffer, key: Buffer, iv: Buffer): Buffer {
  try {
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
    return Buffer.concat([decipher.update(bytes), decipher.final()]);
  } catch (error) {
    throw permanent(new Error(`HLS 세그먼트를 풀지 못했습니다: ${(error as Error).message}`));
  }
}

/**
 * HLS 를 연다. text, url 은 여는 함수(direct-open)가 받은 목록과 그 마지막 주소.
 * 목록이 아니거나 받을 하위 목록이 없거나 DRM 이면 unsupported-link, 하위 목록을 받지 못하면 SafeUrl 의 오류를 던진다
 */
async function openHls(text: string, url: string, { net = { getStream: SafeUrl.getStream }, sleep = realSleep, bodyIdleMs = HLS_IDLE_MS }: HlsOptions = {}): Promise<Hls> {
  const first = await mediaOf(text, url, net);
  assertPlayable(first.playlist);
  const live = !first.playlist.ended;
  return {
    live,
    durationMs: live ? null : Math.round(lengthOf(first.playlist) * 1000),
    fragments: (startMs = 0) => fragmentsOf(first, { net, sleep, idleMs: bodyIdleMs }, live ? null : startMs),
    idleMs: bodyIdleMs,
  };
}

/** 받을 세그먼트를 차례로 내놓는 출처. startMs 가 null 이면 라이브(끝 가까이부터, 목록을 다시 받으며) */
function fragmentsOf(first: { playlist: MediaPlaylist; url: string }, { net, sleep, idleMs }: { net: StreamNet; sleep: (ms: number) => Promise<void>; idleMs: number }, startMs: number | null): HlsFragments {
  let playlist = first.playlist;
  const keys = new Map<string, Promise<Buffer>>();
  let received = 0; // VOD 의 받은 바이트(음원 상한)
  let closed = false;
  let reloads = 0;

  // 처음 받을 세그먼트
  let startIndex = Math.max(0, playlist.segments.length - LIVE_EDGE);
  let startedAtMs = 0;
  if (startMs !== null) {
    startIndex = 0;
    let at = 0;
    for (const [index, segment] of playlist.segments.entries()) {
      if (at + segment.duration * 1000 > startMs) break;
      at += segment.duration * 1000;
      startIndex = index + 1;
    }
    startIndex = Math.min(startIndex, Math.max(0, playlist.segments.length - 1));
    startedAtMs = Math.round(playlist.segments.slice(0, startIndex).reduce((sum, segment) => sum + segment.duration * 1000, 0));
  }
  const pending: Segment[] = playlist.segments.slice(startIndex);
  let lastSequence = pending.length ? pending[0].sequence - 1 : playlist.mediaSequence - 1;
  let lastInit: string | null = null;
  const queued: HlsPart[] = [];

  // 라이브 목록을 다시 받아 새 세그먼트를 잇는다. 끝났으면 false
  async function reload(): Promise<boolean> {
    let unchanged = false;
    for (let failures = 0; ;) {
      if (closed) return false;
      await sleep(Math.max(500, playlist.targetDuration * 1000 * (unchanged ? 0.5 : 1)));
      if (closed) return false;
      try {
        const fetched = await fetchList(first.url, net);
        const next = parsePlaylist(fetched.text, fetched.url);
        if (!next || next.kind !== "media") throw new Error("라이브 목록이 하위 목록이 아닙니다");
        assertPlayable(next);
        reloads++;
        failures = 0;
        playlist = next;
        const fresh = next.segments.filter((segment) => segment.sequence > lastSequence);
        pending.push(...fresh);
        if (fresh.length) return true;
        if (next.ended) return false;
        unchanged = true;
      } catch (error) {
        // 목록 내용이 다룰 수 없는 것(큰 순번, 읽을 수 없는 구간 등)은 다시 받아도 같다. 목록이 아닌 응답 같은 일시적인 오류는 다시 받는다
        if ((error as { permanent?: boolean }).permanent || codeOf(error) === "unsupported-link" || ++failures >= RELOAD_FAILURES) throw error;
        log.trace(`라이브 HLS 플레이리스트 갱신 실패(${failures}/${RELOAD_FAILURES}): ${messageOf(error)}`);
      }
    }
  }

  // 세그먼트 하나를 받을 것들로(초기화 세그먼트가 바뀌었으면 그것 먼저)
  function partsOf(segment: Segment): HlsPart[] {
    lastSequence = segment.sequence;
    const parts: HlsPart[] = [];
    const init = segment.init ? `${segment.init.url}#${segment.init.range?.offset ?? ""}-${segment.init.range?.length ?? ""}` : null;
    if (segment.init && init !== lastInit) parts.push({ url: segment.init.url, range: segment.init.range, key: null, sequence: segment.sequence });
    lastInit = init;
    parts.push({ url: segment.url, range: segment.range, key: segment.key, sequence: segment.sequence });
    return parts;
  }

  // 순서를 지킨다(미리 받기가 앞 세그먼트를 받는 중에 next 를 부른다)
  let chain: Promise<unknown> = Promise.resolve();
  async function takeNext(): Promise<HlsPart | null> {
    for (;;) {
      if (closed) return null;
      const part = queued.shift();
      if (part) return part;
      const segment = pending.shift();
      if (segment) {
        queued.push(...partsOf(segment));
        continue;
      }
      if (startMs !== null || playlist.ended || !(await reload())) return null;
    }
  }

  // 키는 한 번 받아 기억한다. 받는 요청은 세그먼트의 신호와 묶지 않고(다른 세그먼트도 기다린다) 기다리기만 그 신호로 끊는다
  function keyOf(url: string, signal: AbortSignal): Promise<Buffer> {
    let key = keys.get(url);
    if (!key) {
      const fetching = settled(net.getStream(url, undefined, { accept: KEY_ACCEPT })).then((body) => collect(body));
      key = fetching;
      keys.set(url, fetching);
      fetching.catch(() => keys.get(url) === fetching && keys.delete(url));
      for (const old of keys.keys()) if (keys.size > KEYS_KEPT) keys.delete(old);
    }
    return untilAborted(key, signal);
  }

  // VOD 합계(받은 바이트). 넘으면 다시 받지 않는 실패
  function count(bytes: number) {
    if (startMs === null) return;
    received += bytes;
    if (received > SafeUrl.MAX_BYTES) throw permanent(new Error(`HLS가 최대 크기(${SafeUrl.MAX_BYTES} bytes)를 넘었습니다`));
  }

  const parts: PartNet = { net, idleMs, keyOf, count };

  return {
    next() {
      const result = chain.then(takeNext);
      chain = result.catch(() => undefined);
      return result;
    },
    fetch: (part, signal, progress = ignore) => fetchPart(parts, part, signal, progress),
    startedAtMs,
    describe: (sent) => `HLS ${startMs === null ? "라이브" : "VOD"} · 세그먼트 ${sent}개 흘림 · 마지막 순번 ${lastSequence}${startMs === null ? ` · 목록 다시 받음 ${reloads}회` : ""}`,
    close() {
      closed = true;
    },
  };
}

// ── 세그먼트 하나 받기 ──

/** 세그먼트를 받는 데 쓰는 것: 망, 무응답 한도, 기억하는 키, VOD 합계 */
type PartNet = { net: StreamNet; idleMs: number; keyOf(url: string, signal: AbortSignal): Promise<Buffer>; count(bytes: number): void };
/** AES-128의 키와 IV(암호화가 없으면 null) */
type Cipher = { key: Buffer; iv: Buffer } | null;
type Fetching = { signal: AbortSignal; progress: () => void; cipher: Cipher };

async function fetchPart(ctx: PartNet, part: HlsPart, signal: AbortSignal, progress: () => void): Promise<Buffer | HlsPour> {
  if (part.range && part.range.length > PART_ACCEPT.maxBytes) throw permanent(new Error(`HLS 세그먼트 구간이 최대 크기(${PART_ACCEPT.maxBytes} bytes)를 넘습니다`));
  // 키를 먼저(세그먼트를 연 채 키를 기다리지 않게)
  const cipher = await cipherOf(ctx, part, signal);
  if (cipher) progress();
  const at = { signal, progress, cipher };
  return part.range ? fetchRange(ctx, part, part.range, at) : fetchWhole(ctx, part, at);
}

async function cipherOf(ctx: PartNet, part: HlsPart, signal: AbortSignal): Promise<Cipher> {
  if (part.key?.method !== "AES-128" || !part.key.url) return null;
  const key = await ctx.keyOf(part.key.url, signal);
  if (key.length !== 16) throw permanent(new Error(`AES-128 키가 16바이트가 아닙니다(${key.length})`));
  return { key, iv: part.key.iv ? Buffer.from(part.key.iv) : sequenceIv(part.sequence) };
}

// 구간 없는 세그먼트. 알린 크기가 크면 곧바로, 모으다 크거나 늦으면 그때 넘긴다
async function fetchWhole(ctx: PartNet, part: HlsPart, at: Fetching): Promise<Buffer | HlsPour> {
  const body = await settled(ctx.net.getStream(part.url, undefined, { accept: WHOLE_ACCEPT, signal: at.signal, bodyIdleMs: ctx.idleMs }));
  at.progress();
  try {
    const length = Number(body.headers?.["content-length"]);
    if (Number.isSafeInteger(length) && length > GATHER_MAX_BYTES) return pourOf(ctx, part, body, { head: null, totalBytes: length }, at);
    const gathered = await gather(body, at.signal, at.progress);
    if ("done" in gathered) return finish(ctx, gathered.done, at.cipher);
    return pourOf(ctx, part, body, { head: gathered.head, totalBytes: null }, at);
  } catch (error) {
    body.destroy();
    throw error;
  }
}

// 구간 세그먼트는 모은다. 응답이 시작한 위치(200이면 0, 206이면 Content-Range)에서 구간까지 건너뛰고 구간 길이만큼만 모은다.
// 시작 위치의 206은 Content-Range가 없어도 받는다(청크 스트림의 처음 요청과 같다). 그 밖에 위치를 모르거나 구간 뒤에서 시작했으면 다른 바이트라 받지 않는다.
// 구간 끝이 상한을 넘으면(구간을 무시한 200이 처음부터 보낼 때) 받지 않는다. 짧게 끝났으면 받은 만큼(파일 끝을 넘은 마지막 구간은 서버가 끝에서 자른다)
async function fetchRange(ctx: PartNet, part: HlsPart, range: ByteRange, at: Fetching): Promise<Buffer> {
  const body = await settled(ctx.net.getStream(part.url, undefined, { accept: RANGED_ACCEPT, signal: at.signal, bodyIdleMs: ctx.idleMs, from: range.offset, to: range.offset + range.length - 1 }));
  at.progress();
  const headers = body.headers ?? {};
  const start = SafeUrl.servedFrom({ status: body.status ?? 200, headers }) ?? (range.offset === 0 ? 0 : null);
  if (start === null || start > range.offset) {
    body.destroy();
    throw permanent(new Error(`HLS 서버가 요청한 구간(${range.offset}부터)이 아닌 곳을 보냈습니다(${String(headers["content-range"] ?? "Content-Range 없음")})`));
  }
  const slice = { offset: range.offset - start, length: range.length };
  if (slice.offset + slice.length > PART_ACCEPT.maxBytes) {
    body.destroy();
    throw permanent(new Error(`HLS 서버가 구간을 무시해 세그먼트가 최대 크기(${PART_ACCEPT.maxBytes} bytes)를 넘습니다`));
  }
  return finish(ctx, await collect(body, { signal: at.signal, slice, progress: at.progress }), at.cipher);
}

// 모은 바이트(암호문)를 센 뒤 복호화한다
function finish(ctx: PartNet, bytes: Buffer, cipher: Cipher): Buffer {
  ctx.count(bytes.length);
  return cipher ? decrypt(bytes, cipher.key, cipher.iv) : bytes;
}

// 넘긴다. 이제 받는 쪽이 본문을 맡는다(본문의 실패는 받는 쪽 파이프라인이 처리한다. 그 전에 처리되지 않은 오류가 되지 않게 빈 리스너를 단다)
function pourOf(ctx: PartNet, part: HlsPart, body: AudioStream, { head, totalBytes }: { head: Buffer | null; totalBytes: number | null }, at: Fetching): HlsPour {
  at.signal.throwIfAborted();
  body.on("error", ignore);
  return { kind: "pour", url: part.url, body, head, headers: body.headers ?? {}, totalBytes, key: at.cipher?.key ?? null, iv: at.cipher?.iv ?? null, idleMs: ctx.idleMs, get: ctx.net.getStream, count: ctx.count };
}

export { openHls, HLS_IDLE_MS };
export type { Hls, HlsPart, HlsPour, HlsFragments, HlsOptions };
