"use strict";

// 대시보드 이모지 고르기 목록을 만든다. 손으로 실행한다. postinstall이나 빌드에 걸려 있지 않다.
//   node scripts/build-emoji-list.js
//
// 목록의 원본은 로컬 메모에 있다. 분류와 순서를 디스코드 선택기에서
// 그대로 옮겨 적은 파일이라, 고르는 사람이 디스코드에서 보던 자리에서 찾을 수 있다.
// 여기서는 거기에 두 가지를 붙인다.
//   · 단축명(:shushing_face:) → 이모지. 디스코드에서 복사하면 이 꼴로 붙는다.
//   · 한국어 이름·검색어. emojibase에서 가져온다.
//
// 그리고 Twemoji에 그림 파일이 실제로 있는지 대조한다. 없는 것을 목록에 넣으면 그 칸만 깨져 보인다.
// 실행에는 인터넷이 필요하다. 결과물은 저장소에 넣는다.

const fs = require("fs");
const path = require("path");

const EMOJIBASE = "17.0.0";
// 대시보드가 그림을 받아오는 곳과 같은 버전을 본다. 설치된 패키지에서 읽어 어긋날 일을 없앤다
const TWEMOJI = require("../dashboard/client/node_modules/@twemoji/api/package.json").version;
const GIST = "https://gist.githubusercontent.com/rigwild/1b509bf69e2a2391f44aa5de3f05b006/raw/discord_emojis.min.json";
const NOTES = path.join(__dirname, "..", "notes", "디스코드 이모지 카테고리 및 목록.md");
const OUT = path.join(__dirname, "..", "dashboard", "client", "src", "emojiList.js");

const json = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
};
const base = (file) => json(`https://cdn.jsdelivr.net/npm/emojibase-data@${EMOJIBASE}/${file}`);

// Twemoji 파일 이름 규칙. ZWJ가 없는 이모지에서만 VS16(FE0F)을 뗀다.
// 예외로 👁️‍🗨️처럼 ZWJ가 있는데도 전부 뗀 이름인 것이 있어 두 후보를 다 본다.
// TwemojiImage.vue도 같은 순서로 시도한다.
const toId = (s) => [...s].map((c) => c.codePointAt(0).toString(16)).join("-");
const iconIds = (char) => {
  const strict = toId(char.includes("‍") ? char : char.replace(/️/g, ""));
  const loose = toId(char.replace(/️/g, ""));
  return strict === loose ? [strict] : [strict, loose];
};

// 출처마다 VS16과 ZWJ를 붙이기도 빼기도 한다. 뺀 꼴을 열쇠로 삼아 짝을 찾는다.
// 특히 지스트는 ZWJ를 흘려서 :woman_police_officer:를 1F46E 2640(= 두 글자)으로 준다.
// emojibase 쪽 표기가 표준이므로 그쪽으로 바로잡는다. 이 열쇠로는 겹치는 항목이 없다.
const key = (s) => [...s].filter((c) => c !== "️" && c !== "‍").join("");

// 저장 검사와 같은 잣대. 고를 수는 있는데 저장이 안 되는 칸을 만들지 않는다
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

// Twemoji 저장소에 있는 svg 파일 이름들
async function readAssets() {
  const listing = await json(`https://data.jsdelivr.com/v1/packages/gh/jdecked/twemoji@${TWEMOJI}?structure=flat`);
  const ids = (listing.files || []).map((f) => f.name).filter((n) => n.startsWith("/assets/svg/"));
  if (!ids.length) throw new Error("Twemoji 파일 목록을 읽지 못했다");
  return new Set(ids.map((n) => n.slice("/assets/svg/".length, -".svg".length)));
}

async function main() {
  const notes = readNotes();

  // 단축명 → 이모지.
  // emojibase를 먼저 믿는다. 지스트는 이름이 바뀌기 전에 뜬 것이라 :beetle:을 🐞로,
  // :man_in_tuxedo:를 🤵로 준다(지금은 각각 🪲, 🤵‍♂️다). 지스트는 emojibase에 없는
  // 디스코드 고유 이름을 메우는 데만 쓴다.
  const [assets, gist, ko, ...sets] = await Promise.all([readAssets(), json(GIST), base("ko/compact.json"), ...["en/shortcodes/joypixels.json", "en/shortcodes/github.json", "en/shortcodes/emojibase.json", "en/shortcodes/emojibase-legacy.json", "en/shortcodes/cldr.json"].map(base)]);

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
  const dropped = [];
  const noAsset = [];

  for (const section of notes) {
    const rows = [];
    for (const code of section.codes) {
      const found = charOfCode.get(code);
      if (!found) {
        dropped.push(`${section.name}:${code} (대응 없음)`);
        continue;
      }

      const info = korean.get(key(found));
      // 표준 표기로 바로잡는다. emojibase는 ⌚처럼 이미 그림으로 보이는 글자에도 VS16을 붙여 주는데,
      // 그 꼴은 RGI가 아니라 저장 검사(/^\p{RGI_Emoji}$/v)가 거부한다. 고를 수는 있는데 저장은
      // 안 되는 칸이 생기므로, 통과하는 쪽을 골라 담는다.
      const standard = info?.unicode || found;
      const char = [standard, bare(standard)].find((c) => ONE_EMOJI.test(c));
      if (!char) {
        dropped.push(`${section.name}:${code} (RGI 아님)`);
        continue;
      }
      if (!iconIds(char).some((id) => assets.has(id))) noAsset.push(`${section.name}:${code} ${char}`);

      const label = clean(info?.label) || code.replace(/_/g, " ");
      const tags = clean([...new Set(info?.tags || [])].join(" "));
      // 단축명은 콜론째로 담는다. 디스코드에서 복사하면 ":thinking:" 꼴로 딸려오는데,
      // 부분 일치로 찾으므로 콜론이 있으면 "thinking"도 ":thinking:"도 걸린다.
      rows.push([char, label, `${tags} :${code}:`.trim()].join("|"));
    }
    groups.push([section.name, rows]);
  }

  const total = groups.reduce((sum, [, rows]) => sum + rows.length, 0);

  fs.writeFileSync(
    OUT,
    [
      "// 자동 생성물. 손으로 고치지 않는다. scripts/build-emoji-list.js를 고치고 다시 만든다.",
      "// 분류·순서는 디스코드 선택기 그대로.",
      `// 이름·검색어: emojibase-data@${EMOJIBASE} (MIT, ko) + 디스코드 단축명`,
      `// 그림: twemoji@${TWEMOJI}. 전부 실제로 있는 파일인지 대조했다`,
      "//",
      "// 한 분류를 한 줄짜리 문자열로 담는다. 항목마다 객체로 두면 파일이 몇 배로 불어난다.",
      "// 줄은 줄바꿈으로, 칸은 |로 나뉜다: 이모지|이름|검색어",
      `export const TWEMOJI_VERSION = ${JSON.stringify(TWEMOJI)};`,
      "",
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
  console.log(`총 ${total}개 · ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB · twemoji@${TWEMOJI}`);
  if (dropped.length) console.log(`뺀 것 ${dropped.length}개: ${dropped.slice(0, 6).join(" ")}${dropped.length > 6 ? " …" : ""}`);
  console.log(noAsset.length ? `그림 파일이 없는 것 ${noAsset.length}개: ${noAsset.slice(0, 8).join(" ")}` : "그림 파일은 전부 있음");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
