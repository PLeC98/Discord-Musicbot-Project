// 앱 이모지 그림 글꼴. 대시보드 입력란이 앱 이모지를 진짜 글자로 다루게(안드로이드는 글자가 아닌 인라인 요소를 선택하지 못한다),
// 이모지마다 보조 사용자 정의 영역 문자 하나를 그 그림(PNG)으로 그리는 글꼴을 만든다. 의존성 없이 표를 직접 쓴다.
// 형식은 엔진마다 그리는 것이 달라 두 벌이다: sbix(크롬, 엣지, 안드로이드, 사파리), SVG(파이어폭스. PNG 를 data 주소로 담는다).
// 한 글꼴에 둘 다 넣으면 사파리가 SVG 를 먼저 써서 그리지 못한다(notes 조사 기록 8.3). 화면은 font-tech 로 고른다(style.css).
// 글꼴 단위: 1em = 1024, 이모지는 1em 정사각형, 바닥이 기준선 0.1em 아래(Twemoji 글꼴과 같은 자리)

const UPEM = 1024;
const ASCENT = 922;
const DESCENT = -102;

type EmojiFontFormat = "sbix" | "svg";
/** 문자 하나와 그 그림. png 는 size × size */
type EmojiGlyph = { codepoint: number; png: Buffer };

const u16 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(v & 0xffff);
  return b;
};
const i16 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(v);
  return b;
};
const u32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v >>> 0);
  return b;
};
const pad4 = (b: Buffer) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);

function checksum(data: Buffer): number {
  const padded = pad4(data);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

/** 표들을 글꼴 파일(sfnt) 하나로. 표는 이름 순, 4바이트 경계, head 의 checkSumAdjustment 를 채운다 */
function sfnt(tables: Record<string, Buffer>): Buffer {
  const tags = Object.keys(tables).sort();
  const selector = Math.floor(Math.log2(tags.length));
  const range = 2 ** selector * 16;
  let offset = 12 + 16 * tags.length;
  let headAt = 0;
  const records: Buffer[] = [];
  const bodies: Buffer[] = [];
  for (const tag of tags) {
    const body = pad4(tables[tag]);
    if (tag === "head") headAt = offset;
    records.push(Buffer.concat([Buffer.from(tag.padEnd(4), "latin1"), u32(checksum(tables[tag])), u32(offset), u32(tables[tag].length)]));
    bodies.push(body);
    offset += body.length;
  }
  const font = Buffer.concat([u32(0x00010000), u16(tags.length), u16(range), u16(selector), u16(tags.length * 16 - range), ...records, ...bodies]);
  font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headAt + 8);
  return font;
}

function nameTable(family: string): Buffer {
  const ids: Array<[number, string]> = [
    [1, family],
    [2, "Regular"],
    [3, `${family} Regular`],
    [4, family],
    [5, "Version 1.0"],
    [6, family.replace(/ /g, "")],
  ];
  const strings = ids.map(([, text]) => Buffer.from(text, "utf16le").swap16());
  let at = 0;
  const records = ids.map(([id], i) => {
    const record = Buffer.concat([u16(3), u16(1), u16(0x409), u16(id), u16(strings[i].length), u16(at)]);
    at += strings[i].length;
    return record;
  });
  return Buffer.concat([u16(0), u16(ids.length), u16(6 + ids.length * 12), ...records, ...strings]);
}

/** 문자 → 글리프. 형식 4(BMP, 빈 것)와 형식 12, 유니코드(0)와 윈도우(3) 플랫폼 모두(애플 글꼴 엔진은 플랫폼 0 을 먼저 읽는다) */
function cmapTable(codepoints: number[]): Buffer {
  const format4 = Buffer.concat([u16(4), u16(24), u16(0), u16(2), u16(2), u16(0), u16(0), u16(0xffff), u16(0), u16(0xffff), i16(1), u16(0)]);
  const groups = codepoints.map((cp, i) => Buffer.concat([u32(cp), u32(cp), u32(i + 1)]));
  const format12 = Buffer.concat([u16(12), u16(0), u32(16 + groups.length * 12), u32(0), u32(groups.length), ...groups]);
  const subtables: Array<[number, number, boolean]> = [
    [0, 3, false],
    [0, 4, true],
    [3, 1, false],
    [3, 10, true],
  ];
  const base = 4 + subtables.length * 8;
  return Buffer.concat([u16(0), u16(subtables.length), ...subtables.map(([platform, encoding, wide]) => Buffer.concat([u16(platform), u16(encoding), u32(wide ? base + format4.length : base)])), format4, format12]);
}

/** sbix: 한 단계(ppem = PNG 한 변). 원점은 아래로 descender 만큼 */
function sbixTable(glyphs: EmojiGlyph[], size: number): Buffer {
  const originY = Math.round((DESCENT * size) / UPEM);
  const data = [Buffer.alloc(0), ...glyphs.map((g) => Buffer.concat([i16(0), i16(originY), Buffer.from("png ", "latin1"), g.png]))];
  const offsets: number[] = [];
  let at = 4 + 4 * (data.length + 1);
  for (const one of data) {
    offsets.push(at);
    at += one.length;
  }
  offsets.push(at);
  const strike = Buffer.concat([u16(size), u16(72), ...offsets.map(u32), ...data]);
  return Buffer.concat([u16(1), u16(1), u32(1), u32(12), strike]);
}

/** SVG: 글리프마다 문서 하나. PNG 를 글꼴 단위로 키우고 위로 ascender 만큼(SVG 는 y 가 아래로 자란다) */
function svgTable(glyphs: EmojiGlyph[], size: number): Buffer {
  const scale = UPEM / size;
  const docs = glyphs.map((g, i) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><g id="glyph${i + 1}" transform="matrix(${scale} 0 0 ${scale} 0 ${-ASCENT})"><image width="${size}" height="${size}" xlink:href="data:image/png;base64,${g.png.toString("base64")}"/></g></svg>`));
  let at = 2 + docs.length * 12;
  const entries = docs.map((doc, i) => {
    const entry = Buffer.concat([u16(i + 1), u16(i + 1), u32(at), u32(doc.length)]);
    at += doc.length;
    return entry;
  });
  return Buffer.concat([u16(0), u32(10), u32(0), u16(docs.length), ...entries, ...docs]);
}

/** 그림 글꼴 하나. glyphs 의 PNG 는 모두 size × size 여야 한다 */
function buildEmojiFont(family: string, glyphs: readonly EmojiGlyph[], size: number, format: EmojiFontFormat): Buffer {
  const list = [...glyphs].sort((a, b) => a.codepoint - b.codepoint);
  const count = list.length + 1; // 0 = .notdef
  const head = Buffer.concat([u32(0x00010000), u32(0x00010000), u32(0), u32(0x5f0f3cf5), u16(0b1011), u16(UPEM), Buffer.alloc(16), i16(0), i16(DESCENT), i16(UPEM), i16(ASCENT), u16(0), u16(8), i16(2), i16(0), i16(0)]);
  const hhea = Buffer.concat([u32(0x00010000), i16(ASCENT), i16(DESCENT), i16(0), u16(UPEM), i16(0), i16(0), i16(UPEM), i16(1), i16(0), i16(0), Buffer.alloc(8), i16(0), u16(count)]);
  const maxp = Buffer.concat([u32(0x00010000), u16(count), u16(4), u16(1), u16(0), u16(0), u16(2), ...Array.from({ length: 8 }, () => u16(0))]);
  const os2 = Buffer.concat([...[u16(4), i16(UPEM), u16(400), u16(5), u16(0)], ...[i16(0), i16(0), i16(0), i16(0), i16(0), i16(0), i16(0), i16(0), i16(50), i16(300), i16(0)], ...[Buffer.alloc(10), u32(0), u32(0), u32(0), u32(0), Buffer.from("NONE", "latin1"), u16(0x40), u16(0xffff), u16(0xffff)], ...[i16(ASCENT), i16(DESCENT), i16(0), u16(ASCENT), u16(-DESCENT), u32(1), u32(0), i16(0), i16(0), u16(0), u16(0x20), u16(0)]]);
  const hmtx = Buffer.concat(Array.from({ length: count }, () => Buffer.concat([u16(UPEM), i16(0)])));
  // .notdef 는 상자 하나(빈 glyf 표를 거절하는 검사기가 있다), 나머지 글리프는 윤곽이 없다
  const glyf = Buffer.concat([i16(1), i16(100), i16(0), i16(600), i16(700), u16(3), u16(0), Buffer.from([1, 1, 1, 1]), i16(100), i16(0), i16(500), i16(0), i16(0), i16(700), i16(0), i16(-700)]);
  const loca = Buffer.concat([u16(0), ...Array.from({ length: count }, () => u16(glyf.length / 2))]);
  const post = Buffer.concat([u32(0x00030000), u32(0), i16(-100), i16(50), u32(0), u32(0), u32(0), u32(0), u32(0)]);
  const color: Record<string, Buffer> = format === "sbix" ? { sbix: sbixTable(list, size) } : { "SVG ": svgTable(list, size) };
  return sfnt({ head, hhea, maxp, "OS/2": os2, hmtx, cmap: cmapTable(list.map((g) => g.codepoint)), loca, glyf, name: nameTable(family), post, ...color });
}

export { buildEmojiFont, UPEM, ASCENT, DESCENT };
export type { EmojiFontFormat, EmojiGlyph };
