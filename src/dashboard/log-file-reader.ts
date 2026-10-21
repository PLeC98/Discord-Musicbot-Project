// 로그 파일 읽기(대시보드의 로그 파일 보기). 기록(infra/log/file.ts)이 남긴 NDJSON 을 실시간 로그와 같은 칸으로 읽는다.
//
// 쪽은 파일 안의 바이트 위치로 넘긴다: 어느 위치 앞의 줄(before, 없으면 끝에서부터) · 어느 줄 뒤의 줄(after) · 시각 둘레(at).
// 줄은 시간 순서라 시각은 위치를 반씩 좁혀 찾는다. 줄은 0x0A 로만 자른다(UTF-8 의 여러 바이트 글자 안에는 0x0A 가 없어 덩어리 경계에서 안전하다).
// 쓰는 중이라 덜 된 마지막 줄 · 읽을 수 없는 줄은 건너뛴다.
//
// 지금 쓰는 파일은 꽉 차면 이름이 바뀌어 떼어진다(내용은 그대로). 그래서 파일을 첫 줄의 시각(since)으로 알아보고,
// 보던 파일이 떼어졌으면 같은 첫 줄을 가진 떼어 낸 파일에서 이어 읽는다.
// 파일마다 줄 수 · 카테고리 · 태그 · 처음과 끝 시각은 한 번 훑어 기억한다(떼어 낸 파일은 바뀌지 않고, 지금 파일은 늘어난 부분만 더 훑는다).
// 찾기의 맞은 줄 수는 부를 때마다 파일 전체를 훑는다(입력이 멈춘 뒤 한 번 부른다)

import fs from "fs";
import path from "path";
import { rotatedFilesOf } from "../infra/log/file.ts";
import { wireFields } from "../infra/log/levels.ts";
import { AT_AFTER_LINES, matchesLog, type FileLine, type FilePage, type LogFile, type LogFilter } from "./contract/log-files.ts";

/** 한 번에 읽는 바이트 */
const CHUNK = 64 * 1024;
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
function firstTime(file: string): number {
  return (
    withFile(file, (fd, size) => {
      for (const raw of forward(fd, 0, size)) {
        const line = parse(raw);
        if (line) return line.ts;
      }
      return 0;
    }) ?? 0
  );
}

/** 파일을 열어 fn 을 부른다. 열 수 없으면 null */
function withFile<T>(file: string, fn: (fd: number, size: number) => T): T | null {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return null;
  }
  try {
    return fn(fd, fs.fstatSync(fd).size);
  } finally {
    fs.closeSync(fd);
  }
}

// ── 파일 목록 · 훑기 ──

type Scan = { since: number; size: number; lines: number; firstAt: number; lastAt: number; categories: Set<string>; tags: Set<string> };
const scans = new Map<string, Scan>();

/** 파일을 훑어 줄 수 · 카테고리 · 태그 · 처음과 끝 시각을 센다. 지난번에 훑은 같은 파일이면 늘어난 부분만 */
function scan(file: string): Scan | null {
  return withFile(file, (fd, size) => {
    const since = firstTime(file);
    const known = scans.get(file);
    const fresh: Scan = { since, size: 0, lines: 0, firstAt: 0, lastAt: 0, categories: new Set(), tags: new Set() };
    const done = known && known.since === since && known.size <= size ? known : fresh;
    if (done.size === size) return done;
    // 덜 된 마지막 줄은 다음에 다시 훑도록 줄바꿈으로 끝난 곳까지만 셈한다
    let scanned = done.size;
    for (const raw of forward(fd, done.size, size)) {
      const ended = raw.offset + raw.bytes.length < size;
      if (!ended) break;
      scanned = raw.offset + raw.bytes.length + 1;
      const line = parse(raw);
      if (!line) continue;
      done.lines++;
      if (!done.firstAt) done.firstAt = line.ts;
      done.lastAt = line.ts;
      if (line.category) done.categories.add(line.category);
      for (const tag of line.tags ?? []) done.tags.add(tag);
    }
    done.size = scanned;
    scans.set(file, done);
    return done;
  });
}

const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));

/** 로그 파일 목록: 지금 쓰는 파일이 먼저, 떼어 낸 파일은 최근 것부터 */
function listLogFiles(file: string): LogFile[] {
  const dir = path.dirname(file);
  const names = [path.basename(file), ...rotatedFilesOf(file).reverse()];
  const out: LogFile[] = [];
  for (const [i, name] of names.entries()) {
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue; // 지금 파일이 아직 없다(기록 전) · 그새 삭제됐다
    }
    const s = scan(full);
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
  if (name !== base && !rotated.includes(name)) return null;
  const found = { name, path: path.join(dir, name) };
  if (!fs.existsSync(found.path)) return null;
  // 빈 파일(since 0)은 떼어지지 않는다
  if (since === undefined || !since || name !== base || firstTime(found.path) === since) return found;
  const moved = rotated.reverse().find((one) => firstTime(path.join(dir, one)) === since);
  return moved ? { name: moved, path: path.join(dir, moved) } : null;
}

type PageQuery = { before?: number; after?: number; at?: number; limit: number; filter: LogFilter };

/** 한 쪽을 읽는다. 위치는 줄의 시작이어야 한다(아니면 그 다음 줄부터) */
function readLogPage(target: { name: string; path: string }, query: PageQuery): FilePage | null {
  return withFile(target.path, (fd, size) => {
    const since = firstTime(target.path);
    const keep = (raw: Raw) => {
      const line = parse(raw);
      return line && matchesLog(line, query.filter) ? line : null;
    };
    const page = (lines: FileLine[], more: boolean, later: boolean): FilePage => ({ name: target.name, since, lines, more, later, ...(query.filter.q?.trim() ? { matches: countMatches(fd, size, query.filter) } : {}) });

    if (query.after !== undefined) {
      // 그 줄 뒤에서부터 아래로
      const from = nextLineStart(fd, Math.min(query.after, size) + 1, size);
      const lines: FileLine[] = [];
      let later = false;
      for (const raw of forward(fd, from, size)) {
        const line = keep(raw);
        if (!line) continue;
        if (lines.length === query.limit) {
          later = true;
          break;
        }
        lines.push(line);
      }
      return page(lines, from > 0, later);
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
    const lines: FileLine[] = [];
    let more = false;
    for (const raw of backward(fd, end)) {
      const line = keep(raw);
      if (!line) continue;
      if (lines.length === query.limit) {
        more = true;
        break;
      }
      lines.push(line);
    }
    return page(lines.reverse(), more, end < size);
  });
}

/** 거르기를 모두 건 채 파일 전체에서 맞은 줄 수 */
function countMatches(fd: number, size: number, filter: LogFilter): number {
  let n = 0;
  for (const raw of forward(fd, 0, size)) {
    const line = parse(raw);
    if (line && matchesLog(line, filter)) n++;
  }
  return n;
}

/** 거르기에 맞는 줄들을 앞에서부터(내려받기) */
function* filteredLines(target: { path: string }, filter: LogFilter): Generator<FileLine> {
  let fd: number;
  try {
    fd = fs.openSync(target.path, "r");
  } catch {
    return;
  }
  try {
    const size = fs.fstatSync(fd).size;
    for (const raw of forward(fd, 0, size)) {
      const line = parse(raw);
      if (line && matchesLog(line, filter)) yield line;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** 내려받기의 한 줄: 화면과 같은 칸(시각 · 레벨 · 카테고리 · 태그 · 글). 시각은 보는 사람의 시간대로(offsetMin: Date.getTimezoneOffset 의 값) */
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
