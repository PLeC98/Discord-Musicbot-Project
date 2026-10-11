// 대시보드 고정폭 글꼴(D2Coding)을 조각내 만든다. 손으로 실행한다. postinstall 이나 빌드에 걸려 있지 않다. 결과물은 저장소에 넣는다.
//   node scripts/build-mono-font.ts               공식 저장소(naver/d2codingfont)의 최신 릴리스를 받아 만든다
//   node scripts/build-mono-font.ts <릴리스 zip>  받아 둔 공식 릴리스 zip 으로 만든다
//
// 원본 TTF 는 굵기마다 4MB 남짓이고 공식 릴리스에는 웹 글꼴이 없다. 화면에 나온 글자의 조각만 받도록 woff2 조각으로 나눈다.
// 조각 경계: 한글 · 라틴은 Pretendard 의 dynamic subset 조각을 그대로 빌린다(자주 쓰는 글자끼리 묶여 있어 한 화면의 한글이 적은 조각으로 끝난다).
// 그 밖의 글자(한자 · 가나 일부 등)는 코드 차례로 묶는다. 결과: dashboard/src/assets/d2coding/(조각 · OFL.txt) · dashboard/src/d2coding.css(@font-face)

import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import subsetFont from "subset-font";
import * as prettier from "prettier";
import { unzip } from "../src/infra/zip.ts";
import { PROJECT } from "../src/infra/project-paths.ts";

const DASHBOARD = path.join(PROJECT.root, "dashboard");
const OUT_DIR = path.join(DASHBOARD, "src", "assets", "d2coding");
const OUT_CSS = path.join(DASHBOARD, "src", "d2coding.css");
const PRETENDARD_CSS = path.join(DASHBOARD, "node_modules", "pretendard", "dist", "web", "variable", "pretendardvariable-dynamic-subset.css");
const RELEASES = "https://api.github.com/repos/naver/d2codingfont/releases/latest";
// Pretendard 조각에 들지 않은 글자를 묶는 크기(한자는 한 조각에 이만큼)
const REST_CHUNK = 400;
const WEIGHTS = [
  { weight: 400, file: /^D2Coding\/D2Coding-Ver[\d.]+-\d+\.ttf$/ },
  { weight: 700, file: /^D2Coding\/D2CodingBold-Ver[\d.]+-\d+\.ttf$/ },
] as const;

async function releaseZip(): Promise<Buffer> {
  const given = process.argv[2];
  if (given) return fs.readFileSync(given);
  const latest = (await (await fetch(RELEASES, { headers: { Accept: "application/vnd.github+json" } })).json()) as { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> };
  const asset = latest.assets.find((one) => one.name.endsWith(".zip"));
  if (!asset) throw new Error(`릴리스 ${latest.tag_name} 에 zip 이 없습니다`);
  console.log(`받는 중: ${asset.name}`);
  return Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer());
}

/** "U+AC00-AC0F, U+00A0" → 코드포인트들 */
function codepointsOf(range: string): number[] {
  return range.split(",").flatMap((part) => {
    const [from, to = from] = part.trim().replace(/^U\+/i, "").split("-");
    const start = parseInt(from, 16);
    const end = parseInt(to, 16);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });
}

/** 코드포인트들 → "U+0020-007E, U+00A0" (이어지는 것은 묶는다) */
function rangeOf(cps: number[]): string {
  const sorted = [...cps].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
    parts.push(i === j ? `U+${hex(sorted[i])}` : `U+${hex(sorted[i])}-${hex(sorted[j])}`);
    i = j;
  }
  return parts.join(", ");
}

/** 조각들: Pretendard 의 조각 경계로 나누고, 남은 글자는 코드 차례로 REST_CHUNK 씩 */
function chunksOf(charset: Set<number>): number[][] {
  const css = fs.readFileSync(PRETENDARD_CSS, "utf8");
  const taken = new Set<number>();
  const chunks: number[][] = [];
  for (const [, range] of css.matchAll(/unicode-range:\s*([^;]+);/g)) {
    const cps = codepointsOf(range).filter((cp) => charset.has(cp) && !taken.has(cp));
    for (const cp of cps) taken.add(cp);
    if (cps.length) chunks.push(cps);
  }
  const rest = [...charset].filter((cp) => !taken.has(cp) && cp >= 0x20).sort((a, b) => a - b);
  for (let i = 0; i < rest.length; i += REST_CHUNK) chunks.push(rest.slice(i, i + REST_CHUNK));
  return chunks;
}

async function main() {
  const entries = unzip(await releaseZip(), { maxEntries: 64, maxBytes: 512 * 1024 * 1024 });
  const license = entries.find((one) => one.name === "OFL.txt");
  if (!license) throw new Error("릴리스에 OFL.txt 가 없습니다");

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "OFL.txt"), license.data);

  const faces: string[] = [];
  let version = "";
  let total = 0;
  for (const { weight, file } of WEIGHTS) {
    const entry = entries.find((one) => file.test(one.name));
    if (!entry) throw new Error(`릴리스에 ${weight} 굵기 TTF 가 없습니다`);
    version = /Ver([\d.]+)/.exec(entry.name)?.[1] ?? version;
    const charset = new Set<number>((fontkit.create(entry.data) as fontkit.Font).characterSet);
    const chunks = chunksOf(charset);
    for (const [i, cps] of chunks.entries()) {
      const name = `${weight}-${i}.woff2`;
      const font = await subsetFont(entry.data, String.fromCodePoint(...cps), { targetFormat: "woff2" });
      fs.writeFileSync(path.join(OUT_DIR, name), font);
      total += font.length;
      faces.push(`@font-face {\n  font-family: "D2Coding";\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: swap;\n  src: url("./assets/d2coding/${name}") format("woff2");\n  unicode-range: ${rangeOf(cps)};\n}`);
    }
    console.log(`${weight}: 조각 ${chunks.length}개`);
  }

  const body = `/* D2Coding ${version}(NAVER, SIL OFL 1.1, assets/d2coding/OFL.txt). 대시보드의 고정폭 글꼴(style.css 의 --font-mono).
   손으로 고치지 않는다: node scripts/build-mono-font.ts 가 공식 릴리스를 조각내 만든다. 화면에 나온 글자의 조각만 받는다 */
${faces.join("\n")}
`;
  const options = (await prettier.resolveConfig(OUT_CSS)) ?? {};
  fs.writeFileSync(OUT_CSS, await prettier.format(body, { ...options, filepath: OUT_CSS }));
  console.log(`D2Coding ${version}: 조각 ${faces.length}개, 모두 ${(total / 1024).toFixed(0)}KB`);
}

await main();
