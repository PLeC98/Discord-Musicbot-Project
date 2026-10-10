// ZIP 읽기 · 쓰기(설정 내보내기 · 가져오기). Node 의 zlib 만 쓴다(deflate · crc32). 이 봇이 만든 파일과 흔한 압축 프로그램이 만든 파일을 읽는다.
// 받는 쪽: 항목 수 · 풀린 크기에 상한을 두고, 경로가 폴더 밖을 가리키거나(.. · 절대 경로) ZIP64 · 암호 · 모르는 압축이면 거절한다.

import zlib from "node:zlib";

/** 항목 하나. name 은 / 로 나눈 경로 */
type ZipEntry = { name: string; data: Buffer };

const SIG = { local: 0x04034b50, central: 0x02014b50, end: 0x06054b50 } as const;
const UTF8 = 1 << 11;
const ENCRYPTED = 1;
const STORE = 0;
const DEFLATE = 8;

// ZIP 의 시각(MS-DOS). 2초 단위 · 로컬 시각
function dosTime(at: Date) {
  const time = (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2);
  const date = ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
  return { time, date };
}

/** 묶는다. 줄어들지 않는 것(이미 압축된 그림)은 그대로 담는다 */
function zip(entries: ZipEntry[], at = new Date()): Buffer {
  const { time, date } = dosTime(at);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data);
    const [method, body] = deflated.length < data.length ? [DEFLATE, deflated] : [STORE, data];
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG.local, 0);
    local.writeUInt16LE(20, 4); // 풀 때 필요한 버전 2.0
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG.central, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG.end, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// 기반 층이라 오류 도구(rules)를 부르지 않는다. 코드는 같은 꼴(code 칸)
const bad = (why: string) => Object.assign(new Error(`ZIP 파일을 읽을 수 없습니다: ${why}`), { code: "BAD_ZIP" });

// 끝 기록(EOCD)은 맨 뒤 22바이트에 주석(최대 65535)이 붙을 수 있다
function endRecord(buf: Buffer) {
  for (let at = buf.length - 22; at >= Math.max(0, buf.length - 22 - 0xffff); at--) {
    if (buf.readUInt32LE(at) === SIG.end) return at;
  }
  throw bad("ZIP 이 아닙니다");
}

// 폴더 밖을 가리키는 경로는 받지 않는다(풀어 쓰는 곳이 없어도 이름을 믿지 않는다)
function safeName(name: string) {
  return !name.startsWith("/") && !/^[a-zA-Z]:/.test(name) && !name.split("/").includes("..");
}

/** 목차의 한 줄 */
type Central = { name: string; flags: number; method: number; crc: number; packed: number; size: number; localAt: number };

/** 항목 하나를 읽는다. 폴더 항목이면 null */
function entryAt(buf: Buffer, at: number, budget: { left: number }): ZipEntry | null {
  const entry = centralAt(buf, at);
  if (entry.name.endsWith("/")) return null;
  if (entry.size > budget.left) throw bad("풀린 크기가 너무 큽니다");
  const data = bodyOf(buf, entry);
  budget.left -= entry.size;
  return { name: entry.name, data };
}

// 목차 한 줄을 읽고 받을 수 없는 꼴을 거른다
function centralAt(buf: Buffer, at: number): Central {
  if (buf.readUInt32LE(at) !== SIG.central) throw bad("목차가 깨졌습니다");
  const flags = buf.readUInt16LE(at + 8);
  const method = buf.readUInt16LE(at + 10);
  const crc = buf.readUInt32LE(at + 16);
  const packed = buf.readUInt32LE(at + 20);
  const size = buf.readUInt32LE(at + 24);
  // Windows PowerShell 5.1 의 Compress-Archive 는 경로를 \ 로 나눈다
  const name = buf.toString("utf8", at + 46, at + 46 + buf.readUInt16LE(at + 28)).replaceAll("\\", "/");
  const localAt = buf.readUInt32LE(at + 42);
  if (flags & ENCRYPTED) throw bad(`암호가 걸린 항목입니다(${name})`);
  if (packed === 0xffffffff || size === 0xffffffff || localAt === 0xffffffff) throw bad("ZIP64 는 받지 않습니다");
  if (!safeName(name)) throw bad(`받을 수 없는 경로입니다(${name})`);
  return { name, flags, method, crc, packed, size, localAt };
}

// 항목의 몸통을 풀고 크기 · CRC 를 맞춰 본다
function bodyOf(buf: Buffer, { name, method, crc, packed, size, localAt }: Central): Buffer {
  if (buf.readUInt32LE(localAt) !== SIG.local) throw bad(`항목이 깨졌습니다(${name})`);
  const start = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
  const body = buf.subarray(start, start + packed);
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

/** 푼다. maxEntries · maxBytes 를 넘으면 BAD_ZIP */
function unzip(buf: Buffer, { maxEntries = 64, maxBytes = 64 * 1024 * 1024 }: { maxEntries?: number; maxBytes?: number } = {}): ZipEntry[] {
  if (buf.length < 22) throw bad("ZIP 이 아닙니다");
  const end = endRecord(buf);
  const count = buf.readUInt16LE(end + 10);
  if (count > maxEntries) throw bad(`항목이 너무 많습니다(${count}개)`);
  let at = buf.readUInt32LE(end + 16);
  const budget = { left: maxBytes };
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    const entry = entryAt(buf, at, budget);
    if (entry) out.push(entry);
    at += 46 + buf.readUInt16LE(at + 28) + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return out;
}

export { zip, unzip };
export type { ZipEntry };
