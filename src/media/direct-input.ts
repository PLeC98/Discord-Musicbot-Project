// 직접 링크를 재생, 다운로드 입력으로 연다(sources/direct 의 open). 파일은 그 본문, HLS 는 세그먼트 스트림(media/fragment-stream).
//   live       끝이 없다(인터넷 라디오, 라이브 HLS). 캐시하지 않는다
//   bounded    끝이 있고 크기, 길이를 안다(크기를 알린 파일, VOD HLS). 재생과 나란히 다운로드해도 된다
//   resumable  끊기면 받은 자리부터 이을 수 있는 파일(크기를 알리고 음원 상한 안). 재생이 청크 스트림으로 연다(media/chunked-stream)
// HLS 의 큰 세그먼트(sources/hls 가 모으지 않고 넘긴 것)는 여기서 흘릴 스트림으로 바꾼다: 크기를 알리면 청크 스트림으로 끊긴 자리부터 잇고,
// 모르면 모은 앞부분 뒤에 나머지를 잇는다. AES-128 은 흘리며 푼다(이어 받는 것은 암호문이라 끊김과 상관없다)

import crypto from "crypto";
import { PassThrough, Transform, pipeline, type Readable } from "stream";
import config from "../config/index.ts";
import * as SafeUrl from "../infra/safe-url.ts";
import * as DirectLink from "../sources/direct.ts";
import { OPEN_ACCEPT } from "../sources/direct-open.ts";
import type { HlsFragments, HlsPart, HlsPour } from "../sources/hls.ts";
import { codedError, messageOf } from "../rules/error-kind.ts";
import { streamFragments, type FragmentSource } from "./fragment-stream.ts";
import { createChunkedStream, readerOf, type RangeFetch } from "./chunked-stream.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "link" });

/** 이어받을 재료: 전체 크기, 처음 응답의 검사값(If-Range), 가드를 지나는 Range 요청 */
type Resumable = { totalBytes: number; validator: string | null; fetch: RangeFetch };
type DirectInput = Readable & {
  headers?: Record<string, unknown>;
  live: boolean;
  bounded: boolean;
  resumable?: Resumable;
  /** 곡 안의 어느 위치(ms)부터 흘리나(HLS VOD 는 위치가 든 세그먼트부터) */
  startedAtMs?: number;
  describe?(): string;
};
/**
 * startMs: 곡 안의 시작 위치(HLS VOD 만 세그먼트 단위로 맞춘다. 나머지는 ffmpeg 의 -ss)
 * liveOnly: 라이브로 추가된 곡이다. HLS 의 목록이 끝났으면 틀지 않고 live-ended(다시보기를 처음부터 틀지 않는다)
 */
type InputOptions = { startMs?: number; liveOnly?: boolean; bodyIdleMs?: number };
type Open = (url: string, net?: undefined, opts?: { bodyIdleMs?: number }) => Promise<DirectLink.DirectOpen>;
type GuardedGet = (url: string, deps: undefined, opts: { accept: SafeUrl.Accept; from?: number; to?: number; ifRange?: string; signal?: AbortSignal }) => Promise<Readable & { headers?: Record<string, unknown>; status?: number }>;

/** 처음 응답의 검사값. 강한 ETag(W/ 가 아닌 것), 없으면 Last-Modified */
function validatorOf(headers: Record<string, unknown> = {}): string | null {
  const etag = headers.etag;
  if (typeof etag === "string" && etag && !etag.startsWith("W/")) return etag;
  const modified = headers["last-modified"];
  return typeof modified === "string" && modified ? modified : null;
}

/**
 * 청크 스트림의 Range 요청을 SafeUrl 로(홉마다 가드, DNS 다시 풀기). 판정은 첫 응답이 했으니 형식은 보지 않는다.
 * 2xx 가 아니면 그 상태의 응답으로 돌려준다(청크 스트림이 4xx 는 그만, 5xx 는 다시). 가드가 막으면 다시 받지 않는다
 */
function guardedRanges(get: GuardedGet = SafeUrl.getStream): RangeFetch {
  return async (url, { headers, signal }) => {
    const [, from, to] = /bytes=(\d+)-(\d*)/.exec(headers.Range ?? "") ?? [];
    let body;
    try {
      body = await get(url, undefined, { accept: OPEN_ACCEPT, from: Number(from), to: to ? Number(to) : undefined, ifRange: headers["If-Range"], signal });
    } catch (error) {
      if (error instanceof SafeUrl.SsrfError) throw Object.assign(error, { permanent: true });
      const status = (error as { status?: unknown } | null)?.status;
      if (typeof status === "number") return { status, headers: {}, body: null };
      throw error;
    }
    const opened = body;
    const stop = () => opened.destroy(signal.reason instanceof Error ? signal.reason : undefined);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    const responseHeaders = opened.headers ?? {};
    return {
      status: opened.status ?? 200,
      headers: { get: (name: string) => (typeof responseHeaders[name.toLowerCase()] === "string" ? String(responseHeaders[name.toLowerCase()]) : null) },
      body: { getReader: () => readerOf(opened) },
    };
  };
}

async function openDirectInput(url: string, { startMs = 0, liveOnly = false, bodyIdleMs }: InputOptions = {}, open: Open = DirectLink.open): Promise<DirectInput> {
  const opened = await open(url, undefined, { bodyIdleMs });
  if (opened.kind === "file") {
    const { body, radio, length } = opened;
    const bounded = !radio && length !== null;
    // 상한을 넘는 파일은 잇지 않는다(첫 응답이 상한에서 끊는다)
    const resumable = bounded && length <= OPEN_ACCEPT.maxBytes ? { totalBytes: length, validator: validatorOf(body.headers), fetch: guardedRanges() } : undefined;
    return Object.assign(body, { live: radio, bounded, ...(resumable ? { resumable } : {}) });
  }
  const { hls } = opened;
  if (liveOnly && !hls.live) throw codedError("live-ended", `라이브 HLS 의 목록이 끝났습니다: ${url}`);
  return Object.assign(streamFragments(pouringSource(hls.fragments(startMs)), { stallMs: hls.idleMs }), { live: hls.live, bounded: !hls.live });
}

const ignore = () => {
  /* 사슬의 끝(세그먼트 스트림)이 오류를 받는다 */
};
const permanent = (message: string) => Object.assign(new Error(message), { permanent: true });

/** HLS 의 세그먼트 출처를 세그먼트 스트림의 출처로. 모은 세그먼트는 그대로, 넘긴 세그먼트는 흘릴 스트림으로 */
function pouringSource(fragments: HlsFragments): FragmentSource<HlsPart> {
  return {
    next: () => fragments.next(),
    fetch: async (part, signal, progress) => {
      const got = await fragments.fetch(part, signal, progress);
      return Buffer.isBuffer(got) ? got : pourOf(got, signal, progress);
    },
    startedAtMs: fragments.startedAtMs,
    describe: (sent) => fragments.describe(sent),
    close: () => fragments.close(),
  };
}

/**
 * 넘긴 세그먼트를 흘릴 스트림으로. 이제 이 함수가 본문의 주인이다(흘리기 전에 실패하면 닫는다).
 * 크기를 알린 AES 는 흘리기 전에 키를 본다. 합계는 맨 끝에(다시 받을 때 두 번 세지 않게): 알린 크기를 한 번, 모르면 흐르는 바이트를
 */
async function pourOf(pour: HlsPour, signal: AbortSignal, progress: () => void): Promise<Readable> {
  const { totalBytes, key, iv } = pour;
  try {
    if (key && totalBytes !== null) {
      if (totalBytes % 16 !== 0) throw permanent(`AES-128 세그먼트의 크기가 16의 배수가 아닙니다(${totalBytes})`);
      await checkLastBlock(pour, totalBytes, key, signal);
      progress();
    }
    signal.throwIfAborted();
    if (totalBytes !== null) pour.count(totalBytes);
  } catch (error) {
    pour.body.destroy();
    throw error;
  }
  let out: Readable =
    totalBytes !== null
      ? createChunkedStream({
          url: pour.url,
          totalBytes,
          chunkSize: config.stream.chunkBytes,
          first: pour.body,
          ifRange: validatorOf(pour.headers),
          fetchImpl: guardedRanges((url, deps, opts) => pour.get(url, deps, { ...opts, bodyIdleMs: pour.idleMs })),
          stallMs: pour.idleMs,
        })
      : withHead(pour.head, pour.body);
  // 사슬은 pipeline 으로 잇는다(끝을 부수면 앞도, 앞이 실패하면 끝도)
  const stages = [...(totalBytes === null ? [counter(pour.count)] : []), ...(key && iv ? [decrypting(key, iv)] : [])];
  for (const stage of stages) {
    pipeline(out, stage, ignore);
    out = stage;
  }
  return out;
}

/** 모은 앞부분 뒤에 남은 본문 */
function withHead(head: Buffer | null, body: Readable): Readable {
  const out = new PassThrough();
  if (head?.length) out.write(head);
  pipeline(body, out, ignore);
  return out;
}

/** 흐르는 바이트를 센다(넘으면 그 오류로 끝난다) */
function counter(count: (bytes: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      try {
        count(chunk.length);
        done(null, chunk);
      } catch (error) {
        done(error as Error);
      }
    },
  });
}

/** PKCS7 패딩의 길이(1 ~ 16). 깨졌으면 null */
function paddingOf(block: Buffer): number | null {
  const pad = block[block.length - 1];
  if (block.length !== 16 || pad < 1 || pad > 16) return null;
  return block.subarray(16 - pad).every((byte) => byte === pad) ? pad : null;
}

/**
 * AES-128-CBC 를 흘리며 푼다. 덩이 사이에 남은 바이트를 이어 온전한 블록만 풀고, 푼 마지막 블록은 끝까지 쥐었다가 PKCS7 을 뗀다.
 * 끝이 깨졌으면 warn 을 남기고 깨끗이 끝낸다: 블록이 되지 않은 끝 조각(16바이트 미만)만 버리거나(그 앞 블록은 마지막이 아니라 그대로 흘린다), 패딩이 깨진 마지막 블록을 버린다.
 * 오류로 끝내면 재생 쪽이 같은 세그먼트를 처음부터 다시 받아 같은 곳에서 또 실패한다
 */
function decrypting(key: Buffer, iv: Buffer): Transform {
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv).setAutoPadding(false);
  let rest = Buffer.alloc(0); // 아직 블록이 되지 않은 암호문
  let held: Buffer | null = null; // 푼 마지막 블록(끝인지 아직 모른다)
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      const data = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      const whole = data.length - (data.length % 16);
      rest = Buffer.from(data.subarray(whole));
      if (!whole) return done();
      const plain = decipher.update(data.subarray(0, whole));
      const all = held ? Buffer.concat([held, plain]) : plain;
      held = all.subarray(all.length - 16);
      done(null, all.subarray(0, all.length - 16));
    },
    flush(done) {
      if (rest.length) {
        log.warn(`HLS 세그먼트의 끝이 블록이 되지 않아 마지막 ${rest.length}바이트를 버립니다(암호문이 잘림)`);
        return done(null, held ?? undefined);
      }
      const pad = held ? paddingOf(held) : null;
      if (!held || pad === null) {
        log.warn(`HLS 세그먼트의 끝을 풀지 못해 마지막 ${held?.length ?? 0}바이트를 버립니다(패딩이 맞지 않음)`);
        return done();
      }
      done(null, held.subarray(0, 16 - pad));
    },
  });
}

/**
 * 흘리기 전에 키를 본다: 끝 32바이트를 Range 로 받아 앞 블록을 IV 로 마지막 블록을 풀고 PKCS7 이 맞는지. 틀리면 다시 받지 않는 실패(틀린 키면 쓰레기가 ffmpeg 로 먼저 간다).
 * 믿는 것은 그 자리, 그 전체의 206 에서 정확히 32바이트뿐. 구간을 주지 않거나(200) 받지 못하면 건너뛴다(끝은 decrypting 이 받는다). 신호의 취소만 던진다. 응답은 어느 길이든 닫는다
 */
async function checkLastBlock(pour: HlsPour, totalBytes: number, key: Buffer, signal: AbortSignal) {
  const from = totalBytes - 32;
  let body: Readable & { headers?: Record<string, unknown>; status?: number };
  try {
    body = await pour.get(pour.url, undefined, { accept: OPEN_ACCEPT, from, to: totalBytes - 1, signal, bodyIdleMs: pour.idleMs });
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    log.debug(`HLS 세그먼트의 키 확인을 건너뜁니다(끝 블록을 받지 못함): ${messageOf(error)}`);
    return;
  }
  let tail: Buffer | null = null;
  try {
    const range = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(String(body.headers?.["content-range"] ?? ""));
    if (body.status === 206 && range && Number(range[1]) === from && Number(range[2]) === totalBytes - 1 && Number(range[3]) === totalBytes) tail = await firstBytes(body, 33, signal);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    log.debug(`HLS 세그먼트의 키 확인을 건너뜁니다(끝 블록을 읽지 못함): ${messageOf(error)}`);
    return;
  } finally {
    body.destroy();
  }
  if (tail?.length !== 32) return void log.debug(`HLS 세그먼트의 키 확인을 건너뜁니다(구간 응답이 아님)`);
  const last = crypto.createDecipheriv("aes-128-cbc", key, tail.subarray(0, 16)).setAutoPadding(false).update(tail.subarray(16));
  if (paddingOf(last) === null) throw permanent("HLS 세그먼트의 키가 맞지 않습니다(마지막 블록의 패딩이 깨짐)");
}

/** 앞에서부터 많아야 limit 바이트. signal 이 끊으면 그 사유로 */
async function firstBytes(body: Readable, limit: number, signal: AbortSignal): Promise<Buffer> {
  const stop = () => body.destroy(signal.reason instanceof Error ? signal.reason : undefined);
  signal.addEventListener("abort", stop, { once: true });
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      length += chunk.length;
      if (length >= limit) break;
    }
    return Buffer.concat(chunks).subarray(0, limit);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

export { openDirectInput, guardedRanges, validatorOf };
export type { DirectInput, InputOptions as DirectInputOptions, Resumable };
