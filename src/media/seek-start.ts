// 위치를 옮길 때 받기 시작할 자리를 묻는다: 파일 앞부분(헤더 · 색인)을 받아 목표 앞의 키프레임 바이트를 고른다(rules/container-index).
// 청크 스트림으로 받는 유튜브의 webm · m4a 가 쓴다. 답이 없으면(가까운 위치 · 색인 없음 · 받지 못함) 부르는 쪽은 파일 처음부터 받는다.
// 여기서는 로그를 남기지 않고 까닭을 돌려준다(여는 쪽이 한 번 남긴다).

import { readIndex, headerOf, startPoint, worthIndexing, FIRST_BYTES } from "../rules/container-index.ts";
import { messageOf } from "../rules/error-kind.ts";
import type { RangeFetch } from "./chunked-stream.ts";

type SeekRequest = { url: string; headers: Record<string, string>; totalBytes: number; startMs: number; durationMs: number; chunkBytes: number };
type SeekStart = { header: Buffer; startByte: number; startedAtMs: number; expectStart: { bytes: number; check(head: Buffer): boolean } };
/** near: 가까운 위치라 묻지 않았다(남길 일이 아니다). slow: 헤더 요청이 한도를 넘었다(그만큼 늦어졌다) */
type SeekAnswer = { ok: true; start: SeekStart } | { ok: false; why: string; near?: boolean; slow?: boolean };
type SeekOptions = { fetchImpl?: RangeFetch; timeoutMs?: number; headBytes?: number };

/** 헤더 · 색인을 처음 받는 양. 아주 긴 곡도 대개 이 안에 든다(넘으면 아래 횟수만큼 더 받는다) */
const HEAD_BYTES = 64 * 1024;
/** 색인이 처음 받은 양보다 길 때 더 받는 횟수 */
const MORE_HEAD_TRIES = 3;
/** 헤더 요청 전체(더 받는 것까지)의 한도. 보통 걸리는 시간보다 훨씬 길게 잡는다 */
const HEAD_TIMEOUT_MS = 3000;

/** 앞부분 [0, bytes) 를 받는다. 206 이 아니면 그 상태를 던진다 */
async function headOf(url: string, headers: Record<string, string>, bytes: number, fetchImpl: RangeFetch, signal: AbortSignal): Promise<Buffer> {
  const res = await fetchImpl(url, { headers: { ...headers, Range: `bytes=0-${bytes - 1}` }, signal });
  if (res.status !== 206 || !res.body) throw new Error(`헤더 요청이 HTTP ${res.status}`);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    length += value.length;
    if (length >= bytes) break;
  }
  return Buffer.concat(chunks).subarray(0, bytes);
}

async function seekStart(request: SeekRequest, { fetchImpl = fetch as unknown as RangeFetch, timeoutMs = HEAD_TIMEOUT_MS, headBytes = HEAD_BYTES }: SeekOptions = {}): Promise<SeekAnswer> {
  const { url, headers, totalBytes, startMs, durationMs, chunkBytes } = request;
  if (!worthIndexing({ startMs, durationMs, totalBytes, chunkBytes })) return { ok: false, why: "가까운 위치", near: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`헤더 요청이 ${timeoutMs / 1000}초를 넘김`)), timeoutMs);
  try {
    let head = await headOf(url, headers, Math.min(headBytes, totalBytes), fetchImpl, controller.signal);
    let read = readIndex(head, totalBytes);
    // 색인이 처음 받은 양보다 길다(아주 긴 곡). 모자란 만큼 더 받는다(몇 번까지)
    for (let more = 0; more < MORE_HEAD_TRIES && !read.ok && "need" in read; more++) {
      head = await headOf(url, headers, Math.min(read.need, totalBytes), fetchImpl, controller.signal);
      read = readIndex(head, totalBytes);
    }
    if (!read.ok) return { ok: false, why: "need" in read ? "색인이 받은 앞부분보다 길다" : read.why };
    const point = startPoint(read.index, { targetMs: startMs, durationMs, chunkBytes });
    if ("why" in point) return { ok: false, why: point.why };
    return { ok: true, start: { header: headerOf(head, read.index), startByte: point.byte, startedAtMs: point.startedAtMs, expectStart: { bytes: FIRST_BYTES[read.index.kind], check: point.expectStart } } };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, why: `헤더 요청이 ${timeoutMs / 1000}초를 넘김`, slow: true };
    return { ok: false, why: `헤더를 받지 못함: ${messageOf(error)}` };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export { seekStart, HEAD_TIMEOUT_MS };
export type { SeekRequest, SeekStart, SeekAnswer, SeekOptions };
