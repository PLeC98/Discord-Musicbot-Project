// 직접 링크 곡의 파일 태그(제목 · 가수 · 앨범 · 그림)를 찾아 기억한다. 디스코드 패널 · 대시보드가 그림을, 플레이어가 곡 정보를 여기서 받는다.
//
//   얻는 곳   캐시 파일의 태그(통신 없음) → 원본 링크의 머리(SafeUrl, 담을 때 읽은 것 포함). 캐시를 만들 때 넣은 것은 다운로드가 바로 알린다
//   기억      결과는 음원 키마다(판: 캐시 파일이면 "file:" + 다운로드 시각, 아니면 "source"). 그림은 다시 구운 JPEG 을 바이트 상한 안에서 LRU.
//             밀려나도 사라지지 않는다: 결과는 다시 찾고, 그림은 캐시 파일에서 다시 꺼낸다(원본에서만 얻은 그림은 다시 찾을 때까지 없다)
//   찾기      한 번에 둘(지금 곡이 먼저), 같은 키는 한 번만. 통신 실패는 몇 분 뒤 다시, "없음"은 캐시 파일이 생길 때 다시
//   알림      찾으면(태그나 그림이 있으면) onFound 로. 플레이어가 그 키의 곡에 반영하고 패널 · 대시보드를 새로 그린다(app/main 이 잇는다)

import crypto from "node:crypto";
import fs from "node:fs";
import type { Readable } from "node:stream";
import * as SafeUrl from "../infra/safe-url.ts";
import * as audioCache from "../store/audio-cache.ts";
import { audioKeyOf } from "../rules/audio-key-of.ts";
import { inputKind } from "../rules/input-kind.ts";
import { artOf } from "../rules/track-art.ts";
import type { TagInfo } from "../rules/track-tags.ts";
import { messageOf } from "../rules/error-kind.ts";
import * as fileTags from "./file-tags.ts";
import type { Tags } from "./file-tags.ts";
import { checkCover, bakeCover, type Cover } from "./cover.ts";
import { openFollowing, refusedByResponse, OPEN_ACCEPT } from "./direct-open.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "track" });

/** 태그 읽기의 상한(그림이 든 머리 · 끝 moov 포함) */
const TAG_LIMITS = { maxBytes: 8 * 1024 * 1024, timeoutMs: 10_000 };
/** 홉마다의 응답 대기 */
const ACCEPT: SafeUrl.Accept = { ...SafeUrl.DIRECT_LINK, timeoutMs: SafeUrl.HEAD_TIMEOUT_MS };
/** 원본을 열어 판정할 때(웹 페이지 · 재생목록도 받아 본다) */
const OPEN: SafeUrl.Accept = { ...OPEN_ACCEPT, timeoutMs: SafeUrl.HEAD_TIMEOUT_MS };
const PARALLEL = 2;
const RETRY_MS = 5 * 60_000;
/** 캐시 다운로드가 맡은 키를 다시 찾지 않는 시간(다운로드가 결과를 알리면 풀린다. 실패하면 이만큼 지나 풀린다) */
const HOLD_MS = 10 * 60_000;
/** 기억하는 결과 수 · 그림 바이트 */
const KEEP_RESULTS = 5000;
const KEEP_IMAGE_BYTES = 32 * 1024 * 1024;
/** 원본을 여는 곳(SafeUrl). 시험이 가짜를 넘긴다 */
type Open = (url: string, opts: { accept: SafeUrl.Accept; from?: number }) => Promise<Readable & { headers?: Record<string, unknown>; status?: number }>;
let open: Open = (url, opts) => SafeUrl.getStream(url, undefined, opts);

type Art = { fingerprint: string; width: number; height: number };
type Result = { version: string; state: "found"; tags: TagInfo; art: Art | null } | { version: string; state: "failed"; retryAt: number };
/** 찾음 알림: 그 키의 태그와 그림(없으면 null) */
type Found = { tags: TagInfo; art: Art | null };
/** 그림을 찾는 곡: 음원이 직접 링크(라이브는 끝이 없어 찾지 않는다) */
type Wanted = { audioUrl?: string; thumbnail?: string | null; isLive?: boolean };

const results = new Map<string, Result>();
const images = new Map<string, { jpeg: Buffer; audioKey: string }>();
let imageBytes = 0;
const queue: Array<{ audioKey: string; url: string }> = [];
const running = new Set<string>();
/** 담을 때 읽기 · 원본 머리 읽기의 끊기(캐시 다운로드가 시작되면 끊는다) */
const sourceReads = new Map<string, () => void>();
/** 캐시 다운로드가 맡은 키 → 풀리는 시각. 그동안 원본을 다시 찾지 않는다(같은 파일로 연결이 셋 열리지 않게) */
const holding = new Map<string, number>();
let listener: ((audioKey: string, found: Found) => void) | null = null;

const EMPTY: TagInfo = { title: null, artist: null, album: null };
const tagsOf = (tags: Tags | null): TagInfo => (tags ? { title: tags.title, artist: tags.artist, album: tags.album } : EMPTY);
const fingerprintOf = (jpeg: Buffer) => crypto.createHash("sha1").update(jpeg).digest("hex").slice(0, 20);

/** 이 키의 지금 판. 캐시 파일이 있으면 그 다운로드 시각(비었으면 파일 크기 · 수정 시각), 없으면 원본 */
function versionOf(audioKey: string): { version: string; file: string | null } {
  const row = audioCache.lookupByAudioKey(audioKey);
  if (row?.status !== "cached" || !row.file_path) return { version: "source", file: null };
  try {
    const stat = fs.statSync(row.file_path);
    return { version: `file:${row.downloaded_at ?? `${stat.size}-${stat.mtimeMs}`}`, file: row.file_path };
  } catch {
    return { version: "source", file: null };
  }
}

function keep(audioKey: string, result: Result) {
  results.delete(audioKey);
  results.set(audioKey, result);
  if (results.size > KEEP_RESULTS) results.delete(results.keys().next().value as string);
}

function keepImage(audioKey: string, cover: Cover): Art {
  const fingerprint = fingerprintOf(cover.jpeg);
  if (!images.has(fingerprint)) {
    images.set(fingerprint, { jpeg: cover.jpeg, audioKey });
    imageBytes += cover.jpeg.length;
    while (imageBytes > KEEP_IMAGE_BYTES && images.size > 1) {
      const [oldest, entry] = images.entries().next().value as [string, { jpeg: Buffer }];
      images.delete(oldest);
      imageBytes -= entry.jpeg.length;
    }
  }
  return { fingerprint, width: cover.width, height: cover.height };
}

/** 결과를 적고 알린다(태그나 그림이 있을 때만) */
function settle(audioKey: string, version: string, tags: TagInfo, cover: Cover | null) {
  const art = cover ? keepImage(audioKey, cover) : null;
  keep(audioKey, { version, state: "found", tags, art });
  log.debug(`파일 태그: ${audioKey} | 제목 ${tags.title ? "있음" : "없음"} · 그림 ${art ? `${art.width}×${art.height}` : "없음"} (${version === "source" ? "원본" : "캐시 파일"})`);
  if (art || tags.title || tags.artist || tags.album) listener?.(audioKey, { tags, art });
}

/** 받는 중인 원본 본문(담을 때의 GET)의 태그를 읽어 기억한다. 읽은 태그를 돌려준다(못 읽었으면 null, 통신 오류는 던진다) */
async function readFromBody(audioKey: string, url: string, body: Readable): Promise<Tags | null> {
  let cancelled = false;
  sourceReads.set(audioKey, () => {
    cancelled = true;
    body.destroy();
  });
  running.add(audioKey);
  try {
    const tags = await fileTags.fromStream(body, { ...TAG_LIMITS, rangeFrom: (start) => rangeFrom(url, start) });
    const cover = tags?.picture ? await bakeCover(tags.picture.data) : null;
    // 그사이 캐시 파일이 생겼으면 그쪽이 정본이다(다운로드가 알린다)
    if (!results.has(audioKey) || results.get(audioKey)?.version === "source") settle(audioKey, "source", tagsOf(tags), cover);
    return tags;
  } catch (error) {
    if (!cancelled) keep(audioKey, { version: "source", state: "failed", retryAt: Date.now() + RETRY_MS });
    throw error;
  } finally {
    sourceReads.delete(audioKey);
    running.delete(audioKey);
    pump();
  }
}

/** 이어 받기(MP4 의 끝 moov). 서버가 그 자리부터 주지 않으면 null */
async function rangeFrom(url: string, start: number): Promise<Readable | null> {
  const part = await open(url, { accept: ACCEPT, from: start });
  if (SafeUrl.servedFrom({ status: part.status ?? 200, headers: part.headers ?? {} }) === start) return part;
  part.destroy();
  return null;
}

/** 한 키를 찾는다: 캐시 파일이 있으면 그 태그, 없으면 원본 머리 */
async function find(audioKey: string, url: string) {
  const { version, file } = versionOf(audioKey);
  if (file) {
    const tags = await fileTags.fromFile(file);
    const cover = tags?.picture ? await checkCover(tags.picture.data) : null;
    settle(audioKey, version, tagsOf(tags), cover);
    return;
  }
  let opened;
  try {
    // 단순 목록은 담기 · 재생처럼 첫 주소를 따라간다
    opened = await openFollowing(url, { net: { getStream: (target, _deps, opts) => open(target, { accept: OPEN, ...opts }) }, accept: OPEN });
  } catch (error) {
    // 음원이 아님 · 옛 SHOUTcast 는 다시 찾아도 같다
    if (refusedByResponse(error)) return settle(audioKey, "source", EMPTY, null);
    throw error;
  }
  // HLS · 웹 페이지 · 그림은 파일 태그가 없다
  if (opened.kind !== "file") return settle(audioKey, "source", EMPTY, null);
  await readFromBody(audioKey, url, opened.body);
}

/** 기다리는 것을 둘까지 돌린다 */
function pump() {
  while (running.size < PARALLEL && queue.length > 0) {
    const next = queue.shift()!;
    if (running.has(next.audioKey) || !needsFind(next.audioKey)) continue;
    running.add(next.audioKey);
    find(next.audioKey, next.url)
      .catch((error) => {
        log.debug(`파일 태그를 찾지 못함(${Math.round(RETRY_MS / 60_000)}분 뒤 다시): ${next.audioKey} | ${messageOf(error)}`);
        if (results.get(next.audioKey)?.state !== "failed") keep(next.audioKey, { version: "source", state: "failed", retryAt: Date.now() + RETRY_MS });
      })
      .finally(() => {
        running.delete(next.audioKey);
        pump();
      });
  }
}

/** 아직 찾을 것인가(결과가 없거나 실패한 지 오래) */
function needsFind(audioKey: string) {
  if ((holding.get(audioKey) ?? 0) > Date.now()) return false;
  const known = results.get(audioKey);
  return !known || (known.state === "failed" && Date.now() >= known.retryAt);
}

/** 직접 링크 곡의 음원 키(그 밖은 null) */
function directKeyOf(track: Wanted): string | null {
  if (!track.audioUrl || inputKind(track.audioUrl) !== "direct") return null;
  return audioKeyOf(track.audioUrl);
}

/**
 * 찾을 곡을 넘긴다(앞의 것이 먼저). first 면 기다리는 것보다 앞에(지금 곡).
 * 이미 아는 곡 · 찾는 중인 곡은 메모리에서 바로 건너뛴다(DB 를 보지 않는다)
 */
function want(tracks: Iterable<Wanted | null | undefined>, { first = false } = {}) {
  const fresh: Array<{ audioKey: string; url: string }> = [];
  for (const track of tracks) {
    const audioKey = track && !track.isLive ? directKeyOf(track) : null;
    if (!audioKey || !track?.audioUrl || running.has(audioKey) || !needsFind(audioKey) || queue.some((one) => one.audioKey === audioKey)) continue;
    fresh.push({ audioKey, url: track.audioUrl });
  }
  if (first) queue.unshift(...fresh);
  else queue.push(...fresh);
  pump();
}

/** 이 곡의 그림(곡 그림 주소가 없는 직접 링크 곡만). 모르거나 없으면 null */
function artFor(track: Wanted): Art | null {
  if (artOf(track.thumbnail)) return null;
  const audioKey = directKeyOf(track);
  const known = audioKey ? results.get(audioKey) : undefined;
  return known?.state === "found" ? known.art : null;
}

/** 이 곡의 기억한 태그(모르면 null) */
function tagsFor(track: Wanted): TagInfo | null {
  const audioKey = directKeyOf(track);
  const known = audioKey ? results.get(audioKey) : undefined;
  return known?.state === "found" ? known.tags : null;
}

/** 지문의 JPEG. 밀려났으면 캐시 파일에서 다시 꺼낸다. 통신하지 않는다 */
async function imageOf(fingerprint: string): Promise<Buffer | null> {
  const kept = images.get(fingerprint);
  if (kept) return kept.jpeg;
  for (const [audioKey, result] of results) {
    if (result.state !== "found" || result.art?.fingerprint !== fingerprint || !result.version.startsWith("file:")) continue;
    const { file } = versionOf(audioKey);
    const tags = file ? await fileTags.fromFile(file) : null;
    const cover = tags?.picture ? await checkCover(tags.picture.data) : null;
    if (cover && fingerprintOf(cover.jpeg) === fingerprint) return keepImage(audioKey, cover) && cover.jpeg;
  }
  return null;
}

/** 캐시 파일을 막 만들었다(다운로드). 그 파일에 넣은 태그 · 그림으로 결과를 바로 채운다 */
function noteFile(audioKey: string, tags: TagInfo | null, cover: Cover | null) {
  holding.delete(audioKey);
  const { version } = versionOf(audioKey);
  if (version === "source") return;
  settle(audioKey, version, tags ?? EMPTY, cover);
}

/** 이 키의 캐시 다운로드가 시작됐다. 원본 머리 읽기를 끊고, 다운로드가 결과를 알릴 때까지 다시 찾지 않는다(같은 파일로 연결이 셋 열리지 않게). 태그는 받은 파일이 채운다 */
function cancelSource(audioKey: string) {
  sourceReads.get(audioKey)?.();
  holding.set(audioKey, Date.now() + HOLD_MS);
}

/** 찾음 알림을 받을 곳(하나) */
function onFound(handler: ((audioKey: string, found: Found) => void) | null) {
  listener = handler;
}

/** 캐시 초기화 때 */
function clear() {
  results.clear();
  holding.clear();
  images.clear();
  imageBytes = 0;
  queue.length = 0;
}

export { want, artFor, tagsFor, imageOf, readFromBody, noteFile, cancelSource, onFound, clear, directKeyOf };
export const _internals = {
  /** 원본을 여는 곳을 바꾼다(시험) */
  useOpen(fake: Open) {
    open = fake;
  },
  /** 그림만 잊는다(결과는 둔다. 밀려난 것과 같다) */
  forgetImages() {
    images.clear();
    imageBytes = 0;
  },
  running,
};
export type { Art, Found };
