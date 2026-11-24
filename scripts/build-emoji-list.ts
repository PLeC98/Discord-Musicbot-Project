// 대시보드 이모지 선택 목록을 만든다. 손으로 실행한다. postinstall이나 빌드에 걸려 있지 않다.
//   node scripts/build-emoji-list.ts
//
// 목록의 원본은 scripts/data/discord-emoji-picker.md다. 분류와 순서를 디스코드 선택기에서
// 그대로 옮겨 적은 파일이라, 선택하는 사람이 디스코드에서 보던 위치에서 찾을 수 있다.
// 여기서는 거기에 두 가지를 붙인다.
// - 단축명(:shushing_face:) → 이모지. 디스코드에서 복사하면 이 형식으로 붙는다.
// - 해당 언어의 이름과 검색어. emojibase에서 해당 언어 데이터를 가져온다. 언어별 파일 하나(언어 폴더의 locales/<언어>/screen/emoji.ts)
//
// 그리고 Twemoji에 이미지 파일이 실제로 있는지 대조한다. 없는 것을 목록에 넣으면 그 셀만 깨져 보인다.
// 실행에는 인터넷이 필요하다. 결과물은 저장소에 넣는다.

import "../src/infra/log/choose-at-start.ts"; // 다른 import보다 먼저 로그 언어를 고른다
import fs from "fs";
import path from "path";
import { z } from "zod";
import * as prettier from "prettier";
import { messageOf } from "../src/rules/error-kind.ts";

const EMOJIBASE = "17.0.0";
// 대시보드가 내주는 그림(디스코드가 올린 @discordapp/twemoji)과 같은 것을 본다. 설치된 패키지에서 읽어 어긋날 일을 없앤다
import twemojiPackage from "../dashboard/node_modules/@discordapp/twemoji/package.json" with { type: "json" };
import { PROJECT } from "../src/infra/project-paths.ts";
import { LANGUAGES, type TextLanguage } from "../src/rules/languages.ts";
import type { EmojiGroupId } from "../dashboard/src/emoji-list/index.ts";
import { L } from "../src/infra/log/text.ts";
import { asText, logTextError } from "../src/infra/log/log-text.ts";
const TWEMOJI = twemojiPackage.version;
const GIST = "https://gist.githubusercontent.com/rigwild/1b509bf69e2a2391f44aa5de3f05b006/raw/discord_emojis.min.json";
const PICKER = path.join(import.meta.dirname, "data", "discord-emoji-picker.md");
// 언어별 출력 파일(언어 폴더의 화면 문구 옆)
const outFile = (language: TextLanguage) => path.join(PROJECT.root, "locales", language, "screen", "emoji.ts");
// 원본의 분류 제목(디스코드 한국어 선택기) → 분류 id. 분류 이름은 화면 문구표에 있다
const GROUP_IDS: Record<string, EmojiGroupId> = { 사람: "people", 자연: "nature", 음식: "food", 활동: "activities", 여행: "travel", 사물: "objects", 기호: "symbols", 국기: "flags" };
// 원본에서 목록이 아닌 절(원본을 옮겨 적을 때의 메모)의 제목
const NOTE_SECTION = "비고";
// 언어별 emojibase 로케일
const LOCALES: Record<TextLanguage, string> = { ko: "ko" };

// 다운로드하는 데이터의 형식. 여기서 읽는 필드만 적는다
const Gist = z.record(z.string(), z.string());
const Compact = z.array(z.object({ hexcode: z.string(), unicode: z.string(), label: z.string().optional(), tags: z.array(z.string()).optional() }));
const Shortcodes = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

const json = async <T extends z.ZodType>(url: string, schema: T): Promise<z.output<T>> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return schema.parse(await res.json());
};
const base = <T extends z.ZodType>(file: string, schema: T) => json(`https://cdn.jsdelivr.net/npm/emojibase-data@${EMOJIBASE}/${file}`, schema);

// Twemoji 파일 이름 규칙. ZWJ가 없는 이모지에서만 VS16(FE0F)을 뗀다.
// 예외로 👁️‍🗨️처럼 ZWJ가 있는데도 전부 뗀 이름인 것이 있어 두 후보를 다 본다.
// 대시보드는 이 SVG로 만든 글꼴(scripts/build-twemoji-font.ts)로 그리므로, 파일이 있으면 글꼴에도 있다.
const toId = (s: string) => [...s].map((c) => (c.codePointAt(0) ?? 0).toString(16)).join("-");
const iconIds = (char: string) => {
  const strict = toId(char.includes("‍") ? char : char.replace(/️/g, ""));
  const loose = toId(char.replace(/️/g, ""));
  return strict === loose ? [strict] : [strict, loose];
};

// 출처마다 VS16과 ZWJ를 붙이기도 빼기도 한다. 뺀 형태를 키로 삼아 짝을 찾는다.
// 특히 지스트는 ZWJ를 흘려서 :woman_police_officer:를 1F46E 2640(= 두 글자)으로 준다.
// emojibase 쪽 표기가 표준이므로 그쪽으로 바로잡는다. 이 키로는 겹치는 항목이 없다.
const key = (s: string) => [...s].filter((c) => c !== "️" && c !== "‍").join("");

// 저장 검사와 같은 잣대. 선택할 수는 있는데 저장이 안 되는 항목을 만들지 않는다
const ONE_EMOJI = /^\p{RGI_Emoji}$/v;
// 군더더기 VS16만 뗀다(ZWJ는 두어야 조합이 유지된다)
const bare = (s: string) => [...s].filter((c) => c !== "️").join("");
// 구분자로 쓰는 글자가 값에 들어 있으면 줄이 깨진다
const clean = (s: string | undefined) =>
  String(s || "")
    .replace(/[|\n\r]+/g, " ")
    .trim();

function readPicker() {
  return fs
    .readFileSync(PICKER, "utf8")
    .split(/^# /m)
    .slice(1)
    .filter((section) => !section.startsWith(NOTE_SECTION))
    .map((section) => {
      const name = section.split("\n")[0].trim();
      const id = GROUP_IDS[name];
      if (!id) throw logTextError(L.build.emojiGroupUnknown({ name }));
      return { id, codes: (section.match(/:([a-z0-9_+-]+):/g) || []).map((c) => c.slice(1, -1)) };
    });
}

// 설치된 Twemoji 패키지에 있는 svg 파일 이름들
function readAssets() {
  const dir = path.join(PROJECT.root, "dashboard", "node_modules", "@discordapp", "twemoji", "dist", "svg");
  const ids = fs.readdirSync(dir).filter((n) => n.endsWith(".svg"));
  if (!ids.length) throw logTextError(L.build.twemojiListUnread());
  return new Set(ids.map((n) => n.slice(0, -".svg".length)));
}

type Compacted = z.output<typeof Compact>[number];

// 단축명 → 이모지. emojibase를 먼저, 지스트는 emojibase에 없는 디스코드 고유 이름만 메운다
function shortcodes(compact: Compacted[], sets: z.output<typeof Shortcodes>[], gist: z.output<typeof Gist>) {
  const charOfHex = new Map(compact.map((e) => [e.hexcode, e.unicode]));
  const charOfCode = new Map<string, string>();
  const add = (code: string, char: string) => {
    const name = code.replace(/:/g, "");
    if (!charOfCode.has(name)) charOfCode.set(name, char);
  };
  for (const set of sets) {
    for (const [hex, codes] of Object.entries(set)) {
      const char = charOfHex.get(hex);
      if (char) for (const code of [codes].flat()) add(String(code), char);
    }
  }
  for (const [code, char] of Object.entries(gist)) add(code, char);
  return charOfCode;
}

// 목록의 한 줄. 못 담으면 dropped, 이미지 파일이 없으면 noAsset에 이유를 적는다
function rowOf(group: string, code: string, charOfCode: Map<string, string>, named: Map<string, Compacted>, assets: Set<string>): { line?: string; dropped?: string; noAsset?: string } {
  const found = charOfCode.get(code);
  if (!found) return { dropped: asText(L.build.emojiNoMatch({ group, code })) };

  const info = named.get(key(found));
  // 표준 표기로 바로잡는다. emojibase는 ⌚처럼 이미 그림으로 보이는 글자에도 VS16을 붙여 주는데,
  // 그 형태는 RGI가 아니라 저장 검사(/^\p{RGI_Emoji}$/v)가 거부한다. 선택할 수는 있는데 저장은
  // 안 되는 항목이 생기므로, 통과하는 쪽을 선택해 담는다.
  const standard = info?.unicode || found;
  const char = [standard, bare(standard)].find((c) => ONE_EMOJI.test(c));
  if (!char) return { dropped: asText(L.build.emojiNotRgi({ group, code })) };

  const label = clean(info?.label) || code.replace(/_/g, " ");
  const tags = clean([...new Set(info?.tags || [])].join(" "));
  // 단축명은 콜론째로 담는다. 디스코드에서 복사하면 ":thinking:" 형식으로 딸려오는데,
  // 부분 일치로 찾으므로 콜론이 있으면 "thinking"도 ":thinking:"도 걸린다.
  const line = [char, label, `${tags} :${code}:`.trim()].join("|");
  return { line, noAsset: iconIds(char).some((id) => assets.has(id)) ? undefined : `${group}:${code} ${char}` };
}

// 한 언어의 목록 파일. 분류, 순서, 이모지는 언어와 무관하게 같고 이름과 검색어만 해당 언어 기준이다
async function writeList(language: TextLanguage, picker: ReturnType<typeof readPicker>, charOfCode: Map<string, string>, assets: Set<string>) {
  const locale = LOCALES[language];
  const named = new Map((await base(`${locale}/compact.json`, Compact)).map((e) => [key(e.unicode), e]));
  const groups: [EmojiGroupId, string[]][] = [];
  const dropped: string[] = [];
  const noAsset: string[] = [];

  for (const section of picker) {
    const rows: string[] = [];
    for (const code of section.codes) {
      const row = rowOf(section.id, code, charOfCode, named, assets);
      if (row.dropped) dropped.push(row.dropped);
      if (row.noAsset) noAsset.push(row.noAsset);
      if (row.line) rows.push(row.line);
    }
    groups.push([section.id, rows]);
  }

  const total = groups.reduce((sum, [, rows]) => sum + rows.length, 0);
  const out = outFile(language);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // 저장소의 서식 검사를 지나도록 prettier 설정대로 맞춰 쓴다
  const source = [
    "// 자동 생성물. 손으로 고치지 않는다. scripts/build-emoji-list.ts를 고치고 다시 만든다.",
    "// 분류, 순서는 디스코드 선택기 그대로(분류 이름은 화면 문구표에서 id로 찾는다).",
    `// 이름, 검색어: emojibase-data@${EMOJIBASE} (MIT, ${locale}) + 디스코드 단축명`,
    `// 그림: @discordapp/twemoji@${TWEMOJI}. 전부 실제로 있는 파일인지 대조했다`,
    "//",
    "// 한 분류를 한 줄짜리 문자열로 담는다. 항목마다 객체로 두면 파일이 몇 배로 불어난다.",
    "// 줄은 줄바꿈으로, 필드는 |로 나뉜다: 이모지|이름|검색어",
    'import type { EmojiGroup, EmojiGroupId } from "../../../dashboard/src/emoji-list/index.ts";',
    "",
    `export const TWEMOJI_VERSION = ${JSON.stringify(TWEMOJI)};`,
    "",
    "const RAW: Array<[id: EmojiGroupId, rows: string]> = [",
    groups.map(([id, rows]) => `  [${JSON.stringify(id)}, ${JSON.stringify(rows.join("\n"))}],`).join("\n"),
    "];",
    "",
    "export const EMOJI_GROUPS: EmojiGroup[] = RAW.map(([id, rows]) => ({",
    "  id,",
    '  emoji: rows.split("\\n").map((row) => {',
    '    const [char, label, tags] = row.split("|");',
    "    return { char, label, search: `${label} ${tags}`.toLowerCase() };",
    "  }),",
    "}));",
    "",
  ].join("\n");
  fs.writeFileSync(out, await prettier.format(source, { ...(await prettier.resolveConfig(out)), filepath: out }));

  console.log(`[${language}] ${groups.map(([id, rows]) => `${id}(${rows.length})`).join(" ")}`);
  console.log(asText(L.build.emojiListWritten({ language, total, kb: (fs.statSync(out).size / 1024).toFixed(0), twemoji: TWEMOJI })));
  if (dropped.length) console.log(asText(L.build.emojiDropped({ language, count: dropped.length, items: dropped.slice(0, 6).join(" "), more: dropped.length > 6 ? " …" : "" })));
  console.log(asText(noAsset.length ? L.build.emojiNoAsset({ language, count: noAsset.length, items: noAsset.slice(0, 8).join(" ") }) : L.build.emojiAssetsComplete({ language })));
}

async function main() {
  const picker = readPicker();

  // emojibase를 먼저 믿는다. 지스트는 이름이 바뀌기 전에 뜬 것이라 :beetle:을 🐞로,
  // :man_in_tuxedo:를 🤵로 준다(지금은 각각 🪲, 🤵‍♂️다). 단축명 매핑은 언어와 무관하므로 기준 언어 목록에서 찾는다
  const [assets, gist, compact, sets] = await Promise.all([readAssets(), json(GIST, Gist), base(`${LOCALES[LANGUAGES[0].tag]}/compact.json`, Compact), Promise.all(["en/shortcodes/joypixels.json", "en/shortcodes/github.json", "en/shortcodes/emojibase.json", "en/shortcodes/emojibase-legacy.json", "en/shortcodes/cldr.json"].map((file) => base(file, Shortcodes)))]);
  const charOfCode = shortcodes(compact, sets, gist);

  for (const { tag } of LANGUAGES) await writeList(tag, picker, charOfCode, assets);
}

main().catch((error) => {
  console.error(messageOf(error));
  process.exit(1);
});
