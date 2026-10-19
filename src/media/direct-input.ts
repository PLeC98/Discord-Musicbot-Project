// 직접 링크를 재생 · 다운로드 입력으로 연다(sources/direct 의 open). 파일은 그 본문, HLS 는 조각 스트림(media/fragment-stream).
//   live       끝이 없다(인터넷 라디오 · 라이브 HLS). 캐시하지 않는다
//   bounded    끝이 있고 크기 · 길이를 안다(크기를 알린 파일 · VOD HLS). 재생과 나란히 다운로드해도 된다
//   resumable  끊기면 받은 자리부터 이을 수 있는 파일(크기를 알리고 음원 상한 안). 재생이 청크 스트림으로 연다(media/chunked-stream)

import type { Readable } from "stream";
import * as SafeUrl from "../infra/safe-url.ts";
import * as DirectLink from "../sources/direct.ts";
import { OPEN_ACCEPT } from "../sources/direct-open.ts";
import { codedError } from "../rules/error-kind.ts";
import { streamFragments } from "./fragment-stream.ts";
import { readerOf, type RangeFetch } from "./chunked-stream.ts";

/** 이어받을 재료: 전체 크기 · 처음 응답의 검사값(If-Range) · 가드를 지나는 Range 요청 */
type Resumable = { totalBytes: number; validator: string | null; fetch: RangeFetch };
type DirectInput = Readable & {
  headers?: Record<string, unknown>;
  live: boolean;
  bounded: boolean;
  resumable?: Resumable;
  /** 곡 안의 어느 위치(ms)부터 흘리나(HLS VOD 는 위치가 든 조각부터) */
  startedAtMs?: number;
  describe?(): string;
};
/**
 * startMs: 곡 안의 시작 위치(HLS VOD 만 조각으로 맞춘다. 나머지는 ffmpeg 의 -ss)
 * liveOnly: 라이브로 담은 곡이다. HLS 의 목록이 끝났으면 틀지 않고 live-ended(다시보기를 처음부터 틀지 않는다)
 */
type InputOptions = { startMs?: number; liveOnly?: boolean; bodyIdleMs?: number };
type Open = (url: string, net?: undefined, opts?: { bodyIdleMs?: number }) => Promise<DirectLink.DirectOpen>;
type GuardedGet = (url: string, deps: undefined, opts: { accept: SafeUrl.Accept; from?: number; to?: number; ifRange?: string }) => Promise<Readable & { headers?: Record<string, unknown>; status?: number }>;

/** 처음 응답의 검사값. 강한 ETag(W/ 가 아닌 것), 없으면 Last-Modified */
function validatorOf(headers: Record<string, unknown> = {}): string | null {
  const etag = headers.etag;
  if (typeof etag === "string" && etag && !etag.startsWith("W/")) return etag;
  const modified = headers["last-modified"];
  return typeof modified === "string" && modified ? modified : null;
}

/**
 * 청크 스트림의 Range 요청을 SafeUrl 로(홉마다 가드 · DNS 다시 풀기). 판정은 첫 응답이 했으니 형식은 보지 않는다.
 * 2xx 가 아니면 그 상태의 응답으로 돌려준다(청크 스트림이 4xx 는 그만, 5xx 는 다시). 가드가 막으면 다시 받지 않는다
 */
function guardedRanges(get: GuardedGet = SafeUrl.getStream): RangeFetch {
  return async (url, { headers, signal }) => {
    const [, from, to] = /bytes=(\d+)-(\d*)/.exec(headers.Range ?? "") ?? [];
    let body;
    try {
      body = await get(url, undefined, { accept: OPEN_ACCEPT, from: Number(from), to: to ? Number(to) : undefined, ifRange: headers["If-Range"] });
    } catch (error) {
      if (error instanceof SafeUrl.SsrfError) throw Object.assign(error, { permanent: true });
      const status = (error as { status?: unknown } | null)?.status;
      if (typeof status === "number") return { status, headers: {}, body: null };
      throw error;
    }
    const opened = body;
    signal.addEventListener("abort", () => opened.destroy(signal.reason instanceof Error ? signal.reason : undefined), { once: true });
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
  return Object.assign(streamFragments(hls.fragments(startMs)), { live: hls.live, bounded: !hls.live });
}

export { openDirectInput, guardedRanges, validatorOf };
export type { DirectInput, InputOptions as DirectInputOptions, Resumable };
