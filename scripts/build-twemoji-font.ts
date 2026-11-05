// 대시보드 이모지 글꼴(Twemoji 그림을 컬러 글꼴로 바꾼 수정본)을 만든다. 손으로 실행한다. postinstall 이나 빌드에 걸려 있지 않다. 결과물은 저장소에 넣는다.
//   node scripts/build-twemoji-font.ts                    emoji-test.txt 를 unicode.org 에서 다운로드한다
//   node scripts/build-twemoji-font.ts <emoji-test.txt>   다운로드해 둔 파일로 만든다
//
// 원본은 대시보드에 설치된 @discordapp/twemoji(디스코드가 올린 Twemoji)의 SVG 다. 입력란 안까지 디스코드와 같은 이모지로 그리는 길은 글꼴뿐이다.
// 만드는 도구는 nanoemoji(구글이 Noto Color Emoji 에 쓰는 도구, 파이썬)다. npm 의 아이콘 글꼴 도구는 단색 글꼴이라 색이 사라진다.
// 파이썬 3.10 이상이 있어야 한다(PYTHON 환경 변수로 지정할 수 있다). 정한 버전의 도구를 node_modules/.cache/twemoji-font/venv 에 깔고,
// 작업 폴더도 거기 둔다. 다시 돌리면 바뀐 그림만 다시 만든다(처음은 10분 넘게 걸린다).
// 사파리가 COLRv1 을 그리지 못해 COLRv0 로 만든다. 세로 값: 이모지가 1em 정사각형에 들고 바닥이 기준선 0.1em 아래(Twemoji 권장 CSS 와 같은 자리).
// 뒤처리(twemoji-font.py): 글자 문자와 키캡을 빼고, 합자를 emoji-test.txt 의 모든 형태로 넣는다.
// iOS, iPadOS 는 기기 이모지를 쓴다(디스코드 iOS 앱과 같다). @font-face 를 그 WebKit 에만 있는 속성으로 가려 거기서는 글꼴이 없게 한다.
// 결과: dashboard/src/assets/twemoji/(twemoji.woff2, NOTICE.txt, build.json), dashboard/src/twemoji.css(@font-face)

import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import * as fontkit from "fontkit";
import * as prettier from "prettier";
import { compress } from "wawoff2";
import { setNames } from "./font-names.ts";
import { rangeOf } from "./unicode-range.ts";
import { PROJECT } from "../src/infra/project-paths.ts";

const DASHBOARD = path.join(PROJECT.root, "dashboard");
const TWEMOJI_DIR = path.join(DASHBOARD, "node_modules", "@discordapp", "twemoji");
const SVG_DIR = path.join(TWEMOJI_DIR, "dist", "svg");
const OUT_DIR = path.join(DASHBOARD, "src", "assets", "twemoji");
const OUT_CSS = path.join(DASHBOARD, "src", "twemoji.css");
const CACHE = path.join(PROJECT.root, "node_modules", ".cache", "twemoji-font");
const VENV = path.join(CACHE, "venv");
const WORK = path.join(CACHE, "work");
const POST = path.join(import.meta.dirname, "twemoji-font.py");
const FAMILY = "Musicbot Twemoji";
/** 파이썬 도구. 바꾸면 결과가 달라질 수 있어 고정한다(build.json 에 남는다) */
const TOOLS = { nanoemoji: "0.16.0", picosvg: "0.23.0", fonttools: "4.65.0" };
/** 1em = 1024. 너비와 위아래 합을 em 과 같게 해야 그림이 글자 크기만 하다(nanoemoji 기본값은 1.17배) */
const METRICS = { upem: 1024, width: 1024, ascender: 922, descender: -102 };

const { version: TWEMOJI } = JSON.parse(fs.readFileSync(path.join(TWEMOJI_DIR, "package.json"), "utf8")) as { version: string };
/** Twemoji 는 주 버전을 이모지 버전에 맞춘다(16.0.1 → Emoji 16.0) */
const EMOJI = `${TWEMOJI.split(".")[0]}.0`;

const NAMES: Record<number, string> = {
  0: "Graphics: Copyright Twitter, Inc and other contributors; Copyright Jason Sofonia & Justine De Caires (@discordapp/twemoji)",
  1: FAMILY,
  2: "Regular",
  3: `${FAMILY} ${TWEMOJI}`,
  4: FAMILY,
  5: `Version ${TWEMOJI}`,
  6: FAMILY.replace(/ /g, ""),
  13: `Twemoji ${TWEMOJI} graphics, licensed under CC BY 4.0. Modified: converted from SVG to a COLRv0 color font, text characters and keycaps removed, ligatures added for every emoji-test.txt form.`,
  14: "https://creativecommons.org/licenses/by/4.0/",
  16: "",
  17: "",
};

const bin = (name: string) => path.join(VENV, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? `${name}.exe` : name);

function run(command: string, args: string[], options: SpawnSyncOptions = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} 실패(종료 코드 ${String(result.status)})`);
  return result;
}

/** 3.10 이상인 파이썬. PYTHON, python3, python, py -3 차례로 */
function findPython(): string[] {
  const candidates = [process.env.PYTHON ? [process.env.PYTHON] : [], ["python3"], ["python"], ["py", "-3"]].filter((one) => one.length);
  for (const [command, ...args] of candidates) {
    const result = spawnSync(command, [...args, "-c", "import sys; print(sys.version_info >= (3, 10))"], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim() === "True") return [command, ...args];
  }
  throw new Error("파이썬 3.10 이상을 찾지 못했습니다. 설치하거나 PYTHON 환경 변수로 경로를 지정하세요");
}

function ensureTools() {
  if (!fs.existsSync(bin("python"))) {
    const [command, ...args] = findPython();
    console.log(`가상환경 만드는 중: ${path.relative(PROJECT.root, VENV)}`);
    run(command, [...args, "-m", "venv", VENV]);
  }
  run(bin("python"), ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", ...Object.entries(TOOLS).map(([name, version]) => `${name}==${version}`)]);
}

/** emoji-test.txt: 인자로 받은 파일, 없으면 unicode.org 에서 */
async function emojiTest(): Promise<string> {
  const given = process.argv[2];
  const text = given ? fs.readFileSync(given, "utf8") : await (await fetch(`https://unicode.org/Public/emoji/${EMOJI}/emoji-test.txt`)).text();
  if (!new RegExp(`^# Version: ${EMOJI.replace(".", "\\.")}$`, "m").test(text)) throw new Error(`emoji-test.txt 가 Emoji ${EMOJI} 가 아닙니다(Twemoji ${TWEMOJI})`);
  const file = path.join(CACHE, "emoji-test.txt");
  fs.writeFileSync(file, text);
  return file;
}

/** Twemoji SVG 를 nanoemoji 가 읽는 이름(emoji_u1f600_1f3fb.svg)으로 작업 폴더에 둔다. 같은 파일은 건드리지 않아 다시 돌릴 때 바뀐 것만 다시 만든다 */
function syncSvgs(): number {
  const dir = path.join(WORK, "svg");
  fs.mkdirSync(dir, { recursive: true });
  const wanted = new Map<string, string>();
  for (const name of fs.readdirSync(SVG_DIR)) {
    if (name.endsWith(".svg")) wanted.set(`emoji_u${name.slice(0, -4).replace(/-/g, "_")}.svg`, path.join(SVG_DIR, name));
  }
  for (const name of fs.readdirSync(dir)) if (!wanted.has(name)) fs.rmSync(path.join(dir, name));
  for (const [name, from] of wanted) {
    const to = path.join(dir, name);
    const data = fs.readFileSync(from);
    if (!fs.existsSync(to) || !fs.readFileSync(to).equals(data)) fs.writeFileSync(to, data);
  }
  return wanted.size;
}

function writeIfChanged(file: string, text: string) {
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text);
}

function buildColorFont(): string {
  const config = [`family = "${FAMILY}"`, `output_file = "twemoji.ttf"`, `color_format = "glyf_colr_0"`, ...Object.entries(METRICS).map(([key, value]) => `${key} = ${value}`), "[axis.wght]", `name = "Weight"`, "default = 400", "[master.regular]", `style_name = "Regular"`, `srcs = ["svg/*.svg"]`, "[master.regular.position]", "wght = 400", ""].join("\n");
  writeIfChanged(path.join(WORK, "twemoji.toml"), config);
  // nanoemoji 가 ninja 를 PATH 에서 찾는다
  const PATH = `${path.dirname(bin("python"))}${path.delimiter}${process.env.PATH ?? ""}`;
  run(bin("nanoemoji"), ["twemoji.toml"], { cwd: WORK, env: { ...process.env, PATH } });
  return path.join(WORK, "build", "twemoji.ttf");
}

async function main() {
  ensureTools();
  const testFile = await emojiTest();
  const svgs = syncSvgs();
  console.log(`Twemoji ${TWEMOJI}: SVG ${svgs}개, Emoji ${EMOJI}`);
  const built = buildColorFont();

  const patched = path.join(WORK, "twemoji-patched.ttf");
  const post = run(bin("python"), [POST, built, testFile, patched], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
  const stats = JSON.parse(String(post.stdout).trim().split("\n").pop() ?? "{}") as { added: number; ligatures: number; codepoints: number };

  const ttf = setNames(fs.readFileSync(patched), NAMES);
  const woff2 = Buffer.from(await compress(ttf));
  const range = rangeOf((fontkit.create(ttf) as fontkit.Font).characterSet);

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "twemoji.woff2"), woff2);
  fs.writeFileSync(
    path.join(OUT_DIR, "NOTICE.txt"),
    [
      `${FAMILY} (twemoji.woff2)`,
      "",
      `Graphics: Twemoji ${TWEMOJI} as published by Discord (@discordapp/twemoji, https://github.com/discord/twemoji)`,
      "Copyright Twitter, Inc and other contributors; Copyright Jason Sofonia & Justine De Caires",
      "Licensed under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/",
      "",
      "Modified: the SVG files were converted to a COLRv0 color font with nanoemoji, text characters",
      "(space, #, *, 0-9, ©, ®, ™, U+20E3) and keycap emoji were removed, and ligatures were added for",
      `every form listed in Unicode emoji-test.txt ${EMOJI}. Built by scripts/build-twemoji-font.ts.`,
      "",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(OUT_DIR, "build.json"), `${JSON.stringify({ twemoji: TWEMOJI, emoji: EMOJI, tools: TOOLS, metrics: METRICS }, null, 2)}\n`);

  const body = `/* ${FAMILY}: Twemoji ${TWEMOJI} 그림(CC BY 4.0, assets/twemoji/NOTICE.txt)을 컬러 글꼴로 바꾼 수정본. style.css 의 --font-sans, --font-discord 맨 앞에 둔다.
   손으로 고치지 않는다: node scripts/build-twemoji-font.ts 가 만든다. 범위는 글꼴에 든 문자(이모지와 그 순서열 부속 문자)뿐이라 보통 글은 이 글꼴을 기다리지 않는다.
   iOS, iPadOS(-webkit-touch-callout 은 그 WebKit 에만 있다)에서는 정의하지 않아 기기 이모지로 그리고 글꼴을 다운로드하지 않는다.
   block: 글꼴이 오기 전 이모지 자리만 비워 둔다(OS 이모지가 보였다가 바뀌지 않게) */
@supports not (-webkit-touch-callout: none) {
  @font-face {
    font-family: "${FAMILY}";
    font-display: block;
    src: url("./assets/twemoji/twemoji.woff2") format("woff2");
    unicode-range: ${range};
  }
}
`;
  const options = (await prettier.resolveConfig(OUT_CSS)) ?? {};
  fs.writeFileSync(OUT_CSS, await prettier.format(body, { ...options, filepath: OUT_CSS }));
  console.log(`${FAMILY}: ${(woff2.length / 1024).toFixed(0)}KB, 문자 ${stats.codepoints}개, 합자 ${stats.ligatures}개(뒤처리로 ${stats.added}개 더함)`);
}

await main();
