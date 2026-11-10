// 로그 파일 읽기(대시보드의 로그 파일 보기). 기록(infra/log/file.ts)이 남긴 NDJSON 을 실시간 로그와 같은 필드로 읽는다.
//
// 페이지는 파일 안의 바이트 위치로 넘긴다: 어느 위치 앞의 줄(before, 없으면 끝에서부터), 어느 줄 뒤의 줄(after), 시각 둘레(at).
// 줄은 시간 순서라 시각은 위치를 반씩 좁혀 찾는다. 줄은 0x0A 로만 자른다(UTF-8 의 여러 바이트 글자 안에는 0x0A 가 없어 청크 경계에서 안전하다).
// 쓰는 중이라 덜 된 마지막 줄, 읽을 수 없는 줄은 건너뛴다.
//
// 지금 쓰는 파일은 꽉 차면 이름이 바뀌어 떼어진다(내용은 그대로). 그래서 파일을 첫 줄의 시각(since)으로 알아보고,
// 보던 파일이 떼어졌으면 같은 첫 줄을 가진 떼어 낸 파일에서 이어 읽는다.
// 파일마다 줄 수, 카테고리, 태그, 처음과 끝 시각은 한 번 훑어 기억한다(떼어 낸 파일은 바뀌지 않고, 지금 파일은 늘어난 부분만 더 훑는다).
// 검색 조건에 맞는 줄 수는 첫 페이지를 받을 때마다 파일 전체를 앞에서부터 한 번 훑으며 세고, 그 페이지에 들어갈 줄도 함께 추린다.
// 파일 끝까지 읽을 수 있는 작업(목록, 일치하는 줄 수, 드문 필터의 페이지, 다운로드)은 청크(SCAN_BYTES)마다 이벤트 루프를 양보한다(파일 하나가 최대 10GB까지).
// 검색어가 있으면 청크째 정규화해 정규식으로 후보 줄만 추리고, 그 줄만 파싱해 필터로 확인한다(prefilterOf)

import fs from "fs";
import path from "path";
import { setImmediate as nextTurn } from "timers/promises";
import { rotatedFilesOf } from "../infra/log/file.ts";
import { wireFields } from "../infra/log/levels.ts";
import logger from "../infra/log/logger.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import { koPattern, koTidy } from "../rules/ko-search.ts";
import { AT_AFTER_LINES, matchesLog, type FileLine, type FilePage, type LogFile, type LogFilter } from "./contract/log-files.ts";
const log = logger.child({ category: "dashboard" });

/** 짧게 읽을 때(첫 줄, 시각 찾기) 한 번에 읽는 바이트 */
const CHUNK = 64 * 1024;
/** 파일을 길게 훑을 때 한 청크의 바이트 수. 청크마다 이벤트 루프를 양보한다(한 줄이 이보다 길면 그 줄 끝까지) */
const SCAN_BYTES = 256 * 1024;
const NL = 0x0a;

type Raw = { offset: number; bytes: Buffer };
/** 줄 경계로 자른 바이트 구간(at은 파일 안의 위치) */
type Chunk = { at: number; buf: Buffer };

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

/** from(줄의 시작)부터 end까지를 줄 경계로 자른 청크들. 마지막 청크는 줄바꿈 없이 끝날 수 있다 */
function* chunksForward(fd: number, from: number, end: number, bytes: number): Generator<Chunk> {
  for (let pos = from; pos < end;) {
    const first = readAt(fd, pos, Math.min(bytes, end - pos));
    if (!first.length) return;
    const pieces = [first];
    let length = first.length;
    let cut = first.lastIndexOf(NL) + 1;
    // 한 줄이 청크보다 길면 줄바꿈이 나오거나 끝날 때까지 더 읽는다(버퍼를 모았다가 한 번에 합친다. 읽을 때마다 붙이면 줄 길이의 제곱만큼 복사한다)
    while (!cut && pos + length < end) {
      const more = readAt(fd, pos + length, Math.min(bytes, end - pos - length));
      if (!more.length) break;
      const i = more.lastIndexOf(NL);
      if (i >= 0) cut = length + i + 1;
      pieces.push(more);
      length += more.length;
    }
    const buf = pieces.length === 1 ? first : Buffer.concat(pieces, length);
    const take = pos + buf.length >= end || !cut ? buf.length : cut;
    yield { at: pos, buf: buf.subarray(0, take) };
    pos += take;
  }
}

/** before(줄의 시작이나 파일 끝) 앞을 뒤에서부터 줄 경계로 자른 청크들(청크 안은 앞에서부터) */
function* chunksBackward(fd: number, before: number, bytes: number): Generator<Chunk> {
  for (let end = before; end > 0;) {
    let start = Math.max(0, end - bytes);
    const last = readAt(fd, start, end - start);
    const pieces = [last];
    // 청크는 줄의 시작에서 시작한다: 파일 맨 앞이 아니면 첫 줄바꿈 뒤부터 자른다(마지막 바이트의 줄바꿈은 청크 끝 줄의 것이라 제외한다)
    const i = last.indexOf(NL);
    let skip = start === 0 ? 0 : i >= 0 && i < last.length - 1 ? i + 1 : -1;
    // 한 줄이 청크보다 길면 그 줄의 시작이 나올 때까지 앞으로 더 읽는다(버퍼를 모았다가 한 번에 합친다)
    while (skip < 0) {
      const from = Math.max(0, start - bytes);
      const piece = readAt(fd, from, start - from);
      pieces.push(piece);
      start = from;
      const j = piece.indexOf(NL);
      if (start === 0) skip = 0;
      else if (j >= 0) skip = j + 1;
    }
    const buf = pieces.length === 1 ? last : Buffer.concat(pieces.reverse());
    yield { at: start + skip, buf: buf.subarray(skip) };
    end = start + skip;
  }
}

/** 청크 안의 줄들(앞에서부터). 끝에 줄바꿈이 없는 줄도 반환한다 */
function linesOf({ at, buf }: Chunk): Raw[] {
  const out: Raw[] = [];
  let start = 0;
  for (let i = buf.indexOf(NL); i >= 0; i = buf.indexOf(NL, start)) {
    out.push({ offset: at + start, bytes: buf.subarray(start, i) });
    start = i + 1;
  }
  if (start < buf.length) out.push({ offset: at + start, bytes: buf.subarray(start) });
  return out;
}

/** from(줄의 시작)부터 end까지의 줄들을 앞에서부터 읽는다 */
function* forward(fd: number, from: number, end: number): Generator<Raw> {
  for (const chunk of chunksForward(fd, from, end, CHUNK)) yield* linesOf(chunk);
}

// JSON에서 이스케이프하는 문자(", \, 제어 문자, 짝 없는 서로게이트)나 이스케이프 시퀀스(\n의 n 등) 바로 뒤에서 청크 단위 정규화와 필드 단위 정규화 결과가
// 달라질 수 있는 문자(결합 문자는 앞 글자와 합쳐지고, 그리스 시그마는 앞 글자에 따라 형태가 바뀐다)
const UNSAFE_QUERY = /[\u0000-\u001f"\\σς\ud800-\udfff]|\p{M}/u;
// 초성 사이에서 건너뛰는 공백: 일반 공백(줄바꿈 제외), JSON에서 이스케이프된 공백. 초성 문자와 겹치지 않는다
const JSON_GLUE = String.raw`(?:[^\S\n]|\\[nrtfb]|\\u[0-9a-f]{4})*`;
// 화면 표시 텍스트가 원본 바이트와 달라지는 줄(wireFields가 변환)도 늘 후보에 넣는다: ANSI를 제거할 ESC, 문자열이 아닌 msg, 태그 안의 배열이나 객체.
// 각 줄은 JSON.stringify로 기록했다(키 뒤에 공백이 없다). 정규식 .은 U+2028을 넘지 못하므로 [^\n]으로 매칭한다
const RECAST = String.raw`\\u001b|"msg":[[{]|"tags":\[[^\n]*[[{]`;

/**
 * 청크 단위 사전 필터링 정규식(쓸 수 없으면 null). 정규화한 청크에서 이 정규식에 매칭된 줄만 후보로 추리고, 최종 판정은 matchesLog가 다시 한다.
 * 키나 다른 필드에서 매칭된 줄도 후보가 되지만(최종 판정에서 제외된다) 대상 필드에서 일치하는 줄은 빠짐없이 포함된다
 */
function prefilterOf(filter: LogFilter): RegExp | null {
  const q = filter.q ?? "";
  if (!koTidy(q.trim()) || UNSAFE_QUERY.test(koTidy(q.trim()))) return null;
  const source = koPattern(q, JSON_GLUE);
  return source ? new RegExp(`${source}|${RECAST}`, "g") : null;
}

/** 청크에서 정규식에 매칭된 줄들(앞에서부터) */
function candidatesOf(chunk: Chunk, re: RegExp): Raw[] {
  const lines = linesOf(chunk);
  // 다듬어도 줄바꿈 수는 그대로라 글의 줄 번호가 바이트의 줄 번호다
  const text = koTidy(chunk.buf.toString("utf8"));
  const out: Raw[] = [];
  let line = 0;
  let counted = 0;
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    for (let k = text.indexOf("\n", counted); k >= 0 && k < m.index; k = text.indexOf("\n", k + 1)) line++;
    if (lines[line]) out.push(lines[line]);
    // 걸린 줄은 하나로 치고 다음 줄에서 다시 찾는다(걸린 글은 줄바꿈을 넘지 않는다)
    const next = text.indexOf("\n", m.index);
    if (next < 0) break;
    line++;
    counted = next + 1;
    re.lastIndex = next + 1;
  }
  return out;
}

/**
 * 파일을 길게 훑는 경로: 청크마다 줄을(re가 있으면 후보 줄만) 순서대로 내보내고, 청크 사이에 이벤트 루프를 양보한다(후보가 없는 청크도).
 * backward면 뒤에서부터 읽는다. stop이 참이 되면 다음 청크를 내지 않고 끝난다(요청한 쪽 연결이 끊긴 경우로, 끝까지 읽은 것과 구별하지 않는다)
 */
async function* paced(chunks: Generator<Chunk>, { re, backward = false, stop }: { re?: RegExp | null; backward?: boolean; stop?: () => boolean } = {}): AsyncGenerator<Raw[]> {
  for (const chunk of chunks) {
    const lines = re ? candidatesOf(chunk, re) : linesOf(chunk);
    if (lines.length) yield backward ? lines.reverse() : lines;
    await nextTurn();
    if (stop?.()) return;
  }
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

/** 파일을 열어 fn을 호출한다. fn이 Promise를 반환하면 그 작업이 끝난 뒤에 닫는다. 열 수 없으면 null */
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

/** 파일을 훑어 줄 수, 카테고리, 태그, 처음과 끝 시각을 집계한다. 이전에 훑은 같은 파일이면 늘어난 부분만 더 훑고, 이미 훑는 중이면 그 결과를 기다린다 */
function scan(file: string): Promise<Scan | null> {
  const running = scanning.get(file);
  if (running) return running;
  const job = (withFile(file, (fd, size) => scanFile(file, fd, size)) ?? Promise.resolve(null)).finally(() => scanning.delete(file));
  scanning.set(file, job);
  return job;
}

/** scan의 본체. 캐시된 값을 직접 수정하지 않고 사본에 누적해 다 훑은 뒤에 교체한다(그동안 다른 요청은 기존 캐시 값을 읽는다) */
async function scanFile(file: string, fd: number, size: number): Promise<Scan> {
  const since = firstTimeOf(fd, size);
  const known = scans.get(file);
  const base = known && known.since === since && known.size <= size ? known : null;
  if (base?.size === size) return base;
  const done: Scan = base ? { ...base, categories: new Set(base.categories), tags: new Set(base.tags) } : { since, size: 0, lines: 0, firstAt: 0, lastAt: 0, categories: new Set(), tags: new Set() };
  // 덜 된 마지막 줄은 다음에 다시 훑도록 줄바꿈으로 끝난 곳까지만 센다
  let scanned = done.size;
  read: for await (const batch of paced(chunksForward(fd, done.size, size, SCAN_BYTES))) {
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

/** 로그 파일 목록: 지금 쓰는 파일이 먼저 오고, 로테이션된 파일은 최근 것부터 온다. stop이 참이 되면 다음 파일을 훑지 않고 그때까지의 목록을 반환한다 */
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
type Keep = (raw: Raw) => FileLine | null;

/** 청크에서 keep을 통과한 줄을 limit개까지 모은다. cut: 그 뒤에도 조건에 맞는 줄이 더 있는지 여부 */
async function take(batches: AsyncGenerator<Raw[]>, keep: Keep, limit: number): Promise<{ lines: FileLine[]; cut: boolean }> {
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

/** 앞에서부터 파일 전체를 한 번 훑어 일치하는 줄 수와 end 앞의 마지막 limit개 줄을 구한다. more: end 앞에 일치하는 줄이 더 있는지 여부 */
async function countAndLast(batches: AsyncGenerator<Raw[]>, keep: Keep, end: number, limit: number) {
  const ring: FileLine[] = [];
  let matches = 0;
  let before = 0;
  for await (const batch of batches) {
    for (const raw of batch) {
      const line = keep(raw);
      if (!line) continue;
      matches++;
      if (raw.offset >= end) continue;
      ring[before % limit] = line;
      before++;
    }
  }
  const head = before % limit;
  const lines = before <= limit ? ring.slice(0, before) : [...ring.slice(head), ...ring.slice(0, head)];
  return { matches, lines, more: before > limit };
}

/** 한 페이지를 읽는다. 위치는 줄의 시작이어야 한다(아니면 그다음 줄부터). stop이 참이 되면 그때까지 읽은 것으로 끝낸다(요청한 쪽 연결이 끊김) */
async function readLogPage(target: { name: string; path: string }, query: PageQuery, stop?: () => boolean): Promise<FilePage | null> {
  return withFile(target.path, async (fd, size) => {
    const since = firstTimeOf(fd, size);
    const keep: Keep = (raw) => {
      const line = parse(raw);
      return line && matchesLog(line, query.filter) ? line : null;
    };
    const re = prefilterOf(query.filter);

    if (query.after !== undefined) {
      // 그 줄 뒤에서부터 아래로
      const from = nextLineStart(fd, Math.min(query.after, size) + 1, size);
      const { lines, cut } = await take(paced(chunksForward(fd, from, size, SCAN_BYTES), { re, stop }), keep, query.limit);
      return { name: target.name, since, lines, more: from > 0, later: cut };
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
    // 맞은 줄 수는 처음 받는 페이지에서만 센다(이어 받는 페이지는 화면이 이미 안다)
    if (query.filter.q?.trim() && query.before === undefined) {
      const { matches, lines, more } = await countAndLast(paced(chunksForward(fd, 0, size, SCAN_BYTES), { re, stop }), keep, end, query.limit);
      return { name: target.name, since, lines, more, later: end < size, matches };
    }
    const { lines, cut } = await take(paced(chunksBackward(fd, end, SCAN_BYTES), { re, backward: true, stop }), keep, query.limit);
    return { name: target.name, since, lines: lines.reverse(), more: cut, later: end < size };
  });
}

/** 필터에 맞는 줄들을 앞에서부터 청크 단위로 내보낸다(다운로드용). 맞는 줄이 없는 청크는 건너뛴다 */
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
    for await (const batch of paced(chunksForward(fd, 0, size, SCAN_BYTES), { re: prefilterOf(filter) })) {
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
