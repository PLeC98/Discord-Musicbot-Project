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

  // GSUB 합자 — 국기(regional indicator 두 글자)나 ZWJ 조합이 한 글리프로 합쳐진 것이다
  const ligatures = new Set();
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
          const count = font.readUInt16BE(lig + 2);
          const seq = [first[g]];
          for (let c = 0; c < count - 1; c++) seq.push(font.readUInt16BE(lig + 4 + c * 2));
          ligatures.add(seq.join(","));
        }
      }
    }
  }

  // VS16(FE0F)은 글리프가 아니라 "그림으로 그려 달라"는 표시다 — 있는 쪽·없는 쪽 모두 본다
  return (str) => {
    const cps = [...str].map((c) => c.codePointAt(0));
    for (const attempt of [cps, cps.filter((c) => c !== 0xfe0f)]) {
      const gids = attempt.map((c) => cmap.get(c));
      if (gids.some((g) => g == null)) continue;
      if (gids.length === 1 || ligatures.has(gids.join(","))) return true;
    }
    return false;
  };
}

const groups = () => import("file://" + LIST.replace(/\\/g, "/")).then((m) => m.EMOJI_GROUPS);
const all = async () => (await groups()).flatMap((g) => g.emoji.map((e) => [g.name, e.char, e]));

test("폰트가 못 그리는 것이 얼마나 되는지 못박는다", async () => {
  // 목록은 디스코드 선택기를 그대로 옮긴 것이라, 고르면 디스코드에서는 제대로 보인다.
  // 다만 우리 폰트는 Twemoji 15.0에서 멈춰 있어 그 뒤에 늘어난 것은 대시보드에서만 두부로 보인다.
  // 폰트를 올리면 이 수가 줄어든다 — 줄어든 것을 알아채라고 세어 둔다.
  const drawable = readFont();
  const missing = (await all()).filter(([, char]) => !drawable(char));
  assert.equal(missing.length, 36, `폰트가 못 그리는 것: ${missing.map(([, c]) => c).join(" ")}`);
});

test("고르기 목록은 이모지 한 글자씩만 담는다", async () => {
  // 선택 메뉴가 거부하는 값을 고를 수 있게 두면 안 된다 — 저장 검사와 같은 잣대를 쓴다.
  const one = /^\p{RGI_Emoji}$/v;
  const bad = (await all()).filter(([, char]) => !one.test(char)).map(([group, char]) => `${group} ${char}`);
  assert.deepEqual(bad, []);
});

test("고르기 목록에 같은 이모지가 두 번 나오지 않는다", async () => {
  const seen = new Map();
  const dupes = [];
  for (const [group, char] of await all()) {
    if (seen.has(char)) dupes.push(`${char} — ${seen.get(char)}, ${group}`);
    else seen.set(char, group);
  }
  assert.deepEqual(dupes, []);
});

test("항목마다 이름과 검색어가 있다", async () => {
  // 이름은 툴팁으로 보이고 검색어는 찾기에 쓰인다 — 비면 그 칸은 찾을 수도, 뭔지 알 수도 없다.
  const bad = (await all()).filter(([, , e]) => !e.label?.trim() || !e.search?.trim()).map(([group, char]) => `${group} ${char}`);
  assert.deepEqual(bad, []);
});

test("분류는 디스코드 한국어 선택기 그대로다", async () => {
  // 고르는 사람이 디스코드에서 보던 자리에서 찾을 수 있어야 한다.
  assert.deepEqual(
    (await groups()).map((g) => g.name),
    ["사람", "자연", "음식", "활동", "여행", "사물", "기호", "국기"],
  );
});

test("디스코드에서 복사한 이름으로 찾을 수 있다", async () => {
  // 디스코드에서 이모지를 복사하면 ":shushing_face:" 꼴로 붙는다 — 그대로 쳐도 찾아져야 한다.
  const all = (await groups()).flatMap((g) => g.emoji);
  const find = (q) => all.find((e) => e.search.includes(q))?.char;

  assert.equal(find("shushing_face"), "🤫");
  assert.equal(find("flag_kr"), "🇰🇷");
  assert.equal(find("guitar"), "🎸");
  assert.equal(find("기타"), "🎸", "한국어 이름으로도 찾아진다");
});
