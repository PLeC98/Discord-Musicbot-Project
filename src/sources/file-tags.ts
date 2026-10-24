// 음원 파일의 태그(제목 · 가수 · 앨범 · 그림)를 읽는다(music-metadata). 남이 준 바이트라 우리가 바이트 · 시간 상한을 먼저 건다.
// 파일은 라이브러리가 자리를 옮겨 읽어(MP4 의 끝 moov 도) 그대로 넘긴다. 스트림은 태그가 있는 헤더까지만 읽고 끊는다.
// MP4 는 스트림으로 주면 mdat 을 끝까지 읽어서, 맨 위 상자를 우리가 걸어 ftyp + moov 만 버퍼로 넘긴다(moov 가 끝이면 그 자리를 따로 받는다)

import { PassThrough, type Readable } from "node:stream";
import { parseBuffer, parseFile, parseStream, selectCover, type IAudioMetadata, type IOptions } from "music-metadata";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "track" });

type Picture = { data: Uint8Array; format: string };
type Tags = { title: string | null; artist: string | null; album: string | null; picture: Picture | null };
/**
 * maxBytes: 받는 바이트 상한(따로 받는 moov 포함), timeoutMs: 다 읽기까지의 시간 상한.
 * rangeFrom: MP4 의 moov 가 mdat 뒤에 있을 때 그 자리(start 바이트)부터 받는 스트림. 없거나 null(서버가 이어 받기를 따르지 않음)이면 그 파일은 읽지 않는다
 */
type StreamLimits = { maxBytes: number; timeoutMs: number; rangeFrom?: (start: number) => Promise<Readable | null> };

/** 파일을 읽을 때 한 번에 버퍼에 담는 상한(라이브러리의 상한). 그림 하나 · 태그 하나가 이보다 크면 읽지 않는다 */
const FILE_MAX_ALLOCATION = 16 * 1024 * 1024;
// 길이는 재지 않고(전체를 읽게 된다) 파일 끝의 태그(ID3v1 · APE)도 찾지 않는다
const OPTIONS: IOptions = { duration: false, skipPostHeaders: true };

/** 상한을 넘어 그만둔 것(실패가 아니라 "이 크기 안에는 없다") */
class TooBig extends Error {}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

function tagsOf({ common }: IAudioMetadata): Tags {
  const cover = selectCover(common.picture);
  return {
    title: text(common.title),
    artist: text(common.artist) ?? text(common.artists?.join(", ")),
    album: text(common.album),
    picture: cover?.data.length ? { data: cover.data, format: cover.format } : null,
  };
}

/** 로컬 파일(받은 원본 · 캐시 파일)의 태그. 읽지 못하면 null(파일이 없음 포함) */
async function fromFile(file: string): Promise<Tags | null> {
  try {
    return tagsOf(await parseFile(file, { ...OPTIONS, maxMemoryAllocation: FILE_MAX_ALLOCATION }));
  } catch (error) {
    if (codeOf(error) !== "ENOENT") log.debug(`파일 태그 읽기 실패: ${file} | ${messageOf(error)}`);
    return null;
  }
}

/** 받은 양을 상한에서 덜어 낸다. 넘으면 TooBig */
function spend(budget: { left: number }, bytes: number) {
  budget.left -= bytes;
  if (budget.left < 0) throw new TooBig();
}

/** 스트림에서 앞에서부터 받아 쌓는다 */
class Prefix {
  chunks: Buffer[] = [];
  length = 0;
  readonly next: () => Promise<IteratorResult<Buffer>>;
  readonly budget: { left: number };
  constructor(next: () => Promise<IteratorResult<Buffer>>, budget: { left: number }) {
    this.next = next;
    this.budget = budget;
  }
  /** n 바이트가 쌓일 때까지 받는다. 그 전에 끝나면 false */
  async fill(n: number): Promise<boolean> {
    while (this.length < n) {
      const got = await this.next();
      if (got.done) return false;
      this.push(got.value);
    }
    return true;
  }
  push(chunk: Buffer) {
    spend(this.budget, chunk.length);
    this.chunks.push(chunk);
    this.length += chunk.length;
  }
  bytes() {
    if (this.chunks.length > 1) this.chunks = [Buffer.concat(this.chunks)];
    return this.chunks[0] ?? Buffer.alloc(0);
  }
}

/** 스트림의 다음 조각. 기다리는 동안 스트림이 부서져도 처리되지 않은 거부가 남지 않게 한다 */
function reader(stream: Readable) {
  const it = (stream as AsyncIterable<Buffer>)[Symbol.asyncIterator]();
  return () => {
    const pending = it.next();
    pending.catch(() => {
      /* 받는 쪽(next 를 부른 곳)이 그 거부를 따로 받는다 */
    });
    return pending;
  };
}

type Box = { type: string; start: number; size: number; header: number };

/** prefix 의 at 자리 상자 헤더. 크기 0(파일 끝까지)은 null */
async function boxAt(prefix: Prefix, at: number): Promise<Box | null> {
  if (!(await prefix.fill(at + 8))) return null;
  const bytes = prefix.bytes();
  const type = bytes.toString("latin1", at + 4, at + 8);
  let size = bytes.readUInt32BE(at);
  let header = 8;
  if (size === 1) {
    if (!(await prefix.fill(at + 16))) return null;
    size = Number(prefix.bytes().readBigUInt64BE(at + 8));
    header = 16;
  }
  return size >= header ? { type, start: at, size, header } : null;
}

/** 상자들을 걸어 moov 를 찾아 그 바이트를. 못 찾으면 null. mdat 을 만나면 onMdat 이 그 뒤를 맡는다 */
async function moovFrom(prefix: Prefix, onMdat: (after: number) => Promise<Buffer | null>): Promise<Buffer | null> {
  for (let at = 0; ;) {
    const box = await boxAt(prefix, at);
    if (!box) return null;
    if (box.type === "mdat") return onMdat(box.start + box.size);
    if (!(await prefix.fill(box.start + box.size))) return null;
    if (box.type === "moov") return prefix.bytes().subarray(box.start, box.start + box.size);
    at = box.start + box.size;
  }
}

/** MP4: ftyp + moov 만 이은 버퍼를 읽는다 */
async function mp4Tags(prefix: Prefix, limits: StreamLimits, budget: { left: number }, opened: Readable[]): Promise<Tags | null> {
  const ftyp = await boxAt(prefix, 0);
  if (!ftyp || !(await prefix.fill(ftyp.size))) return null;
  const head = Buffer.from(prefix.bytes().subarray(0, ftyp.size));
  const moov = await moovFrom(prefix, async (after) => {
    if (!limits.rangeFrom) return null;
    const rest = await limits.rangeFrom(after);
    if (!rest) return null;
    opened.push(rest);
    return moovFrom(new Prefix(reader(rest), budget), async () => null);
  });
  if (!moov) return null;
  try {
    return tagsOf(await parseBuffer(Buffer.concat([head, moov]), { mimeType: "audio/mp4" }, OPTIONS));
  } catch (error) {
    log.debug(`MP4 태그 읽기 실패: ${messageOf(error)}`);
    return null;
  }
}

/** 그 밖: 받는 대로 라이브러리에 흘리고, 라이브러리가 끝나면(태그가 있는 헤더를 다 읽음) 받기를 그만둔다 */
async function streamTags(prefix: Prefix, next: () => Promise<IteratorResult<Buffer>>, budget: { left: number }): Promise<Tags | null> {
  const feed = new PassThrough();
  // 라이브러리가 끝났는지(읽었든 못 읽었든). 못 읽은 것은 "없음"이고, 보내는 쪽(스트림)의 오류만 던진다
  let settled = false;
  let unreadable = false;
  // 우리가 피드를 닫은 뒤의 실패는 닫은 까닭(상한 · 스트림 오류)의 메아리다
  let closed = false;
  const parsing = parseStream(feed, undefined, OPTIONS).then(
    (meta) => ((settled = true), meta),
    (error: unknown) => {
      if (!closed) log.debug(`스트림 태그 읽기 실패: ${messageOf(error)}`);
      return ((settled = unreadable = true), null);
    },
  );
  try {
    feed.write(prefix.bytes());
    while (!settled) {
      const got = await Promise.race([next(), parsing.then(() => null)]);
      if (got === null || settled) break;
      if (got.done) {
        feed.end();
        break;
      }
      spend(budget, got.value.length);
      if (!feed.write(got.value)) await Promise.race([new Promise((resolve) => feed.once("drain", resolve)), parsing]);
    }
    const meta = await parsing;
    return meta && !unreadable ? tagsOf(meta) : null;
  } finally {
    closed = true;
    feed.destroy();
  }
}

/**
 * 스트림(원본 링크)의 태그. 헤더까지만 받고 스트림을 부순다.
 * 상한 안에 태그를 다 읽지 못했거나 읽을 수 없는 형식이면 null, 스트림 오류 · 시간 초과는 던진다
 */
async function fromStream(source: Readable, limits: StreamLimits): Promise<Tags | null> {
  const opened: Readable[] = [source];
  const budget = { left: limits.maxBytes };
  const timer = setTimeout(() => {
    for (const stream of opened) stream.destroy(new Error(`태그를 ${limits.timeoutMs}ms 안에 읽지 못했습니다`));
  }, limits.timeoutMs);
  try {
    const next = reader(source);
    const prefix = new Prefix(next, budget);
    if (!(await prefix.fill(8))) return null;
    if (prefix.bytes().toString("latin1", 4, 8) === "ftyp") return await mp4Tags(prefix, limits, budget, opened);
    return await streamTags(prefix, next, budget);
  } catch (error) {
    if (error instanceof TooBig) return null;
    throw error;
  } finally {
    clearTimeout(timer);
    for (const stream of opened) stream.destroy();
  }
}

export { fromFile, fromStream };
export type { Tags, Picture, StreamLimits };
