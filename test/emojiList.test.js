"use strict";

// 고를 수 있는데 안 보이는 칸이 생기지 않게 한다.
//
// 대시보드는 이모지를 OS 폰트가 아니라 Twemoji 웹폰트로 그린다(Windows에 국기 글리프가 없어서다).
// 목록에 폰트가 모르는 글자를 넣으면 그 칸만 두부처럼 보이는데, 화면을 열어 보기 전에는 모른다.
// 폰트를 올릴 때 이 테스트가 먼저 걸린다.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const FONT = path.join(__dirname, "..", "dashboard", "client", "node_modules", "twemoji-colr-font", "twemoji.woff2");
const LIST = path.join(__dirname, "..", "dashboard", "client", "src", "emojiList.js");

// woff2 표준 태그표 — 테이블 디렉터리가 이름 대신 이 번호를 쓴다
const KNOWN = "cmap head hhea hmtx maxp name OS/2 post cvt fpgm glyf loca prep CFF VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill".split(" ");

// 폰트에서 "이 글자를 그릴 수 있는가"에 필요한 것만 읽는다: 코드포인트→글리프(cmap)와 두 글자 합자(GSUB).
function readFont() {
  const buf = fs.readFileSync(FONT);
  let p = 48; // woff2 헤더는 고정 48바이트
  const base128 = () => {
    let v = 0;
    for (;;) {
      const b = buf[p++];
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v >>> 0;
    }
  };

  const tables = [];
  for (let i = 0, n = buf.readUInt16BE(12); i < n; i++) {
    const flags = buf[p++];
    const idx = flags & 0x3f;
    const tag = idx === 63 ? buf.toString("ascii", (p += 4) - 4, p) : KNOWN[idx];
    const origLength = base128();
    // null transform은 glyf·loca만 3이고 나머지는 0이다 — 변환된 것만 길이가 하나 더 붙는다
    const version = flags >> 6;
    const transformed = idx === 10 || idx === 11 ? version !== 3 : version !== 0;
    tables.push({ tag, length: transformed ? base128() : origLength });
  }

  const font = zlib.brotliDecompressSync(buf.subarray(p));
  let off = 0;
  for (const t of tables) {
    t.offset = off;
    off += t.length;
  }

  // cmap format 12 — BMP 밖의 이모지까지 담는 형식
  const cmapTable = tables.find((t) => t.tag === "cmap");
  const cmap = new Map();
  for (let i = 0, n = font.readUInt16BE(cmapTable.offset + 2); i < n; i++) {
    const sub = cmapTable.offset + font.readUInt32BE(cmapTable.offset + 4 + i * 8 + 4);
    if (font.readUInt16BE(sub) !== 12) continue;
    for (let g = 0, ng = font.readUInt32BE(sub + 12); g < ng; g++) {
      const r = sub + 16 + g * 12;
      const start = font.readUInt32BE(r);
      const end = font.readUInt32BE(r + 4);
      const gid = font.readUInt32BE(r + 8);
      for (let c = start; c <= end; c++) cmap.set(c, gid + (c - start));
    }
  }

  // GSUB 합자 — 국기는 regional indicator 두 글자가 한 글리프로 합쳐진 것이다
  const pairs = new Set();
  const gsub = tables.find((t) => t.tag === "GSUB");
  const lookupList = gsub.offset + font.readUInt16BE(gsub.offset + 8);
  for (let i = 0, n = font.readUInt16BE(lookupList); i < n; i++) {
    const lk = lookupList + font.readUInt16BE(lookupList + 2 + i * 2);
    if (font.readUInt16BE(lk) !== 4) continue; // type 4 = 합자
    for (let s = 0, ns = font.readUInt16BE(lk + 4); s < ns; s++) {
      const st = lk + font.readUInt16BE(lk + 6 + s * 2);
      const cov = st + font.readUInt16BE(st + 2);
      const first = [];
      if (font.readUInt16BE(cov) === 1) {
        for (let c = 0, nc = font.readUInt16BE(cov + 2); c < nc; c++) first[c] = font.readUInt16BE(cov + 4 + c * 2);
      } else {
        for (let c = 0, nc = font.readUInt16BE(cov + 2); c < nc; c++) {
          const r = cov + 4 + c * 6;
          const a = font.readUInt16BE(r);
          const b = font.readUInt16BE(r + 2);
          const at = font.readUInt16BE(r + 4);
          for (let g = a; g <= b; g++) first[at + (g - a)] = g;
        }
      }
      for (let g = 0, ng = font.readUInt16BE(st + 4); g < ng; g++) {
        const set = st + font.readUInt16BE(st + 6 + g * 2);
        for (let l = 0, nl = font.readUInt16BE(set); l < nl; l++) {
          const lig = set + font.readUInt16BE(set + 2 + l * 2);
          if (font.readUInt16BE(lig + 2) === 2) pairs.add(`${first[g]},${font.readUInt16BE(lig + 4)}`);
        }
      }
    }
  }

  return { cmap, hasLigature: (a, b) => pairs.has(`${a},${b}`) };
}

const groups = () => import("file://" + LIST.replace(/\\/g, "/")).then((m) => m.EMOJI_GROUPS);
const all = async () => (await groups()).flatMap((g) => g.emoji.map((e) => [g.name, e]));

test("고르기 목록의 이모지는 전부 폰트에 있다", async () => {
  const { cmap, hasLigature } = readFont();
  const missing = [];

  for (const [group, emoji] of await all()) {
    // 변이 선택자(VS16)는 글리프가 아니라 "그림으로 그려 달라"는 표시다 — 폰트에서 찾을 것이 없다
    const cps = [...emoji].map((c) => c.codePointAt(0)).filter((c) => c !== 0xfe0f);
    const isFlag = cps.length === 2 && cps.every((c) => c >= 0x1f1e6 && c <= 0x1f1ff);

    const drawable = isFlag ? hasLigature(cmap.get(cps[0]), cmap.get(cps[1])) : cps.length === 1 && cmap.has(cps[0]);
    if (!drawable) missing.push(`${group} ${emoji}`);
  }

  assert.deepEqual(missing, [], "폰트에 없는 이모지는 두부로 보인다");
});

test("고르기 목록은 이모지 한 글자씩만 담는다", async () => {
  // 선택 메뉴가 거부하는 값을 고를 수 있게 두면 안 된다 — 저장 검사와 같은 잣대를 쓴다.
  const one = /^\p{RGI_Emoji}$/v;
  const bad = (await all()).filter(([, emoji]) => !one.test(emoji)).map(([group, emoji]) => `${group} ${emoji}`);
  assert.deepEqual(bad, []);
});

test("고르기 목록에 같은 이모지가 두 번 나오지 않는다", async () => {
  const seen = new Map();
  const dupes = [];
  for (const [group, emoji] of await all()) {
    if (seen.has(emoji)) dupes.push(`${emoji} — ${seen.get(emoji)}, ${group}`);
    else seen.set(emoji, group);
  }
  assert.deepEqual(dupes, []);
});
