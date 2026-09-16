"use strict";

// 대시보드 이모지 고르기 목록을 만든다. **손으로 실행한다** — postinstall이나 빌드에 걸려 있지 않다.
//   node scripts/build-emoji-list.js
//
// 이름·분류는 emojibase(ko)에서, "그릴 수 있는가"는 대시보드가 쓰는 Twemoji 폰트에서 가져온다.
// 폰트에 없는 글자를 목록에 넣으면 그 칸만 두부로 보이므로 미리 걸러낸다.
// 실행에는 인터넷이 필요하다(emojibase를 내려받는다). 결과물은 저장소에 넣는다.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const EMOJIBASE = "17.0.0"; // 올릴 때는 이 값만 고친다
const OUT = path.join(__dirname, "..", "dashboard", "client", "src", "emojiList.js");
const FONT = path.join(__dirname, "..", "dashboard", "client", "node_modules", "twemoji-colr-font", "twemoji.woff2");

// woff2 표준 태그표 — 테이블 디렉터리가 이름 대신 이 번호를 쓴다
const KNOWN = "cmap head hhea hmtx maxp name OS/2 post cvt fpgm glyf loca prep CFF VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill".split(" ");

// 폰트에서 "이 글자를 그릴 수 있는가"에 필요한 것만 읽는다: 코드포인트→글리프(cmap)와 합자(GSUB).
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

  // 합자 — 국기나 ZWJ 조합은 여러 글리프가 하나로 합쳐진 것이다
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

  // VS16(FE0F)은 "그림으로 그려 달라"는 표시라 글리프가 있을 수도, 없을 수도 있다 — 양쪽으로 본다
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

async function get(file) {
  const url = `https://cdn.jsdelivr.net/npm/emojibase-data@${EMOJIBASE}/ko/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

// 구분자로 쓰는 글자가 값에 들어 있으면 줄이 깨진다
const clean = (s) =>
  String(s || "")
    .replace(/[|\n\r]+/g, " ")
    .trim();

async function main() {
  const drawable = readFont();
  const [compact, messages] = await Promise.all([get("compact.json"), get("messages.json")]);
  const groupName = new Map(messages.groups.map((g) => [Number(g.order ?? g.key), g.message]));

  const ONE_EMOJI = /^\p{RGI_Emoji}$/v;
  const groups = new Map();
  let skipped = 0;

  for (const e of [...compact].sort((a, b) => a.order - b.order)) {
    // 2 = 구성 요소(피부색 조절자 등). 그 자체로 고를 것이 아니다.
    if (e.group == null || e.group === 2) continue;
    if (!e.unicode || !ONE_EMOJI.test(e.unicode) || !drawable(e.unicode)) {
      skipped++;
      continue;
    }
    const name = groupName.get(e.group) ?? `그룹 ${e.group}`;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push([e.unicode, clean(e.label), clean([...new Set(e.tags || [])].join(" "))].join("|"));
  }

  const body = [...groups].map(([name, rows]) => `  [${JSON.stringify(name)}, ${JSON.stringify(rows.join("\n"))}],`).join("\n");
  const total = [...groups.values()].reduce((sum, rows) => sum + rows.length, 0);

  fs.writeFileSync(
    OUT,
    [
      "// 자동 생성물 — 손으로 고치지 않는다. scripts/build-emoji-list.js를 고치고 다시 만든다.",
      `// 이름·분류: emojibase-data@${EMOJIBASE} (MIT, ko) / 그릴 수 있는지: twemoji-colr-font`,
      "//",
      "// 한 그룹을 한 줄짜리 문자열로 담는다 — 항목마다 객체로 두면 파일이 몇 배로 불어난다.",
      "// 줄은 줄바꿈으로, 칸은 |로 나뉜다: 이모지|이름|검색어",
      "const RAW = [",
      body,
      "];",
      "",
      "export const EMOJI_GROUPS = RAW.map(([name, rows]) => ({",
      "  name,",
      '  emoji: rows.split("\\n").map((row) => {',
      '    const [char, label, tags] = row.split("|");',
      "    return { char, label, search: `${label} ${tags} ${char}`.toLowerCase() };",
      "  }),",
      "}));",
      "",
    ].join("\n"),
  );

  console.log([...groups].map(([n, r]) => `${n}(${r.length})`).join(" "));
  console.log(`총 ${total}개 · 폰트에 없어 제외 ${skipped}개 · ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
  console.log(`→ ${path.relative(process.cwd(), OUT)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
