"use strict";

// 대시보드 이모지 고르기 목록을 만든다. **손으로 실행한다** — postinstall이나 빌드에 걸려 있지 않다.
//   node scripts/build-emoji-list.js
//
// 목록의 원본은 notes/디스코드 이모지 카테고리 및 목록.md 다. 분류와 순서를 디스코드 선택기에서
// 그대로 옮겨 적은 파일이라, 고르는 사람이 디스코드에서 보던 자리에서 찾을 수 있다.
// 여기서는 거기에 두 가지를 붙인다.
//   · 단축명(:shushing_face:) → 이모지. 디스코드에서 복사하면 이 꼴로 붙는다.
//   · 한국어 이름·검색어. emojibase에서 가져온다.
//
// 실행에는 인터넷이 필요하다(대응표를 내려받는다). 결과물은 저장소에 넣는다.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const EMOJIBASE = "17.0.0";
const GIST = "https://gist.githubusercontent.com/rigwild/1b509bf69e2a2391f44aa5de3f05b006/raw/discord_emojis.min.json";
const NOTES = path.join(__dirname, "..", "notes", "디스코드 이모지 카테고리 및 목록.md");
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

const json = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
};
const base = (file) => json(`https://cdn.jsdelivr.net/npm/emojibase-data@${EMOJIBASE}/${file}`);

// 출처마다 VS16(FE0F)과 ZWJ(200D)를 붙이기도 빼기도 한다 — 뺀 꼴을 열쇠로 삼아 짝을 찾는다.
// 특히 지스트는 ZWJ를 흘려서 :woman_police_officer:를 1F46E 2640(= 두 글자)으로 준다.
// emojibase 쪽 표기가 표준이므로 그쪽으로 바로잡는다. 이 열쇠로는 겹치는 항목이 없다.
const key = (s) => [...s].filter((c) => c !== "️" && c !== "‍").join("");

// 저장 검사와 같은 잣대 — 고를 수는 있는데 저장이 안 되는 칸을 만들지 않는다
const ONE_EMOJI = /^\p{RGI_Emoji}$/v;
// 군더더기 VS16만 뗀다(ZWJ는 두어야 조합이 유지된다)
const bare = (s) => [...s].filter((c) => c !== "️").join("");
// 구분자로 쓰는 글자가 값에 들어 있으면 줄이 깨진다
const clean = (s) =>
  String(s || "")
    .replace(/[|\n\r]+/g, " ")
    .trim();

function readNotes() {
  return fs
    .readFileSync(NOTES, "utf8")
    .split(/^# /m)
    .slice(1)
    .filter((section) => !section.startsWith("비고"))
    .map((section) => ({
      name: section.split("\n")[0].trim(),
      codes: (section.match(/:([a-z0-9_+-]+):/g) || []).map((c) => c.slice(1, -1)),
    }));
}

async function main() {
  const drawable = readFont();
  const notes = readNotes();

  // 단축명 → 이모지.
  // emojibase를 먼저 믿는다 — 지스트는 이름이 바뀌기 전에 뜬 것이라 :beetle:을 🐞로,
  // :man_in_tuxedo:를 🤵로 준다(지금은 각각 🪲, 🤵‍♂️다). 지스트는 emojibase에 없는
  // 디스코드 고유 이름을 메우는 데만 쓴다.
  const [gist, ko, ...sets] = await Promise.all([json(GIST), base("ko/compact.json"), ...["en/shortcodes/joypixels.json", "en/shortcodes/github.json", "en/shortcodes/emojibase.json", "en/shortcodes/emojibase-legacy.json", "en/shortcodes/cldr.json"].map(base)]);

  const charOfHex = new Map(ko.map((e) => [e.hexcode, e.unicode]));
  const charOfCode = new Map();
  for (const set of sets) {
    for (const [hex, codes] of Object.entries(set)) {
      const char = charOfHex.get(hex);
      if (!char) continue;
      for (const code of [].concat(codes)) {
        const name = String(code).replace(/:/g, "");
        if (!charOfCode.has(name)) charOfCode.set(name, char);
      }
    }
  }
  for (const [code, char] of Object.entries(gist)) {
    const name = code.replace(/:/g, "");
    if (!charOfCode.has(name)) charOfCode.set(name, char);
  }

  const korean = new Map(ko.map((e) => [key(e.unicode), e]));

  const groups = [];
  const unresolved = [];
  const tofu = [];

  for (const section of notes) {
    const rows = [];
    for (const code of section.codes) {
      const found = charOfCode.get(code);
      if (!found) {
        unresolved.push(`${section.name}:${code}`);
        continue;
      }

      const info = korean.get(key(found));
      // 표준 표기로 바로잡는다. emojibase는 ⌚처럼 이미 그림으로 보이는 글자에도 VS16을 붙여 주는데,
      // 그 꼴은 RGI가 아니라 저장 검사(/^\p{RGI_Emoji}$/v)가 거부한다 — 고를 수는 있는데 저장은
      // 안 되는 칸이 생기므로, 통과하는 쪽을 골라 담는다.
      const standard = info?.unicode || found;
      const char = [standard, bare(standard)].find((c) => ONE_EMOJI.test(c));
      if (!char) {
        unresolved.push(`${section.name}:${code} (RGI 아님)`);
        continue;
      }
      if (!drawable(char)) tofu.push(`${section.name}:${code} ${char}`);

      const label = clean(info?.label) || code.replace(/_/g, " ");
      const tags = clean([...new Set(info?.tags || [])].join(" "));
      rows.push([char, label, `${tags} ${code}`.trim()].join("|"));
    }
    groups.push([section.name, rows]);
  }

  const total = groups.reduce((sum, [, rows]) => sum + rows.length, 0);

  fs.writeFileSync(
    OUT,
    [
      "// 자동 생성물 — 손으로 고치지 않는다. scripts/build-emoji-list.js를 고치고 다시 만든다.",
      "// 분류·순서: notes/디스코드 이모지 카테고리 및 목록.md (디스코드 선택기 그대로)",
      `// 이름·검색어: emojibase-data@${EMOJIBASE} (MIT, ko) + 디스코드 단축명`,
      "//",
      "// 한 분류를 한 줄짜리 문자열로 담는다 — 항목마다 객체로 두면 파일이 몇 배로 불어난다.",
      "// 줄은 줄바꿈으로, 칸은 |로 나뉜다: 이모지|이름|검색어",
      "const RAW = [",
      groups.map(([name, rows]) => `  [${JSON.stringify(name)}, ${JSON.stringify(rows.join("\n"))}],`).join("\n"),
      "];",
      "",
      "export const EMOJI_GROUPS = RAW.map(([name, rows]) => ({",
      "  name,",
      '  emoji: rows.split("\\n").map((row) => {',
      '    const [char, label, tags] = row.split("|");',
      "    return { char, label, search: `${label} ${tags}`.toLowerCase() };",
      "  }),",
      "}));",
      "",
    ].join("\n"),
  );

  console.log(groups.map(([n, r]) => `${n}(${r.length})`).join(" "));
  console.log(`총 ${total}개 · ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
  if (unresolved.length) console.log(`대응 안 된 단축명 ${unresolved.length}개: ${unresolved.slice(0, 10).join(" ")}`);
  console.log(`폰트가 못 그리는 것 ${tofu.length}개${tofu.length ? ": " + tofu.slice(0, 8).join(" ") : ""}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
