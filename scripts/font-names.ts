// 글꼴(TrueType · OpenType 한 개, sfnt)의 name 표를 고친다. 글꼴을 만드는 스크립트(build-*-font)가 조각내기 전에 원본에 한 번 부른다.
// 바꾸는 번호의 기록은 모든 플랫폼 · 언어에서 지우고 Windows 영어(3 · 1 · 0x409) 하나로 다시 쓴다. 빈 글은 그 번호를 지운다.
// 다른 표는 그대로 옮기고 표 · 글꼴 체크섬을 다시 셈한다. 전자 서명(DSIG)은 고치면 맞지 않으므로 뺀다

import { decompress } from "wawoff2";

/** OFL 이 권하는 라이선스 설명(13번) · 주소(14번). 조각마다 라이선스가 따라가게 넣는다(OFL FAQ 2.4) */
const OFL_NAMES: Record<number, string> = {
  13: "This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is available with a FAQ at: https://openfontlicense.org",
  14: "https://openfontlicense.org",
};
/** subset-font(harfbuzz)는 0 ~ 6번만 남기므로 라이선스 칸은 따로 넘긴다(preserveNameIds) */
const LICENSE_NAME_IDS = [13, 14];

const WINDOWS = { platform: 3, encoding: 1, language: 0x409 };

type NameRecord = { platform: number; encoding: number; language: number; id: number; bytes: Buffer };

/** woff2 면 풀어서 sfnt 로, 아니면 그대로 */
async function toSfnt(font: Buffer): Promise<Buffer> {
  return font.subarray(0, 4).toString("latin1") === "wOF2" ? Buffer.from(await decompress(font)) : font;
}

/** 4바이트씩 더한 체크섬(끝은 0 으로 채운 것으로 본다) */
function checksum(data: Buffer): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const word = data.length - i >= 4 ? data.readUInt32BE(i) : Buffer.concat([data.subarray(i), Buffer.alloc(4 - (data.length - i))]).readUInt32BE(0);
    sum = (sum + word) >>> 0;
  }
  return sum;
}

function readNames(table: Buffer): NameRecord[] {
  const count = table.readUInt16BE(2);
  const storage = table.readUInt16BE(4);
  const records: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    const language = table.readUInt16BE(at + 4);
    // format 1 의 언어 태그 기록(0x8000 부터)은 옮기지 않는다(format 0 으로 다시 쓴다)
    if (language >= 0x8000) continue;
    const length = table.readUInt16BE(at + 8);
    const offset = storage + table.readUInt16BE(at + 10);
    records.push({ platform: table.readUInt16BE(at), encoding: table.readUInt16BE(at + 2), language, id: table.readUInt16BE(at + 6), bytes: table.subarray(offset, offset + length) });
  }
  return records;
}

function writeNames(records: NameRecord[]): Buffer {
  const sorted = [...records].sort((a, b) => a.platform - b.platform || a.encoding - b.encoding || a.language - b.language || a.id - b.id);
  const head = Buffer.alloc(6 + sorted.length * 12);
  head.writeUInt16BE(0, 0);
  head.writeUInt16BE(sorted.length, 2);
  head.writeUInt16BE(head.length, 4);
  let offset = 0;
  for (const [i, r] of sorted.entries()) {
    const at = 6 + i * 12;
    for (const [k, v] of [r.platform, r.encoding, r.language, r.id, r.bytes.length, offset].entries()) head.writeUInt16BE(v, at + k * 2);
    offset += r.bytes.length;
  }
  return Buffer.concat([head, ...sorted.map((r) => r.bytes)]);
}

/** UTF-16BE(Windows 플랫폼의 글) */
const utf16be = (text: string) => Buffer.from(text, "utf16le").swap16();

/** name 표의 번호마다 글을 바꾼 새 글꼴. 빈 글("")은 그 번호를 지운다 */
function setNames(font: Buffer, names: Record<number, string>): Buffer {
  const tag = font.subarray(0, 4).toString("latin1");
  if (tag === "ttcf" || tag === "wOFF" || tag === "wOF2") throw new Error(`글꼴 하나(sfnt)여야 합니다: ${tag}`);
  const count = font.readUInt16BE(4);
  const tables = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const offset = font.readUInt32BE(at + 8);
    tables.set(font.subarray(at, at + 4).toString("latin1"), font.subarray(offset, offset + font.readUInt32BE(at + 12)));
  }
  const name = tables.get("name");
  if (!name) throw new Error("name 표가 없습니다");
  const changed = new Set(Object.keys(names).map(Number));
  const kept = readNames(name).filter((r) => !changed.has(r.id));
  const added = Object.entries(names)
    .filter(([, text]) => text)
    .map(([id, text]) => ({ ...WINDOWS, id: Number(id), bytes: utf16be(text) }));
  tables.set("name", writeNames([...kept, ...added]));
  tables.delete("DSIG");
  return assemble(font.readUInt32BE(0), tables);
}

/** 표들로 글꼴을 다시 짓는다(표 이름 순서, 4바이트 정렬, head 의 checkSumAdjustment 다시 셈) */
function assemble(version: number, tables: Map<string, Buffer>): Buffer {
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  const power = 2 ** Math.floor(Math.log2(n));
  const header = Buffer.alloc(12 + n * 16);
  header.writeUInt32BE(version, 0);
  header.writeUInt16BE(n, 4);
  header.writeUInt16BE(power * 16, 6);
  header.writeUInt16BE(Math.log2(power), 8);
  header.writeUInt16BE(n * 16 - power * 16, 10);
  const bodies: Buffer[] = [];
  let offset = header.length;
  let headAt = -1;
  for (const [i, t] of tags.entries()) {
    const data = Buffer.from(tables.get(t)!);
    // head 의 체크섬은 checkSumAdjustment 를 0 으로 두고 셈한다
    if (t === "head") {
      data.writeUInt32BE(0, 8);
      headAt = offset;
    }
    const at = 12 + i * 16;
    header.write(t, at, "latin1");
    header.writeUInt32BE(checksum(data), at + 4);
    header.writeUInt32BE(offset, at + 8);
    header.writeUInt32BE(data.length, at + 12);
    const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
    bodies.push(padded);
    offset += padded.length;
  }
  const font = Buffer.concat([header, ...bodies]);
  if (headAt >= 0) font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headAt + 8);
  return font;
}

export { setNames, toSfnt, OFL_NAMES, LICENSE_NAME_IDS };
