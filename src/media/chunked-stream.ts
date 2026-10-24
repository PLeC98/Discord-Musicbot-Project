// Range 요청으로 나눠 받는 읽기 스트림.
//
// googlevideo는 순차 GET을 재생 속도의 약 2배로 조이고(Range는 우회한다), 재생 속도 이하로 읽히는
// 연결은 수십 초 안에 리셋한다. 그래서 청크 본문은 최대 속도로 받아 두고 공급만 소비 속도에 맞춘다.
// 끊기면 onInterrupt에 먼저 묻고(호출부가 캐시로 넘겨받을 수 있다), 아니면 받은 위치부터 이어받는다.
// 이미 열린 첫 응답(first, 직접 링크의 GET)을 받으면 그 본문을 끝까지 흘리고, 끊긴 뒤에만 Range 로 잇는다.
// 이을 때 처음 응답의 검사값(ifRange)을 보내 파일이 바뀌었으면(200) · 구간이 어긋나면 · 전체 크기가 다르면 이어받기를 그만둔다.
// 위치를 옮길 때는 목표 앞의 키프레임 바이트(startByte)부터 받고 그 앞에 파일의 머리(prefix)를 흘린다(media/seek-start). 그때는 받은 첫 바이트가
// 그 키프레임인지(expectStart) 확인한 뒤에야 열렸다고 알리고, 색인 탓의 실패(seekMismatch)를 따로 표시해 여는 쪽이 처음부터 다시 열게 한다.

import { Readable } from "stream";
import { codeOf, codedError } from "../rules/error-kind.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });

const RETRY_DELAYS_MS = [500, 1000, 2000];
const STALL_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 요청 함수에서 여기서 부르고 읽는 필드만. 기본은 전역 fetch
type RangeResponse = {
  status: number;
  headers: { get?(name: string): string | null };
  body: { getReader(): { read(): Promise<{ done: true; value?: undefined } | { done: false; value: Uint8Array }> } } | null;
};
type RangeFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<RangeResponse>;
type Resumed = { attempts: number; downtimeMs: number; starvedMs: number };
type ChunkedOptions = {
  url: string;
  headers?: Record<string, string>;
  totalBytes: number;
  chunkSize: number;
  onInterrupt?: ((err: unknown) => boolean) | null;
  onResumed?: ((info: Resumed) => void) | null;
  /** 이미 열린 첫 응답의 본문(처음부터 끝까지). 끊기면 Range 로 잇는다 */
  first?: Readable | null;
  /** 이을 때 보낼 If-Range(처음 응답의 강한 ETag 나 Last-Modified) */
  ifRange?: string | null;
  /** 첫 요청의 자리(파일 안의 바이트). 받은 양은 이 자리부터 센 절대 위치다 */
  startByte?: number;
  /** 맨 앞에 흘릴 바이트(파일의 머리). 받은 양에 세지 않는다 */
  prefix?: Buffer | null;
  /** 첫 요청에서 받은 앞 bytes 바이트를 확인한다. 줄 때만 열림(prime)을 그 확인 뒤로 미룬다 */
  expectStart?: { bytes: number; check(head: Buffer): boolean } | null;
  fetchImpl?: RangeFetch;
  retryDelaysMs?: number[];
  stallMs?: number;
};
type StreamStats = {
  requests: number;
  received: number;
  totalBytes: number;
  queued: number;
  chunkStart: number;
  chunkReceived: number;
  sinceOpenMs: number | null;
  idleMs: number | null;
  expiresInS: number | null;
  resuming: boolean; // 끊겨서 이어받는 중인가
  startByte: number; // 첫 요청의 자리(0 이면 파일 처음부터)
};
type ChunkedStream = Readable & { prime(): Promise<void>; stats(): StreamStats };

// 다시 요청해도 결과가 같은 실패. 4xx(만료·차단)와 구간 어긋남
function permanent(message: string): Error & { permanent: boolean } {
  return Object.assign(new Error(message), { permanent: true });
}

function httpError(status: number): Error & { status: number } {
  const message = `Range 요청 실패: HTTP ${status}`;
  return status >= 500 ? Object.assign(new Error(message), { status }) : Object.assign(permanent(message), { status });
}

/** 중간 바이트에서 시작한 첫 요청이 색인 탓으로 실패했다(Range 무시 · 416 · 구간 · 전체 크기가 다름 · 첫 바이트가 키프레임이 아님). 여는 쪽이 처음부터 다시 연다 */
const seekMismatch = <E extends Error>(err: E) => Object.assign(err, { seekMismatch: true });
const isSeekMismatch = (err: unknown) => (err as { seekMismatch?: boolean } | null)?.seekMismatch === true;

/**
 * @param {string}   url          받을 주소 (서명된 미디어 URL)
 * @param {object}   headers      yt-dlp가 준 요청 헤더
 * @param {number}   totalBytes   전체 길이. googlevideo는 URL의 clen 파라미터로 준다
 * @param {number}   chunkSize    요청 하나의 크기 = 미리 받아 두는 양의 단위
 * @param {(err: Error) => boolean} [onInterrupt]
 *   재생이 시작된 뒤 끊겼을 때 한 번 부른다. true면 호출부가 넘겨받은 것. 이어받지 않고 받아 둔 데까지 내보낸 뒤 끝낸다.
 * @param {(info: {attempts: number, downtimeMs: number, starvedMs: number}) => void} [onResumed]
 *   끊긴 뒤 다시 받기 시작했을 때. starvedMs는 그동안 내보낼 것이 없어 소비자가 기다린 시간이다.
 * @param {Function} fetchImpl    테스트 주입용. 기본은 전역 fetch
 * @returns {Readable}
 */
function createChunkedStream(options: ChunkedOptions): ChunkedStream {
  const { totalBytes, chunkSize, startByte = 0 } = options;
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) throw new TypeError(`totalBytes가 올바르지 않습니다: ${totalBytes}`);
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) throw new TypeError(`chunkSize가 올바르지 않습니다: ${chunkSize}`);
  if (!Number.isInteger(startByte) || startByte < 0 || startByte >= totalBytes) throw new TypeError(`startByte가 올바르지 않습니다: ${startByte}`);
  // 이미 열린 첫 응답은 파일 처음부터다
  if (startByte > 0 && options.first) throw new TypeError("startByte와 first는 함께 줄 수 없습니다");
  const reader = new ChunkedReader(options);
  return Object.assign(reader.stream, { prime: () => reader.prime(), stats: () => reader.stats() });
}

// Content-Range: "bytes <start>-<end>/<total>". 프록시가 엉뚱한 구간을 주면 여기서 잡는다.
// 파일 처음이 아닌 자리(expected > 0, 이어받기 · 위치를 옮긴 첫 요청)는 전체 크기도 처음과 같아야 한다(다르면 다른 파일이다).
// 0바이트에서 시작한 첫 요청의 크기는 어림값(유튜브 clen)이라 보지 않는다
function assertRange(res: RangeResponse, expected: number, totalBytes: number) {
  const cr = res.headers.get?.("content-range");
  if (!cr) return;
  const [, startText, totalText] = /bytes\s+(\d+)-\d+\/(\d+|\*)/i.exec(cr) ?? [];
  const start = Number(startText);
  if (Number.isFinite(start) && start !== expected) {
    throw permanent(`Range 응답이 어긋납니다: ${expected}을 요청했는데 ${cr}`);
  }
  if (expected > 0 && totalText && totalText !== "*" && Number(totalText) !== totalBytes) {
    throw permanent(`이어받은 파일의 전체 크기가 다릅니다: 처음 ${totalBytes}B, 지금 ${cr}`);
  }
}

/** Node 읽기 스트림을 청크가 읽는 모양(getReader().read())으로 */
function readerOf(stream: Readable) {
  const iterator = stream[Symbol.asyncIterator]();
  return {
    async read(): Promise<{ done: true; value?: undefined } | { done: false; value: Uint8Array }> {
      const next = await iterator.next();
      return next.done ? { done: true } : { done: false, value: next.value as Uint8Array };
    },
  };
}

// 스트림 하나의 상태. 청크를 받아 줄에 쌓고, 소비자가 원하는 만큼 흘려보낸다
class ChunkedReader {
  readonly stream: Readable;
  readonly o: Required<Omit<ChunkedOptions, "onInterrupt" | "onResumed" | "first" | "ifRange" | "prefix" | "expectStart">> & Pick<ChunkedOptions, "onInterrupt" | "onResumed" | "ifRange" | "expectStart">;
  // 남은 양이 이 아래로 떨어지면 다음 청크를 받는다
  readonly lowWater: number;
  readonly expire: number;

  pos = 0; // 받은 바이트 = 다음 요청의 시작 위치
  target = 0; // 지금 받는 청크의 끝(미포함)
  chunks: Buffer[] = []; // 받아 두고 아직 내보내지 않은 조각
  queued = 0;
  wanting = false;
  fetching = false;
  ended = false;
  handedOff = false;
  aborter: AbortController | null = null;
  first: Readable | null; // 아직 읽기 시작하지 않은 첫 응답
  verifying: boolean; // 첫 바이트를 확인하기 전(expectStart 를 줬을 때). 그동안은 열림을 알리지 않는다
  probe: Buffer[] = []; // 확인하려고 모으는 첫 바이트
  firstBody: Readable | null = null; // 읽는 중인 첫 응답(끝나거나 끊기면 부순다)
  stallTimer: NodeJS.Timeout | undefined;
  wakeRoom: (() => void) | null = null;

  primed = false;
  settleReady: ((err: unknown) => void) | null = null;
  ready: Promise<void> | null = null;

  failures = 0; // 연속 실패. 바이트를 받으면 0
  interruptedAt = 0;
  starvedSince = 0;

  requests = 0;
  chunkStart = 0;
  openedAt = 0;
  lastReadAt = 0;

  constructor({ url, headers = {}, totalBytes, chunkSize, onInterrupt = null, onResumed = null, first = null, ifRange = null, startByte = 0, prefix = null, expectStart = null, fetchImpl = fetch, retryDelaysMs = RETRY_DELAYS_MS, stallMs = STALL_MS }: ChunkedOptions) {
    this.o = { url, headers, totalBytes, chunkSize, onInterrupt, onResumed, ifRange, startByte, expectStart, fetchImpl, retryDelaysMs, stallMs };
    this.first = first;
    this.verifying = expectStart !== null;
    this.pos = startByte;
    // 머리는 받은 양에 세지 않고 줄에만 둔다(take 는 받은 위치 · 실패 횟수 · 이어받기 알림을 건드린다)
    if (prefix?.length) {
      this.chunks.push(Buffer.from(prefix));
      this.queued += prefix.length;
    }
    this.lowWater = Math.max(1, Math.floor(chunkSize / 4));
    this.expire = Number(new URL(url, "http://_").searchParams.get("expire"));
    this.stream = new Readable({
      read: () => {
        this.wanting = true;
        this.drain();
      },
      destroy: (err, cb) => {
        clearTimeout(this.stallTimer);
        this.aborter?.abort();
        this.first?.destroy();
        this.firstBody?.destroy();
        this.wakeRoom?.();
        cb(err);
      },
    });
  }

  // 줄에 있는 것을 원하는 만큼 내보내고, 다 받았으면 끝내고, 모자라면 더 받는다
  drain() {
    this.flush();
    if (this.stream.destroyed || this.ended) return;
    if (this.chunks.length === 0 && !this.fetching && (this.handedOff || this.pos >= this.o.totalBytes)) {
      this.ended = true;
      this.stream.push(null);
      return;
    }
    if (this.wanting && this.chunks.length === 0 && this.interruptedAt && !this.starvedSince) this.starvedSince = Date.now();
    if (!this.fetching && !this.handedOff && this.pos < this.o.totalBytes && this.queued < this.lowWater) this._fillOrFail();
  }

  flush() {
    while (this.wanting && this.chunks.length > 0 && !this.stream.destroyed) {
      const chunk = this.chunks.shift() as Buffer;
      this.queued -= chunk.length;
      this.wanting = this.stream.push(chunk);
    }
    if (this.wakeRoom && this.queued < this.o.chunkSize) {
      this.wakeRoom();
      this.wakeRoom = null;
    }
  }

  armStall() {
    clearTimeout(this.stallTimer);
    const request = this.aborter;
    const { stallMs } = this.o;
    this.stallTimer = setTimeout(() => request?.abort(Object.assign(new Error(`${stallMs / 1000}초 동안 받은 데이터가 없습니다`), { code: "STREAM_STALL" })), stallMs);
    this.stallTimer.unref?.();
  }

  resumed(attempts: number) {
    const now = Date.now();
    const info = { attempts, downtimeMs: now - this.interruptedAt, starvedMs: this.starvedSince ? now - this.starvedSince : 0 };
    this.interruptedAt = 0;
    this.starvedSince = 0;
    this.o.onResumed?.(info);
  }

  // 지금 청크를 요청한다(이미 열린 첫 응답이 있으면 그것을 끝까지). 응답이 맞지 않으면 던진다
  async open() {
    const { url, headers, fetchImpl, totalBytes, ifRange } = this.o;
    const signal = (this.aborter as AbortController).signal;
    if (this.first) {
      const body = (this.firstBody = this.first);
      this.first = null;
      this.target = totalBytes;
      signal.addEventListener("abort", () => body.destroy(signal.reason instanceof Error ? signal.reason : undefined), { once: true });
      return readerOf(body);
    }
    const range = { Range: `bytes=${this.pos}-${this.target - 1}`, ...(ifRange ? { "If-Range": ifRange } : {}) };
    const res = await fetchImpl(url, { headers: { ...headers, ...range }, signal });
    // 위치를 옮긴 첫 요청이면 Range 무시(200) · 416 · 구간 어긋남은 색인 탓으로 본다(주소 탓의 403 · 404 는 아니다)
    const mid = !this.primed && this.o.startByte > 0;
    if (res.status === 206) {
      try {
        assertRange(res, this.pos, totalBytes);
      } catch (err) {
        throw mid ? seekMismatch(err as Error) : err;
      }
    } else if (res.status === 200 && this.pos === 0) {
      // Range를 무시했다. 첫 요청이면 본문이 곧 전체 파일이다(조임은 못 피해도 재생은 된다)
      this.target = totalBytes;
    } else {
      const err = httpError(res.status);
      throw mid && (res.status === 200 || res.status === 416) ? seekMismatch(err) : err;
    }
    if (!res.body) throw permanent("응답 본문이 없습니다");
    return res.body.getReader();
  }

  // 줄이 청크 하나와 여유분을 넘을 때 걸린다(Range 를 무시한 200 응답, 머리를 먼저 줄에 둔 첫 요청).
  // 파일 전체를 메모리에 올리지 않도록 줄이 빌 때까지 기다린다. 기다리는 사이 스트림이 부서졌으면 false
  async waitForRoom() {
    clearTimeout(this.stallTimer);
    await new Promise<void>((resolve) => (this.wakeRoom = resolve));
    if (this.stream.destroyed) return false;
    this.armStall();
    return true;
  }

  async receive() {
    this.aborter = new AbortController();
    this.requests++;
    this.chunkStart = this.pos;
    this.openedAt = this.lastReadAt = Date.now();
    this.armStall();
    this.probe = [];
    try {
      const reader = await this.open();
      if (!this.primed && !this.verifying) this.markPrimed();
      while (this.pos < this.target) {
        if (this.queued >= this.o.chunkSize + this.lowWater && !(await this.waitForRoom())) return;
        const { done, value } = await reader.read();
        if (done) {
          this.verifyFirst();
          break;
        }
        this.accept(value);
      }
      if (this.pos < this.target) throw codedError("stream-failed", `응답이 일찍 끝났습니다 (${this.pos}/${this.target}B)`);
    } catch (err) {
      this.aborter?.abort(); // 버린 요청이 열린 채 남지 않게
      throw err;
    } finally {
      clearTimeout(this.stallTimer);
      this.aborter = null;
      // 첫 응답은 한 번만 읽는다. 끝났거나 끊겼으면 연결을 닫는다(크기를 적게 알린 서버면 본문이 남아 있다)
      this.firstBody?.destroy();
      this.firstBody = null;
    }
  }

  markPrimed() {
    this.primed = true;
    this.settleReady?.(null);
  }

  // 받은 바이트. 첫 바이트를 확인하는 중이면 모아 두었다가 확인한다
  accept(value: Uint8Array) {
    if (!this.verifying) return this.take(value);
    this.probe.push(Buffer.from(value));
    this.lastReadAt = Date.now();
    this.armStall();
    if (this.probe.reduce((sum, b) => sum + b.length, 0) >= (this.o.expectStart?.bytes ?? 0)) this.verifyFirst();
  }

  // 모은 첫 바이트가 그 키프레임인가. 맞으면 열림을 알리고 줄에 넣는다. 아니면 다시 받지 않는 실패(열림 전이라 prime 이 거부된다)
  verifyFirst() {
    if (!this.verifying) return;
    const head = Buffer.concat(this.probe);
    this.probe = [];
    if (!this.o.expectStart?.check(head)) throw seekMismatch(permanent(`받은 첫 바이트가 색인이 가리킨 키프레임이 아닙니다(${this.pos}B)`));
    this.verifying = false;
    this.markPrimed();
    if (head.length) this.take(head);
  }

  // 받은 바이트를 줄에 쌓는다
  take(value: Uint8Array) {
    this.chunks.push(Buffer.from(value));
    this.queued += value.length;
    this.pos += value.length;
    this.lastReadAt = Date.now();
    this.armStall();
    if (this.interruptedAt) this.resumed(this.failures);
    this.failures = 0;
    this.drain();
  }

  // 한 번 실패했다. 계속 받을지(true), 호출부가 넘겨받아 끝낼지(false). 다시 받아도 안 될 실패면 던진다
  async retryAfter(err: unknown) {
    if (this.primed && !this.interruptedAt) {
      this.interruptedAt = Date.now();
      if (this.o.onInterrupt?.(err)) {
        this.handedOff = true;
        return false;
      }
    }
    const delays = this.o.retryDelaysMs;
    if ((err as { permanent?: boolean }).permanent || this.failures >= delays.length) throw err;
    log.trace(`청크 요청 실패(다시 받기 ${this.failures + 1}/${delays.length}, ${this.pos}B): ${describeStreamError(err)}`);
    await sleep(delays[this.failures++]);
    return !this.stream.destroyed;
  }

  // 다음 조각을 받는다. fill 은 실패를 스스로 받아 스트림을 닫는다. 그래도 새면 스트림을 오류로 닫는다
  _fillOrFail() {
    this.fill().catch((error: unknown) => this.stream.destroy(error instanceof Error ? error : new Error(String(error))));
  }

  async fill() {
    this.fetching = true;
    this.target = Math.min(this.pos + this.o.chunkSize, this.o.totalBytes);
    try {
      for (;;) {
        try {
          await this.receive();
          return;
        } catch (err) {
          if (this.stream.destroyed || !(await this.retryAfter(err))) return;
        }
      }
    } catch (err) {
      this.settleReady?.(err);
      this.stream.destroy(err as Error);
    } finally {
      this.fetching = false;
      this.drain();
    }
  }

  // 첫 요청을 미리 걸고 성패를 기다린다. 호출부가 기존 fetch와 같은 곳에서 실패를 잡도록.
  prime() {
    if (!this.ready) {
      this.ready = new Promise<void>((resolve, reject) => {
        this.settleReady = (err) => {
          this.settleReady = null;
          if (err) reject(err);
          else resolve();
        };
      });
      if (this.primed) this.settleReady?.(null);
      else if (!this.fetching) this._fillOrFail();
    }
    return this.ready;
  }

  stats(): StreamStats {
    const now = Date.now();
    return {
      requests: this.requests,
      received: this.pos,
      totalBytes: this.o.totalBytes,
      queued: this.queued,
      chunkStart: this.chunkStart,
      chunkReceived: this.pos - this.chunkStart,
      sinceOpenMs: this.openedAt ? now - this.openedAt : null,
      idleMs: this.lastReadAt ? now - this.lastReadAt : null,
      expiresInS: this.expire > 0 ? this.expire - Math.floor(now / 1000) : null,
      resuming: this.interruptedAt > 0,
      startByte: this.o.startByte,
    };
  }
}

/**
 * createChunkedStream + 첫 요청 대기. 실패하면 여기서 던지므로 호출부의 폴백이 그대로 동작한다.
 */
async function openChunkedStream(opts: ChunkedOptions): Promise<ChunkedStream> {
  const stream = createChunkedStream(opts);
  // 호출부는 여전히 자기 on("error")를 붙여야 한다.
  stream.on("error", () => {
    /* 오류는 prime() 의 거부로도 전달된다. 듣는 사람 없는 error 이벤트가 uncaughtException 이 되는 것만 막는다 */
  });
  try {
    await stream.prime();
  } catch (err) {
    stream.destroy();
    throw err;
  }
  return stream;
}

// googlevideo URL은 전체 길이를 clen 파라미터로 들고 있다. 값이 없으면(라이브 스트림 등) null.
function contentLengthFromUrl(url: string): number | null {
  try {
    const clen = Number(new URL(url).searchParams.get("clen"));
    return Number.isFinite(clen) && clen > 0 ? clen : null;
  } catch {
    return null;
  }
}

// undici fetch는 소켓 오류를 "terminated"로 감싸고 진짜 사유는 cause에 둔다
function describeStreamError(err: unknown): string {
  const parts: string[] = [];
  let e = err;
  for (let depth = 0; e != null && depth < 4; depth++) {
    if (typeof e !== "object") {
      parts.push(String(e));
      break;
    }
    const { message, cause } = e as { message?: string; cause?: unknown };
    const msg = message || String(e);
    const code = codeOf(e);
    parts.push(code && !msg.includes(String(code)) ? `${code} ${msg}` : msg);
    e = cause;
  }
  return parts.join(" ← ");
}

export { createChunkedStream, openChunkedStream, contentLengthFromUrl, describeStreamError, readerOf, isSeekMismatch };
export type { ChunkedOptions, ChunkedStream, RangeFetch, StreamStats };
