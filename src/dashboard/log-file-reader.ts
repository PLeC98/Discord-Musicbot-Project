// 로그 파일 읽기(대시보드의 로그 파일 보기). 기록(infra/log/file.ts)이 남긴 NDJSON 을 실시간 로그와 같은 필드로 읽는다.
//
// 페이지는 파일 안의 바이트 위치로 넘긴다: 어느 위치 앞의 줄(before, 없으면 끝에서부터), 어느 줄 뒤의 줄(after), 시각 둘레(at).
// 줄은 시간 순서라 시각은 위치를 반씩 좁혀 찾는다. 줄은 0x0A 로만 자른다(UTF-8 의 여러 바이트 글자 안에는 0x0A 가 없어 청크 경계에서 안전하다).
// 쓰는 중이라 덜 된 마지막 줄, 읽을 수 없는 줄은 건너뛴다.
//
// 지금 쓰는 파일은 꽉 차면 이름이 바뀌어 떼어진다(내용은 그대로). 그래서 파일을 첫 줄의 시각(since)으로 알아보고,
// 보던 파일이 떼어졌으면 같은 첫 줄을 가진 떼어 낸 파일에서 이어 읽는다.
// 파일마다 줄 수, 카테고리, 태그, 처음과 끝 시각은 한 번 훑어 기억한다(떼어 낸 파일은 바뀌지 않고, 지금 파일은 늘어난 부분만 더 훑는다).
// 검색의 맞은 줄 수는 처음 받는 페이지마다 파일 전체를 훑는다(입력이 멈춘 뒤 한 번)
// 파일 끝까지 갈 수 있는 훑기(목록, 맞은 줄 수, 드문 필터의 페이지, 다운로드)는 paced 로 나눠 이벤트 루프를 놓아 준다(파일 하나가 10GB 까지)

import fs from "fs";
import path from "path";
import { setImmediate as nextTurn } from "timers/promises";
import { rotatedFilesOf } from "../infra/log/file.ts";
import { wireFields } from "../infra/log/levels.ts";
import logger from "../infra/log/logger.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import { AT_AFTER_LINES, matchesLog, type FileLine, type FilePage, type LogFile, type LogFilter } from "./contract/log-files.ts";
const log = logger.child({ category: "dashboard" });

/** 한 번에 읽는 바이트 */
const CHUNK = 64 * 1024;
/** 오래 훑는 길이 이벤트 루프를 놓아 주는 간격(바이트) */
const PAUSE_BYTES = 256 * 1024;
const NL = 0x0a;

type Raw = { offset: number; bytes: Buffer };

/** 한 줄을 읽는다. 레코드가 아니면 null */
function parse({ offset, bytes }: Raw): FileLine | null {
  if (!bytes.length) return null;
  try {
    const rec = JSON.parse(bytes.toString("utf8")) as { time?: unknown; level?: unknown };
    if (!rec || typeof rec.time !== "number" || typeof rec.level !== "number") return null;
    return { offset, ...wireFields(rec as { time: number; level: number }) };
  } catch {
    return null;
  }
}

function readAt(fd: number, from: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const got = fs.readSync(fd, buf, 0, length, from);
  return got === length ? buf : buf.subarray(0, got);
}

/** from(줄의 시작)부터 end 까지의 줄들을 앞에서부터. 끝에 줄바꿈이 없는 줄도 낸다 */
function* forward(fd: number, from: number, end: number): Generator<Raw> {
  let carry: Buffer = Buffer.alloc(0);
  let carryAt = from;
  for (let pos = from; pos < end;) {
    const chunk = readAt(fd, pos, Math.min(CHUNK, end - pos));
    if (!chunk.length) break;
    pos += chunk.length;
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0;
    for (let i = buf.indexOf(NL); i >= 0; i = buf.indexOf(NL, start)) {
      yield { offset: carryAt + start, bytes: buf.subarray(start, i) };
      start = i + 1;
    }
    carry = buf.subarray(start);
    carryAt += start;
  }
  if (carry.length) yield { offset: carryAt, bytes: carry };
}

/** before(줄의 시작이나 파일 끝) 앞의 줄들을 뒤에서부터 */
function* backward(fd: number, before: number): Generator<Raw> {
  let tail: Buffer = Buffer.alloc(0);
  for (let pos = before; pos > 0;) {
    const start = Math.max(0, pos - CHUNK);
    const buf = Buffer.concat([readAt(fd, start, pos - start), tail]);
    pos = start;
    let end = buf.length;
    // 마지막 바이트가 줄바꿈이면 그 줄의 끝이다. 그 앞의 줄바꿈까지가 한 줄(lastIndexOf 는 음수 위치를 뒤에서 세므로 2 바이트 미만이면 멈춘다)
    while (end >= 2) {
      const i = buf.lastIndexOf(NL, end - 2);
      if (i < 0) break;
      yield { offset: start + i + 1, bytes: trimNl(buf.subarray(i + 1, end)) };
      end = i + 1;
    }
    tail = buf.subarray(0, end);
    if (pos === 0 && tail.length) yield { offset: 0, bytes: trimNl(tail) };
  }
}
const trimNl = (bytes: Buffer) => (bytes.length && bytes[bytes.length - 1] === NL ? bytes.subarray(0, -1) : bytes);

/**
 * 오래 훑는 길: 줄을 PAUSE_BYTES 만큼씩 묶어 내고, 묶음 사이에 이벤트 루프를 놓아 준다.
 * stop 이 참이 되면 다음 묶음을 내지 않고 끝난다(받는 쪽이 떠났다. 끝까지 읽은 것과 구별하지 않는다)
 */
async function* paced(raws: Generator<Raw>, stop?: () => boolean): AsyncGenerator<Raw[]> {
  let batch: Raw[] = [];
  let from = -1;
  for (const raw of raws) {
    if (from < 0) from = raw.offset;
    batch.push(raw);
    if (Math.abs(raw.offset - from) < PAUSE_BYTES) continue;
    yield batch;
    batch = [];
    from = -1;
    await nextTurn();
    if (stop?.()) return;
  }
  if (batch.length) yield batch;
}

/** at 이상에서 처음 시작하는 줄의 위치(없으면 end) */
function nextLineStart(fd: number, at: number, end: number): number {
  if (at <= 0) return 0;
  for (let pos = at - 1; pos < end; pos += CHUNK) {
    const chunk = readAt(fd, pos, Math.min(CHUNK, end - pos));
    const i = chunk.indexOf(NL);
    if (i >= 0) return pos + i + 1;
  }
  return end;
}

/** 시각이 at 이상인 첫 줄의 위치(없으면 end). 줄이 시간 순서라 반씩 좁힌다. 읽을 수 없는 줄은 앞의 시각으로 친다 */
function lowerBound(fd: number, at: number, end: number): number {
  // lo 앞의 줄은 모두 at 보다 이르고, hi 는 at 이상인 줄의 시작이거나 끝이다
  let lo = 0;
  let hi = end;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const start = nextLineStart(fd, mid, hi);
    if (start >= hi) {
      // 남은 사이에 줄이 한두 줄뿐: 앞에서부터 본다
      for (const raw of forward(fd, lo, hi)) {
        const line = parse(raw);
        if (line && line.ts >= at) return raw.offset;
      }
      return hi;
    }
    const first = forward(fd, start, hi).next();
    const raw = first.done ? null : first.value;
    const line = raw && parse(raw);
    if (!raw || !line || line.ts < at) lo = raw ? raw.offset + raw.bytes.length + 1 : hi;
    else hi = raw.offset;
  }
  return Math.min(lo, end);
}

/** 파일 첫 줄의 시각(줄이 없으면 0). 파일을 알아보는 값 */
function firstTimeOf(fd: number, size: number): number {
  for (const raw of forward(fd, 0, size)) {
    const line = parse(raw);
    if (line) return line.ts;
  }
  return 0;
}
const firstTime = (file: string) => withFile(file, firstTimeOf) ?? 0;

/** 파일을 열어 fn 을 부른다. fn 이 Promise 를 돌려주면 그것이 끝난 뒤에 닫는다. 열 수 없으면 null */
function withFile<T>(file: string, fn: (fd: number, size: number) => T): T | null {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch (error) {
    if (codeOf(error) !== "ENOENT") log.debug(`로그 파일 열기 실패: ${messageOf(error)}`);
    return null;
  }
  let result: T;
  try {
    result = fn(fd, fs.fstatSync(fd).size);
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
  if (!(result instanceof Promise)) {
    fs.closeSync(fd);
    return result;
  }
  return result.finally(() => fs.closeSync(fd)) as T;
}

// ── 파일 목록, 훑기 ──

type Scan = { since: number; size: number; lines: number; firstAt: number; lastAt: number; categories: Set<string>; tags: Set<string> };
const scans = new Map<string, Scan>();
/** 지금 훑는 파일. 같은 파일을 겹쳐 훑지 않는다(겹치면 늘어난 부분을 두 번 센다) */
const scanning = new Map<string, Promise<Scan | null>>();

/** 파일을 훑어 줄 수, 카테고리, 태그, 처음과 끝 시각을 센다. 지난번에 훑은 같은 파일이면 늘어난 부분만. 이미 훑는 중이면 그 결과를 기다린다 */
function scan(file: string): Promise<Scan | null> {
  const running = scanning.get(file);
  if (running) return running;
  const job = (withFile(file, (fd, size) => scanFile(file, fd, size)) ?? Promise.resolve(null)).finally(() => scanning.delete(file));
  scanning.set(file, job);
  return job;
}

/** scan 의 몸통. 기억한 것은 고치지 않고 사본을 늘려 다 훑은 뒤에 바꿔 넣는다(그동안 다른 요청이 기억한 것을 읽는다) */
async function scanFile(file: string, fd: number, size: number): Promise<Scan> {
  const since = firstTimeOf(fd, size);
  const known = scans.get(file);
  const base = known && known.since === since && known.size <= size ? known : null;
  if (base?.size === size) return base;
  const done: Scan = base ? { ...base, categories: new Set(base.categories), tags: new Set(base.tags) } : { since, size: 0, lines: 0, firstAt: 0, lastAt: 0, categories: new Set(), tags: new Set() };
  // 덜 된 마지막 줄은 다음에 다시 훑도록 줄바꿈으로 끝난 곳까지만 센다
  let scanned = done.size;
  read: for await (const batch of paced(forward(fd, done.size, size))) {
    for (const raw of batch) {
      if (raw.offset + raw.bytes.length >= size) break read;
      scanned = raw.offset + raw.bytes.length + 1;
      const line = parse(raw);
      if (!line) continue;
      done.lines++;
      if (!done.firstAt) done.firstAt = line.ts;
      done.lastAt = line.ts;
      if (line.category) done.categories.add(line.category);
      for (const tag of line.tags ?? []) done.tags.add(tag);
    }
  }
  done.size = scanned;
  scans.set(file, done);
  return done;
}

const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));

/** 로그 파일 목록: 지금 쓰는 파일이 먼저, 떼어 낸 파일은 최근 것부터. stop 이 참이 되면 다음 파일을 훑지 않고 그때까지의 목록 */
async function listLogFiles(file: string, stop?: () => boolean): Promise<LogFile[]> {
  const dir = path.dirname(file);
  const names = [path.basename(file), ...rotatedFilesOf(file).reverse()];
  const out: LogFile[] = [];
  for (const [i, name] of names.entries()) {
    if (stop?.()) return out;
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch (error) {
      // 지금 파일이 아직 없다(기록 전), 그새 삭제됐다
      if (codeOf(error) !== "ENOENT") log.debug(`로그 파일 정보 읽기 실패: ${messageOf(error)}`);
      continue;
    }
    const s = await scan(full);
    if (!s) continue;
    out.push({ name, size: stat.size, modifiedAt: stat.mtimeMs, current: i === 0, firstAt: s.firstAt, lastAt: s.lastAt, lines: s.lines, categories: sorted(s.categories), tags: sorted(s.tags) });
  }
  // 사라진 파일의 기억은 버린다
  for (const known of scans.keys()) if (!names.some((name) => path.join(dir, name) === known)) scans.delete(known);
  return out;
}

/**
 * 읽을 파일. name 은 목록의 이름이어야 한다(경로를 받지 않는다). since 를 주면 그 첫 줄의 파일: 지금 파일이 떼어졌으면 떼어 낸 파일.
 * 없으면 null
 */
function resolveLogFile(file: string, name: string, since?: number): { name: string; path: string } | null {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const rotated = rotatedFilesOf(file);
  // 그 폴더에 있는 로그 파일 이름 가운데 하나만(요청 값이 아니라 찾은 이름으로 경로를 만든다)
  const picked = [base, ...rotated].find((one) => one === name);
  if (!picked) return null;
  const found = { name: picked, path: path.join(dir, picked) };
  if (!fs.existsSync(found.path)) return null;
  // 빈 파일(since 0)은 떼어지지 않는다
  if (since === undefined || !since || picked !== base || firstTime(found.path) === since) return found;
  const moved = rotated.reverse().find((one) => firstTime(path.join(dir, one)) === since);
  return moved ? { name: moved, path: path.join(dir, moved) } : null;
}

type PageQuery = { before?: number; after?: number; at?: number; limit: number; filter: LogFilter };

/** 묶음에서 keep 이 고른 줄을 limit 개까지. cut: 그 뒤에 고를 줄이 더 있었다 */
async function take(batches: AsyncGenerator<Raw[]>, keep: (raw: Raw) => FileLine | null, limit: number): Promise<{ lines: FileLine[]; cut: boolean }> {
  const lines: FileLine[] = [];
  for await (const batch of batches) {
    for (const raw of batch) {
      const line = keep(raw);
      if (!line) continue;
      if (lines.length === limit) return { lines, cut: true };
      lines.push(line);
    }
  }
  return { lines, cut: false };
}

/** 한 페이지를 읽는다. 위치는 줄의 시작이어야 한다(아니면 그 다음 줄부터). stop 이 참이 되면 그때까지 읽은 것으로 끝낸다(받는 쪽이 떠났다) */
async function readLogPage(target: { name: string; path: string }, query: PageQuery, stop?: () => boolean): Promise<FilePage | null> {
  return withFile(target.path, async (fd, size) => {
    const since = firstTimeOf(fd, size);
    const keep = (raw: Raw) => {
      const line = parse(raw);
      return line && matchesLog(line, query.filter) ? line : null;
    };
    // 맞은 줄 수는 처음 받는 페이지에서만 센다(이어 받는 페이지는 화면이 이미 안다)
    const counting = query.filter.q?.trim() && query.before === undefined && query.after === undefined;
    const page = async (lines: FileLine[], more: boolean, later: boolean): Promise<FilePage> => ({ name: target.name, since, lines, more, later, ...(counting ? { matches: await countMatches(fd, size, query.filter, stop) } : {}) });

    if (query.after !== undefined) {
      // 그 줄 뒤에서부터 아래로
      const from = nextLineStart(fd, Math.min(query.after, size) + 1, size);
      const { lines, cut } = await take(paced(forward(fd, from, size), stop), keep, query.limit);
      return page(lines, from > 0, cut);
    }

    // 앞의 줄: before 앞에서부터 위로. 시각으로 가면 그 줄 뒤로 몇 줄을 더 받도록 끝을 정한다
    let end = query.before === undefined ? size : nextLineStart(fd, Math.min(query.before, size), size);
    if (query.at !== undefined) {
      end = lowerBound(fd, query.at, size);
      let n = 0;
      for (const raw of forward(fd, end, size)) {
        end = raw.offset + raw.bytes.length + 1;
        if (++n > AT_AFTER_LINES + 1) {
          end = raw.offset;
          break;
        }
      }
      end = Math.min(end, size);
    }
    const { lines, cut } = await take(paced(backward(fd, end), stop), keep, query.limit);
    return page(lines.reverse(), cut, end < size);
  });
}

/** 필터를 모두 건 채 파일 전체에서 맞은 줄 수 */
async function countMatches(fd: number, size: number, filter: LogFilter, stop?: () => boolean): Promise<number> {
  let n = 0;
  for await (const batch of paced(forward(fd, 0, size), stop)) {
    for (const raw of batch) {
      const line = parse(raw);
      if (line && matchesLog(line, filter)) n++;
    }
  }
  return n;
}

/** 필터에 맞는 줄들을 앞에서부터 묶음으로(다운로드). 맞는 줄이 없는 묶음은 내지 않는다 */
async function* filteredLines(target: { path: string }, filter: LogFilter): AsyncGenerator<FileLine[]> {
  let fd: number;
  try {
    fd = fs.openSync(target.path, "r");
  } catch (error) {
    if (codeOf(error) !== "ENOENT") log.debug(`로그 파일 열기 실패(다운로드): ${messageOf(error)}`);
    return;
  }
  try {
    const size = fs.fstatSync(fd).size;
    for await (const batch of paced(forward(fd, 0, size))) {
      const lines: FileLine[] = [];
      for (const raw of batch) {
        const line = parse(raw);
        if (line && matchesLog(line, filter)) lines.push(line);
      }
      if (lines.length) yield lines;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** 다운로드의 한 줄: 화면과 같은 열(시각, 레벨, 카테고리, 태그, 글). 시각은 보는 사람의 시간대로(offsetMin: Date.getTimezoneOffset 의 값) */
function formatLogLine(line: FileLine, offsetMin: number): string {
  const d = new Date(line.ts - offsetMin * 60_000);
  const two = (n: number) => String(n).padStart(2, "0");
  const when = `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}.${String(d.getUTCMilliseconds()).padStart(3, "0")}`;
  const cat = [line.category, line.sub].filter(Boolean).join("/");
  const tags = (line.tags ?? []).map((t) => `#${t}`).join(" ");
  return [when, line.level.toUpperCase().padEnd(5), cat, tags, line.text].filter(Boolean).join(" ");
}

export { listLogFiles, resolveLogFile, readLogPage, filteredLines, formatLogLine };
export type { PageQuery };
