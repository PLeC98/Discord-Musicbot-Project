// 크기를 모르는 응답 본문(HLS가 모으지 않고 넘긴 세그먼트)을 흘리다 끊기면 받은 위치부터 이어 받는 읽기 스트림(media/direct-input 이 쓴다).
// 위치 N은 이 본문에서 받은 바이트 수(모아 둔 앞부분 포함)다. 이을 때 `Range: bytes=N-`와 처음 응답의 검사값(If-Range)을 보낸다.
//   206   Content-Range 시작이 N이어야 잇는다. 전체 길이가 적혀 있으면 기억해 다음 응답과 같은지 본다(`*`면 시작만 본다)
//   200   서버가 Range를 무시했다. 처음 응답과 검사값이 같을 때만 처음부터 받아 N바이트를 버린다(DISCARD_MAX_BYTES까지). 검사값이 없으면 잇지 않는다
//   그 밖  검사값이 바뀜, 416, 4xx, 구간이 어긋남, 짧은 응답은 다시 받지 않는 실패로 끝낸다
// 전체 길이를 모른 채 정상으로 끝나면 끝으로 본다. 아는데 모자라게 끝나면 끊김으로 보고 잇는다.
// 본문은 data 이벤트로 흘린다(백프레셔가 걸리면 멈춘다). SafeUrl의 무응답 감시가 데이터가 흐르는 동안만 시간을 재기 때문이다

import { Readable, finished } from "stream";
import * as SafeUrl from "../infra/safe-url.ts";
import { messageOf } from "../rules/error-kind.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "link" });

/** 이을 때의 요청(가드를 지난다). 2xx가 아니면 status를 단 오류를 던진다 */
type ResumeGet = (url: string, deps: undefined, opts: { accept: SafeUrl.Accept; from: number; ifRange?: string; signal: AbortSignal; bodyIdleMs: number }) => Promise<Readable & { headers?: Record<string, unknown>; status?: number }>;
type Resumed = { attempts: number; downtimeMs: number; starvedMs: number };
type ResumingOptions = {
  url: string;
  /** 처음 응답의 본문(head 뒤부터 남은 것). 헤더로 검사값과 전체 길이를 읽는다 */
  body: Readable & { headers?: Record<string, unknown> };
  /** 이미 받아 둔 앞부분(맨 앞에 흘리고 위치에 더한다) */
  head: Buffer | null;
  /** 이을 때 보낼 검사값(처음 응답의 강한 ETag나 Last-Modified). 없으면 206일 때만 잇는다 */
  validator: string | null;
  get: ResumeGet;
  accept: SafeUrl.Accept;
  idleMs: number;
  /** 끊긴 뒤 다시 흘리기 시작했을 때. starvedMs는 그동안 받는 쪽이 기다린 시간이다 */
  onResumed?: ((info: Resumed) => void) | null;
  retryDelaysMs?: number[];
  discardMaxBytes?: number;
};

const RETRY_DELAYS_MS = [500, 1000, 2000];
/** 구간을 무시한 200에서 버릴 수 있는 앞부분의 상한 */
const DISCARD_MAX_BYTES = 64 * 1024 * 1024;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const permanent = (message: string) => Object.assign(new Error(message), { permanent: true });
const CONTENT_RANGE = /^\s*bytes\s+(\d+)-\d+\/(\d+|\*)\s*$/i;

/** 응답이 알린 전체 길이(처음 응답의 Content-Length). 모르면 null */
function lengthOf(headers: Record<string, unknown> = {}): number | null {
  const length = Number(headers["content-length"]);
  return headers["content-length"] !== undefined && Number.isSafeInteger(length) && length >= 0 ? length : null;
}

/** 처음 응답의 검사값과 같은지 확인(강한 ETag, 없으면 Last-Modified) */
function sameValidator(headers: Record<string, unknown>, validator: string) {
  const etag = headers.etag;
  if (typeof etag === "string" && etag && !etag.startsWith("W/")) return etag === validator;
  return headers["last-modified"] === validator;
}

function createResumingBody(options: ResumingOptions): Readable {
  const { url, head, validator, get, accept, idleMs, onResumed = null, retryDelaysMs = RETRY_DELAYS_MS, discardMaxBytes = DISCARD_MAX_BYTES } = options;
  let total = lengthOf(options.body.headers);
  let pos = 0;
  let current: Readable | null = null; // 흘리는 중인 응답
  let started = false;
  let failures = 0; // 연속 실패. 바이트를 흘리면 0
  let interruptedAt = 0;
  let starvedSince = 0;
  const aborter = new AbortController();

  const out = new Readable({
    read() {
      if (interruptedAt && !starvedSince) starvedSince = Date.now();
      if (!started) {
        started = true;
        void run().catch((error: unknown) => out.destroy(error instanceof Error ? error : new Error(String(error))));
      }
      current?.resume();
    },
    destroy(error, callback) {
      aborter.abort(new Error("본문 스트림이 닫힘"));
      current?.destroy();
      options.body.destroy();
      callback(error);
    },
  });

  // 흘린다. 끊긴 뒤 처음 흘리는 바이트면 이어 받았다고 알린다. 백프레셔가 걸렸으면 false
  function emit(piece: Buffer) {
    if (interruptedAt) {
      const now = Date.now();
      onResumed?.({ attempts: failures, downtimeMs: now - interruptedAt, starvedMs: starvedSince ? now - starvedSince : 0 });
      interruptedAt = 0;
      starvedSince = 0;
    }
    failures = 0;
    pos += piece.length;
    return out.push(piece);
  }

  // 응답 하나를 끝까지 흘린다. 앞의 skip 바이트는 버린다. 다 버리기 전에 끝나면 다시 받지 않는 실패
  function pour(body: Readable, skip: number): Promise<void> {
    current = body;
    let left = skip;
    return new Promise((resolve, reject) => {
      body.on("data", (chunk: Buffer) => {
        const cut = Math.min(left, chunk.length);
        left -= cut;
        const piece = cut ? chunk.subarray(cut) : chunk;
        if (piece.length && !emit(piece)) body.pause();
      });
      finished(body, (error) => {
        body.removeAllListeners("data");
        current = null;
        if (error) return reject(error);
        if (left > 0) return reject(permanent(`구간을 무시한 응답이 받은 위치(${pos + left}B)보다 짧습니다`));
        resolve();
      });
    });
  }

  // 받은 위치부터 다시 연다. 이어 흘릴 응답과 그 앞에서 버릴 바이트
  async function reopen(): Promise<{ body: Readable; skip: number }> {
    let res;
    try {
      res = await get(url, undefined, { accept, from: pos, ...(validator ? { ifRange: validator } : {}), signal: aborter.signal, bodyIdleMs: idleMs });
    } catch (error) {
      const status = (error as { status?: unknown } | null)?.status;
      if (error instanceof SafeUrl.SsrfError || (typeof status === "number" && status < 500)) throw Object.assign(error as Error, { permanent: true });
      throw error;
    }
    try {
      return { body: res, skip: accepted(res.status ?? 200, res.headers ?? {}) };
    } catch (error) {
      res.destroy();
      throw error;
    }
  }

  // 다시 연 응답을 이어도 되는지 본다. 잇는다면 앞에서 버릴 바이트(206은 0, 구간을 무시한 200은 받은 만큼). 아니면 다시 받지 않는 실패
  function accepted(status: number, headers: Record<string, unknown>): number {
    return status === 206 ? acceptedRange(headers) : acceptedWhole(headers);
  }

  // 206: 받은 위치부터인지, 전체 크기가 그대로인지 본다
  function acceptedRange(headers: Record<string, unknown>): number {
    const [, start, size] = CONTENT_RANGE.exec(String(headers["content-range"] ?? "")) ?? [];
    if (start === undefined || Number(start) !== pos) throw permanent(`이어 받은 구간이 어긋납니다: ${pos}B부터 요청, ${String(headers["content-range"] ?? "Content-Range 없음")}`);
    if (size !== "*") {
      if (total !== null && Number(size) !== total) throw permanent(`이어 받은 본문의 전체 크기가 다릅니다: 처음 ${total}B, 지금 ${size}B`);
      total = Number(size);
    }
    return 0;
  }

  // 200(구간을 무시했다): 같은 본문인지(검사값, 전체 크기), 버릴 앞부분이 상한 안인지 본다
  function acceptedWhole(headers: Record<string, unknown>): number {
    if (!validator) throw permanent("서버가 구간을 무시했는데 검사값이 없어 같은 본문인지 알 수 없습니다");
    if (!sameValidator(headers, validator)) throw permanent("본문이 바뀌었습니다(검사값이 다름)");
    const size = lengthOf(headers);
    if (total !== null && size !== null && size !== total) throw permanent(`다시 받은 본문의 전체 크기가 다릅니다: 처음 ${total}B, 지금 ${size}B`);
    if (pos > discardMaxBytes) throw permanent(`서버가 구간을 무시해서, 버릴 앞부분(${pos}B)이 상한(${discardMaxBytes}B)을 넘습니다`);
    return pos;
  }

  async function run() {
    if (head?.length) emit(head);
    let next: { body: Readable; skip: number } | null = { body: options.body, skip: 0 };
    for (;;) {
      try {
        next ??= await reopen();
        await pour(next.body, next.skip);
        next = null;
        if (total === null || pos >= total) return void out.push(null);
        throw Object.assign(new Error(`본문을 다 받기 전에 끝났습니다(${pos}/${total}B)`), { code: "ERR_STREAM_PREMATURE_CLOSE" });
      } catch (error) {
        next?.body.destroy();
        next = null;
        if (out.destroyed) return;
        if ((error as { permanent?: boolean }).permanent || failures >= retryDelaysMs.length) return void out.destroy(error as Error);
        interruptedAt ||= Date.now();
        log.trace(`본문 이어 받기(재시도 ${failures + 1}/${retryDelaysMs.length}, ${pos}B): ${messageOf(error)}`);
        await sleep(retryDelaysMs[failures++]);
        if (out.destroyed) return;
      }
    }
  }

  return out;
}

export { createResumingBody, DISCARD_MAX_BYTES };
export type { ResumingOptions, Resumed };
