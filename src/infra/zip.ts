// ZIP 읽기 · 쓰기(설정 내보내기 · 가져오기 · 전체 백업 · 로그인 배경 백업). Node 의 zlib 만 쓴다(deflate · crc32). 이 봇이 만든 파일과 흔한 압축 프로그램이 만든 파일을 읽는다.
// 쓰기는 하나의 흘려 쓰기(writeZip)가 받는 곳(메모리 · 파일 · 응답)에 쓴다: 바이트로 준 항목은 줄어들면 deflate, 파일로 준 항목은 그대로 담는다(영상 조각 · 그림은 이미 압축됐다).
// 4GB 를 넘는 항목 · 위치 · 목차, 65535 개를 넘는 항목은 ZIP64 로 적는다.
// 읽기는 읽을 곳(메모리 · 파일)만 갈아 끼우고 목차 읽기 · 항목 풀기는 같다. 받는 쪽: 항목 수 · 풀린 크기에 상한을 두고,
// 경로가 폴더 밖을 가리키거나(.. · 절대 경로) 암호 · 모르는 압축이면 거절한다. 풀린 내용은 크기 · CRC 를 맞춰 본다

import fs from "node:fs";
import { once } from "node:events";
import { Readable, Transform, type Writable } from "node:stream";
import zlib from "node:zlib";

/** 항목 하나. name 은 / 로 나눈 경로 */
type ZipEntry = { name: string; data: Buffer };
/** 쓸 항목: 바이트 그대로 또는 파일(흘려 담는다) */
type ZipInput = ZipEntry | { name: string; file: string };

const SIG = { local: 0x04034b50, central: 0x02014b50, end: 0x06054b50, end64: 0x06064b50, locator64: 0x07064b50 } as const;
const UTF8 = 1 << 11;
const ENCRYPTED = 1;
const STORE = 0;
const DEFLATE = 8;
/** 32비트 칸에 들지 않으면 ZIP64 */
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const ZIP64_EXTRA = 0x0001;

// ZIP 의 시각(MS-DOS). 2초 단위 · 로컬 시각
function dosTime(at: Date) {
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2);
  const date = ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  return { time, date };
}

// ── 쓰기 ──

/** 받는 곳: 조각을 차례로 받는다(흐름 조절은 받는 곳이) */
type Sink = (chunk: Buffer) => Promise<void>;

/** 흐름(파일 · 응답)을 받는 곳으로. 버퍼가 차면 비워질 때까지 기다린다. 그 사이 닫히면(내려받던 쪽이 끊었다) 실패로 멈춘다 */
function sinkOf(out: Writable): Sink {
  const closed = () => new Error("받는 쪽이 닫혔습니다");
  return async (chunk) => {
    if (out.destroyed) throw closed();
    if (out.write(chunk)) return;
    const stop = new AbortController();
    try {
      await Promise.race([once(out, "drain", { signal: stop.signal }), once(out, "close", { signal: stop.signal }).then(() => Promise.reject(closed()))]);
    } finally {
      stop.abort();
    }
  };
}

/** 항목 하나의 몸통: 방식 · CRC · 담은 크기 · 풀린 크기 */
type Body = { method: number; crc: number; packed: number; size: number };

/** 바이트로 준 항목: 줄어들면 deflate */
function dataBody(data: Buffer): Body & { body: Buffer } {
  const deflated = zlib.deflateRawSync(data);
  const [method, body] = deflated.length < data.length ? [DEFLATE, deflated] : [STORE, data];
  return { method, crc: zlib.crc32(data), packed: body.length, size: data.length, body };
}

/** 파일로 준 항목: 그대로 담는다. 한 번 읽어 CRC 를 재고(머리에 먼저 적는다), 담을 때 다시 흘려 읽는다 */
async function fileBody(file: string): Promise<Body> {
  let crc = 0;
  for await (const chunk of fs.createReadStream(file)) crc = zlib.crc32(chunk as Buffer, crc);
  const size = fs.statSync(file).size;
  return { method: STORE, crc, packed: size, size };
}

/** ZIP64 덧칸(풀린 크기 · 담은 크기 · 위치 중 32비트를 넘는 것만, 이 차례로) */
function zip64Extra(fields: number[]): Buffer {
  if (!fields.length) return Buffer.alloc(0);
  const extra = Buffer.alloc(4 + fields.length * 8);
  extra.writeUInt16LE(ZIP64_EXTRA, 0);
  extra.writeUInt16LE(fields.length * 8, 2);
  fields.forEach((value, i) => extra.writeBigUInt64LE(BigInt(value), 4 + i * 8));
  return extra;
}

type When = { time: number; date: number };

/** 항목의 머리(몸통 앞). big 이면 크기를 ZIP64 덧칸에 */
function localHeader(nameBytes: Buffer, body: Body, { time, date }: When, big: boolean): Buffer {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(SIG.local, 0);
  local.writeUInt16LE(big ? 45 : 20, 4); // 풀 때 필요한 버전(ZIP64 는 4.5)
  local.writeUInt16LE(UTF8, 6);
  local.writeUInt16LE(body.method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(body.crc, 14);
  local.writeUInt32LE(big ? MAX32 : body.packed, 18);
  local.writeUInt32LE(big ? MAX32 : body.size, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const extra = big ? zip64Extra([body.size, body.packed]) : Buffer.alloc(0);
  local.writeUInt16LE(extra.length, 28);
  return Buffer.concat([local, nameBytes, extra]);
}

/** 목차 한 줄. big 이면 크기를, far 면 머리의 자리를 ZIP64 덧칸에 */
function centralHeader(nameBytes: Buffer, body: Body, localAt: number, { time, date }: When, { big, far }: { big: boolean; far: boolean }): Buffer {
  const extra = zip64Extra([...(big ? [body.size, body.packed] : []), ...(far ? [localAt] : [])]);
  const version = extra.length ? 45 : 20;
  const central = Buffer.alloc(46);
  central.writeUInt32LE(SIG.central, 0);
  central.writeUInt16LE(version, 4);
  central.writeUInt16LE(version, 6);
  central.writeUInt16LE(UTF8, 8);
  central.writeUInt16LE(body.method, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(body.crc, 16);
  central.writeUInt32LE(big ? MAX32 : body.packed, 20);
  central.writeUInt32LE(big ? MAX32 : body.size, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(extra.length, 30);
  central.writeUInt32LE(far ? MAX32 : localAt, 42);
  return Buffer.concat([central, nameBytes, extra]);
}

/** 항목 하나의 머리와 목차 줄(32비트를 넘는 것은 ZIP64, force64 면 늘) */
function headersOf(name: string, body: Body, localAt: number, when: When, force64 = false): { local: Buffer; central: Buffer } {
  const nameBytes = Buffer.from(name, "utf8");
  const big = force64 || body.size >= MAX32 || body.packed >= MAX32;
  const far = force64 || localAt >= MAX32;
  return { local: localHeader(nameBytes, body, when, big), central: centralHeader(nameBytes, body, localAt, when, { big, far }) };
}

/** 목차 뒤의 끝 기록. 항목 수 · 목차 자리 · 크기가 32비트(항목 수는 16비트)를 넘으면 ZIP64 끝 기록과 자리표를 앞에 붙인다 */
function endOf(count: number, directoryAt: number, directoryLength: number, force64 = false): Buffer {
  const needs64 = force64 || count > MAX16 || directoryAt >= MAX32 || directoryLength >= MAX32;
  const parts: Buffer[] = [];
  if (needs64) {
    const end64At = directoryAt + directoryLength;
    const end64 = Buffer.alloc(56);
    end64.writeUInt32LE(SIG.end64, 0);
    end64.writeBigUInt64LE(44n, 4); // 이 기록에서 이 칸 뒤의 크기
    end64.writeUInt16LE(45, 12);
    end64.writeUInt16LE(45, 14);
    end64.writeBigUInt64LE(BigInt(count), 24);
    end64.writeBigUInt64LE(BigInt(count), 32);
    end64.writeBigUInt64LE(BigInt(directoryLength), 40);
    end64.writeBigUInt64LE(BigInt(directoryAt), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(SIG.locator64, 0);
    locator.writeBigUInt64LE(BigInt(end64At), 8);
    locator.writeUInt32LE(1, 16);
    parts.push(end64, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG.end, 0);
  end.writeUInt16LE(needs64 ? MAX16 : count, 8);
  end.writeUInt16LE(needs64 ? MAX16 : count, 10);
  end.writeUInt32LE(needs64 ? MAX32 : directoryLength, 12);
  end.writeUInt32LE(needs64 ? MAX32 : directoryAt, 16);
  return Buffer.concat([...parts, end]);
}

/** 메모리에 묶는다(작은 묶음: 설정 내보내기 등). 줄어들지 않는 것(이미 압축된 그림)은 그대로 담는다 */
function zip(entries: ZipEntry[], at = new Date()): Buffer {
  const when = dosTime(at);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const body = dataBody(data);
    const { local, central } = headersOf(name, body, offset, when);
    locals.push(local, body.body);
    centrals.push(central);
    offset += local.length + body.body.length;
  }
  const directory = Buffer.concat(centrals);
  return Buffer.concat([...locals, directory, endOf(entries.length, offset, directory.length)]);
}

/** 흘려 묶는다(큰 묶음: 로그인 배경 · 전체 백업). 파일로 준 항목은 그대로 흘려 담는다. 쓴 바이트 수. zip64 는 작아도 ZIP64 꼴로 적는다(시험 · 호환 확인) */
async function writeZip(inputs: ZipInput[], sink: Sink, { at = new Date(), zip64 = false }: { at?: Date; zip64?: boolean } = {}): Promise<number> {
  const when = dosTime(at);
  const centrals: Buffer[] = [];
  let offset = 0;
  const put = async (chunk: Buffer) => {
    await sink(chunk);
    offset += chunk.length;
  };
  for (const input of inputs) {
    const body = "data" in input ? dataBody(input.data) : await fileBody(input.file);
    const { local, central } = headersOf(input.name, body, offset, when, zip64);
    centrals.push(central);
    await put(local);
    if ("data" in input) await put((body as Body & { body: Buffer }).body);
    else for await (const chunk of fs.createReadStream(input.file)) await put(chunk as Buffer);
  }
  const directoryAt = offset;
  const directory = Buffer.concat(centrals);
  await put(directory);
  await put(endOf(inputs.length, directoryAt, directory.length, zip64));
  return offset;
}

// ── 읽기 ──

// 기반 층이라 오류 도구(rules)를 부르지 않는다. 코드는 같은 꼴(code 칸)
const bad = (why: string) => Object.assign(new Error(`ZIP 파일을 읽을 수 없습니다: ${why}`), { code: "BAD_ZIP" });

/** 읽을 곳: 크기 · 그 자리의 바이트 · 그 자리부터 흘려 읽기 */
type Source = { size: number; read(at: number, length: number): Buffer; stream(at: number, length: number): Readable };

const bufferSource = (buf: Buffer): Source => ({ size: buf.length, read: (at, length) => buf.subarray(at, at + length), stream: (at, length) => Readable.from([buf.subarray(at, at + length)]) });

function fileSource(file: string, fd: number): Source {
  const size = fs.fstatSync(fd).size;
  return {
    size,
    read(at, length) {
      const out = Buffer.alloc(Math.max(0, Math.min(length, size - at)));
      if (out.length) fs.readSync(fd, out, 0, out.length, at);
      return out;
    },
    stream: (at, length) => fs.createReadStream(file, { start: at, end: at + length - 1 }),
  };
}

// 폴더 밖을 가리키는 경로는 받지 않는다(풀어 쓰는 곳이 없어도 이름을 믿지 않는다)
function safeName(name: string) {
  return !name.startsWith("/") && !/^[a-zA-Z]:/.test(name) && !name.split("/").includes("..");
}

/** 목차의 한 줄 */
type Central = { name: string; flags: number; method: number; crc: number; packed: number; size: number; localAt: number };

/** 목차의 자리 · 크기 · 항목 수. 끝 기록(EOCD)은 맨 뒤 22바이트에 주석(최대 65535)이 붙을 수 있고, ZIP64 면 그 앞의 자리표가 ZIP64 끝 기록을 가리킨다 */
function directoryOf(src: Source): { at: number; count: number } {
  if (src.size < 22) throw bad("ZIP 이 아닙니다");
  const tail = src.read(Math.max(0, src.size - 22 - MAX16), Math.min(src.size, 22 + MAX16));
  const tailAt = src.size - tail.length;
  let end = -1;
  for (let at = tail.length - 22; at >= 0; at--) {
    if (tail.readUInt32LE(at) === SIG.end) {
      end = at;
      break;
    }
  }
  if (end < 0) throw bad("ZIP 이 아닙니다");
  const count = tail.readUInt16LE(end + 10);
  const at = tail.readUInt32LE(end + 16);
  if (count !== MAX16 && at !== MAX32) return { at, count };
  // ZIP64: 끝 기록 바로 앞 20바이트가 자리표
  const locatorAt = tailAt + end - 20;
  const locator = locatorAt >= 0 ? src.read(locatorAt, 20) : Buffer.alloc(0);
  if (locator.length < 20 || locator.readUInt32LE(0) !== SIG.locator64) throw bad("ZIP64 자리표가 없습니다");
  const end64 = src.read(Number(locator.readBigUInt64LE(8)), 56);
  if (end64.length < 56 || end64.readUInt32LE(0) !== SIG.end64) throw bad("ZIP64 끝 기록이 깨졌습니다");
  return { at: Number(end64.readBigUInt64LE(48)), count: Number(end64.readBigUInt64LE(32)) };
}

/** 목차 한 줄을 읽고 받을 수 없는 꼴을 거른다(ZIP64 덧칸에서 큰 값을 읽는다). 다음 줄의 자리도 */
function centralAt(src: Source, at: number): { entry: Central; next: number } {
  const head = src.read(at, 46);
  if (head.length < 46 || head.readUInt32LE(0) !== SIG.central) throw bad("목차가 깨졌습니다");
  const nameLength = head.readUInt16LE(28);
  const extraLength = head.readUInt16LE(30);
  const rest = src.read(at + 46, nameLength + extraLength);
  const flags = head.readUInt16LE(8);
  const method = head.readUInt16LE(10);
  const crc = head.readUInt32LE(16);
  let packed = head.readUInt32LE(20);
  let size = head.readUInt32LE(24);
  let localAt = head.readUInt32LE(42);
  // Windows PowerShell 5.1 의 Compress-Archive 는 경로를 \ 로 나눈다
  const name = rest.toString("utf8", 0, nameLength).replaceAll("\\", "/");
  // ZIP64 덧칸: 32비트 칸이 가득 찬 것만, 풀린 크기 · 담은 크기 · 위치 차례로
  for (let x = nameLength; x + 4 <= nameLength + extraLength;) {
    const id = rest.readUInt16LE(x);
    const length = rest.readUInt16LE(x + 2);
    if (id === ZIP64_EXTRA) {
      let field = x + 4;
      const next = () => {
        const value = Number(rest.readBigUInt64LE(field));
        field += 8;
        return value;
      };
      if (size === MAX32) size = next();
      if (packed === MAX32) packed = next();
      if (localAt === MAX32) localAt = next();
    }
    x += 4 + length;
  }
  if (flags & ENCRYPTED) throw bad(`암호가 걸린 항목입니다(${name})`);
  if (!safeName(name)) throw bad(`받을 수 없는 경로입니다(${name})`);
  return { entry: { name, flags, method, crc, packed, size, localAt }, next: at + 46 + nameLength + extraLength + head.readUInt16LE(32) };
}

/** 목차(폴더 항목은 뺀다). maxEntries 를 넘으면 BAD_ZIP */
function entriesOf(src: Source, maxEntries: number): Central[] {
  const { at, count } = directoryOf(src);
  if (count > maxEntries) throw bad(`항목이 너무 많습니다(${count}개)`);
  const out: Central[] = [];
  let cursor = at;
  for (let i = 0; i < count; i++) {
    const { entry, next } = centralAt(src, cursor);
    if (!entry.name.endsWith("/")) out.push(entry);
    cursor = next;
  }
  return out;
}

/** 항목 몸통의 자리 */
function bodyAt(src: Source, { name, localAt }: Central): number {
  const local = src.read(localAt, 30);
  if (local.length < 30 || local.readUInt32LE(0) !== SIG.local) throw bad(`항목이 깨졌습니다(${name})`);
  return localAt + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
}

// 항목의 몸통을 풀고 크기 · CRC 를 맞춰 본다(메모리로)
function bodyOf(src: Source, entry: Central): Buffer {
  const { name, method, crc, packed, size } = entry;
  const body = src.read(bodyAt(src, entry), packed);
  if (body.length !== packed) throw bad(`항목이 잘렸습니다(${name})`);
  let data: Buffer;
  if (method === STORE) data = Buffer.from(body);
  else if (method === DEFLATE) {
    try {
      data = zlib.inflateRawSync(body, { maxOutputLength: size });
    } catch {
      throw bad(`풀지 못했습니다(${name})`);
    }
  } else throw bad(`모르는 압축 방식입니다(${name})`);
  if (data.length !== size || zlib.crc32(data) !== crc) throw bad(`내용이 맞지 않습니다(${name})`);
  return data;
}

/** 항목을 흘려 읽는다(큰 항목). 끝에서 크기 · CRC 가 맞지 않으면 BAD_ZIP 으로 끊는다 */
function bodyStream(src: Source, entry: Central): Readable {
  const { name, method, crc, packed, size } = entry;
  if (method !== STORE && method !== DEFLATE) throw bad(`모르는 압축 방식입니다(${name})`);
  const raw = src.stream(bodyAt(src, entry), packed);
  let sum = 0;
  let seen = 0;
  const check = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      sum = zlib.crc32(chunk, sum);
      seen += chunk.length;
      done(seen > size ? bad(`풀린 크기가 맞지 않습니다(${name})`) : null, chunk);
    },
    flush(done) {
      done(seen !== size || sum !== crc ? bad(`내용이 맞지 않습니다(${name})`) : null);
    },
  });
  const unpacked = method === DEFLATE ? raw.pipe(zlib.createInflateRaw()) : raw;
  unpacked.on("error", (error) => check.destroy(error));
  return unpacked.pipe(check);
}

/** 푼다(메모리의 작은 묶음). maxEntries · maxBytes 를 넘으면 BAD_ZIP */
function unzip(buf: Buffer, { maxEntries = 64, maxBytes = 64 * 1024 * 1024 }: { maxEntries?: number; maxBytes?: number } = {}): ZipEntry[] {
  const src = bufferSource(buf);
  let left = maxBytes;
  return entriesOf(src, maxEntries).map((entry) => {
    if (entry.size > left) throw bad("풀린 크기가 너무 큽니다");
    left -= entry.size;
    return { name: entry.name, data: bodyOf(src, entry) };
  });
}

/** 파일의 ZIP 을 연다(큰 묶음). 목차와, 항목을 메모리로(작은 것) · 흘려 읽기. 다 쓰면 close */
function openZip(file: string, { maxEntries = 100_000 }: { maxEntries?: number } = {}) {
  const fd = fs.openSync(file, "r");
  try {
    const src = fileSource(file, fd);
    const entries = entriesOf(src, maxEntries);
    return {
      entries,
      read(entry: Central, maxBytes: number): Buffer {
        if (entry.size > maxBytes) throw bad(`항목이 너무 큽니다(${entry.name})`);
        return bodyOf(src, entry);
      },
      stream: (entry: Central) => bodyStream(src, entry),
      close: () => fs.closeSync(fd),
    };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

export { zip, writeZip, sinkOf, unzip, openZip };
export type { ZipEntry, ZipInput, Central as ZipItem };
