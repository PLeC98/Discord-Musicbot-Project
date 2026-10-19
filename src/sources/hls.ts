// 직접 링크의 HLS: 재생목록을 읽고(rules/hls-playlist) 받을 조각을 차례로 내놓는다. 받아 흘리는 것은 media/fragment-stream 이 한다.
// 모든 요청(상위 · 하위 목록 · 조각 · 머리 조각 · 키)이 SafeUrl(가드)을 지난다. ffmpeg 는 주소를 보지 않는다.
//   상위 목록   음성 따로가 있으면 그것, 없으면 대역폭이 가장 낮은 화질(chooseMedia). 하위 목록을 한 번 더 받는다
//   VOD        끝 표시(EXT-X-ENDLIST)가 있다. 위치가 든 조각부터, 끝까지 받으면 끝. 받은 크기를 합쳐 음원 상한으로 센다
//   라이브      끝에서 LIVE_EDGE 조각 앞부터. 목록을 목표 길이마다 다시 받아(바뀌지 않았으면 그 절반 뒤) 순번으로 잇는다.
//              끝 표시가 생기면 깨끗이 끝나고, 목록을 연달아 받지 못하면 오류로 끝난다(끝 판정이 "방송이 끝남"으로 읽지 않게)
//   암호       AES-128 은 키를 받아 풀고(IV 가 없으면 조각 순번), 그 밖(SAMPLE-AES 등 DRM)은 거절한다. 머리 조각은 풀지 않는다
// 바이트 구간(EXT-X-BYTERANGE)은 끝이 있는 Range 로 받는다. 구간을 무시하고 200 으로 주는 서버면 그 구간만 잘라 쓴다.

import crypto from "node:crypto";
import type { Readable } from "node:stream";
import * as SafeUrl from "../infra/safe-url.ts";
import { codedError } from "../rules/error-kind.ts";
import { parsePlaylist, chooseMedia, lengthOf, type MediaPlaylist, type Segment, type ByteRange, type Key } from "../rules/hls-playlist.ts";
import type { StreamNet } from "./direct-open.ts";

/** 받을 것 하나: 조각이거나, 머리 조각이 바뀌었을 때의 머리 조각 */
type HlsPart = { url: string; range: ByteRange | null; key: Key | null; sequence: number };
/** media/fragment-stream 의 출처 모양(층 순서상 그 타입을 쓰지 않는다) */
type HlsFragments = {
  next(): Promise<HlsPart | null>;
  fetch(part: HlsPart, signal: AbortSignal): Promise<Buffer>;
  startedAtMs: number;
  describe(sent: number): string;
  close(): void;
};
type Hls = {
  live: boolean;
  /** VOD 의 길이(EXTINF 의 합). 라이브는 null */
  durationMs: number | null;
  /** startMs 가 든 조각부터 받는 출처(라이브는 위치를 보지 않는다) */
  fragments(startMs?: number): HlsFragments;
};
type HlsOptions = { net?: StreamNet; sleep?: (ms: number) => Promise<void> };

/** 목록 · 키는 작다 */
const LIST_ACCEPT: SafeUrl.Accept = { contentType: /(?:)/, maxBytes: 1024 * 1024, timeoutMs: SafeUrl.HEAD_TIMEOUT_MS };
const KEY_ACCEPT: SafeUrl.Accept = { contentType: /(?:)/, maxBytes: 1024, timeoutMs: SafeUrl.HEAD_TIMEOUT_MS };
/** 조각 하나. 형식은 판정하지 않는다(ffmpeg 의 형식 필터가 본다) */
const PART_ACCEPT: SafeUrl.Accept = { ...SafeUrl.DIRECT_LINK, contentType: /(?:)/ };
/** 라이브를 끝에서 몇 조각 앞부터 트나 */
const LIVE_EDGE = 3;
/** 라이브 목록을 연달아 이만큼 받지 못하면 오류로 끝난다 */
const RELOAD_FAILURES = 3;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 다시 받아도 같은 실패(4xx · 상한 · DRM) */
const permanent = (error: Error) => Object.assign(error, { permanent: true });
/** 가드가 막은 요청(내부 주소 · 크기 상한 · 받는 형식)과 4xx 로 거절한 요청은 다시 받지 않는다 */
async function settled<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    throw error instanceof SafeUrl.SsrfError || (typeof status === "number" && status < 500) ? permanent(error as Error) : error;
  }
}

/** 본문을 끝까지(slice 가 있으면 그 구간까지만) 모은다. signal 이 끊으면 본문을 부수고 그 까닭으로 던진다 */
async function collect(body: Readable, { signal, slice }: { signal?: AbortSignal; slice?: ByteRange | null } = {}): Promise<Buffer> {
  const stop = () => body.destroy(signal?.reason instanceof Error ? signal.reason : new Error("그만 받음"));
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    const end = slice ? slice.offset + slice.length : Infinity;
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      length += chunk.length;
      if (length >= end) break;
    }
    const all = Buffer.concat(chunks);
    return slice ? all.subarray(slice.offset, end) : all;
  } finally {
    signal?.removeEventListener("abort", stop);
    body.destroy();
  }
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

/** DRM(AES-128 밖의 암호)이 걸린 조각이 있으면 거절 */
function assertPlayable(playlist: MediaPlaylist): void {
  if (playlist.segments.some((segment) => segment.key?.method === "OTHER")) throw permanent(codedError("unsupported-link", "DRM 으로 잠긴 HLS 입니다"));
}

/** 조각 순번의 IV(16바이트 큰 끝) */
function sequenceIv(sequence: number): Buffer {
  const iv = Buffer.alloc(16);
  iv.writeBigUInt64BE(BigInt(sequence), 8);
  return iv;
}

/** AES-128-CBC 풀기. 풀리지 않으면(키 · IV 가 틀림) 다시 받아도 같다 */
function decrypt(bytes: Buffer, key: Buffer, iv: Buffer): Buffer {
  try {
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
    return Buffer.concat([decipher.update(bytes), decipher.final()]);
  } catch (error) {
    throw permanent(new Error(`HLS 조각을 풀지 못했습니다: ${(error as Error).message}`));
  }
}

/**
 * HLS 를 연다. text · url 은 여는 함수(direct-open)가 받은 목록과 그 마지막 주소.
 * 목록이 아니거나 받을 하위 목록이 없거나 DRM 이면 unsupported-link, 하위 목록을 받지 못하면 SafeUrl 의 오류를 던진다
 */
async function openHls(text: string, url: string, { net = { getStream: SafeUrl.getStream }, sleep = realSleep }: HlsOptions = {}): Promise<Hls> {
  const first = await mediaOf(text, url, net);
  assertPlayable(first.playlist);
  const live = !first.playlist.ended;
  return {
    live,
    durationMs: live ? null : Math.round(lengthOf(first.playlist) * 1000),
    fragments: (startMs = 0) => fragmentsOf(first, net, sleep, live ? null : startMs),
  };
}

/** 받을 차례. startMs 가 null 이면 라이브(끝 가까이부터, 목록을 다시 받으며) */
function fragmentsOf(first: { playlist: MediaPlaylist; url: string }, net: StreamNet, sleep: (ms: number) => Promise<void>, startMs: number | null): HlsFragments {
  let playlist = first.playlist;
  const keys = new Map<string, Promise<Buffer>>();
  let received = 0; // VOD 의 받은 바이트(음원 상한)
  let closed = false;
  let reloads = 0;

  // 처음 받을 조각
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

  // 라이브 목록을 다시 받아 새 조각을 잇는다. 끝났으면 false
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
        if ((error as { permanent?: boolean }).permanent || ++failures >= RELOAD_FAILURES) throw error;
      }
    }
  }

  // 조각 하나를 받을 것들로(머리 조각이 바뀌었으면 그것 먼저)
  function partsOf(segment: Segment): HlsPart[] {
    lastSequence = segment.sequence;
    const parts: HlsPart[] = [];
    const init = segment.init ? `${segment.init.url}#${segment.init.range?.offset ?? ""}-${segment.init.range?.length ?? ""}` : null;
    if (segment.init && init !== lastInit) parts.push({ url: segment.init.url, range: segment.init.range, key: null, sequence: segment.sequence });
    lastInit = init;
    parts.push({ url: segment.url, range: segment.range, key: segment.key, sequence: segment.sequence });
    return parts;
  }

  // 차례를 지킨다(미리 받기가 앞 조각을 받는 중에 부른다)
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

  function keyOf(url: string): Promise<Buffer> {
    let key = keys.get(url);
    if (!key) {
      key = settled(net.getStream(url, undefined, { accept: KEY_ACCEPT })).then((body) => collect(body));
      keys.set(url, key);
      key.catch(() => keys.delete(url));
    }
    return key;
  }

  async function fetchPart(part: HlsPart, signal: AbortSignal): Promise<Buffer> {
    const body = await settled(net.getStream(part.url, undefined, { accept: PART_ACCEPT, ...(part.range ? { from: part.range.offset, to: part.range.offset + part.range.length - 1 } : {}) }));
    // 구간을 주었으면(206) 그대로, 무시했으면(200) 그 구간만
    const slice = part.range && body.status !== 206 ? part.range : null;
    let bytes = await collect(body, { signal, slice });
    if (part.key?.method === "AES-128" && part.key.url) {
      const key = await keyOf(part.key.url);
      if (key.length !== 16) throw permanent(new Error(`AES-128 키가 16바이트가 아닙니다(${key.length})`));
      bytes = decrypt(bytes, key, part.key.iv ? Buffer.from(part.key.iv) : sequenceIv(part.sequence));
    }
    if (startMs !== null) {
      received += bytes.length;
      if (received > PART_ACCEPT.maxBytes) throw permanent(new Error(`HLS 가 최대 크기(${PART_ACCEPT.maxBytes} bytes)를 넘었습니다`));
    }
    return bytes;
  }

  return {
    next() {
      const result = chain.then(takeNext);
      chain = result.catch(() => undefined);
      return result;
    },
    fetch: fetchPart,
    startedAtMs,
    describe: (sent) => `HLS ${startMs === null ? "라이브" : "VOD"} · 조각 ${sent}개 흘림 · 마지막 순번 ${lastSequence}${startMs === null ? ` · 목록 다시 받음 ${reloads}회` : ""}`,
    close() {
      closed = true;
    },
  };
}

export { openHls };
export type { Hls, HlsPart, HlsFragments, HlsOptions };
