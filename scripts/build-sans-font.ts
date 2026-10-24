// 대시보드 본문 글꼴(Google Sans Flex)을 화면이 움직이지 않는 축만 고정해 만든다. 손으로 실행한다. postinstall 이나 빌드에 걸려 있지 않다. 결과물은 저장소에 넣는다.
//   node scripts/build-sans-font.ts
//
// 원본은 화면 앱이 받는 @fontsource-variable/google-sans-flex 의 모든 축 버전(full)이다(라틴 1.4MB 남짓). 화면은 폭(wdth)과 획 두께(GRAD)를 움직이지 않으므로
// 둘을 기본값(100 · 0)에 고정하고, 굵기 · 둥글기(ROND) · 크기 맞춤(opsz) · 기울기(slnt)는 남긴다(rond 버전은 크기 맞춤 · 기울기가 없어 쓰지 않는다).
// 글자는 하나도 빼지 않는다(문구 · 곡명이 바뀌어도 다시 만들 필요가 없다). 서브셋과 unicode-range 는 원본 CSS 를 그대로 따른다.
// 결과: dashboard/src/assets/google-sans-flex/(서브셋마다 woff2 · OFL.txt) · dashboard/src/google-sans-flex.css(@font-face)

import fs from "node:fs";
import path from "node:path";
import subsetFont from "subset-font";
import * as prettier from "prettier";
import { PROJECT } from "../src/infra/project-paths.ts";

const DASHBOARD = path.join(PROJECT.root, "dashboard");
const PACKAGE = path.join(DASHBOARD, "node_modules", "@fontsource-variable", "google-sans-flex");
const OUT_DIR = path.join(DASHBOARD, "src", "assets", "google-sans-flex");
const OUT_CSS = path.join(DASHBOARD, "src", "google-sans-flex.css");
/** 고정할 축과 값(그 축의 기본값). 화면이 이 축을 움직이게 되면 여기서 빼고 다시 만든다 */
const PINNED = { wdth: 100, GRAD: 0 };
// 글자는 하나도 빼지 않는다(keepAllGlyphs). @types/subset-font 가 이 옵션을 아직 적지 않아, 객체를 따로 만들어 넘긴다(패키지 자체는 받는다)
const OPTIONS = { keepAllGlyphs: true, variationAxes: PINNED, targetFormat: "woff2" as const };

/** 원본 CSS 의 @font-face 하나: 서브셋 이름 · 파일 · 글자 범위 · 기울기 범위 */
type Face = { subset: string; file: string; range: string; style: string };

function faces(): Face[] {
  const css = fs.readFileSync(path.join(PACKAGE, "full.css"), "utf8");
  return [...css.matchAll(/\/\* google-sans-flex-([a-z-]+)-full-normal \*\/\s*@font-face \{([^}]*)\}/g)].map(([, subset, body]) => {
    const pick = (re: RegExp) => {
      const m = re.exec(body);
      if (!m) throw new Error(`${subset}: ${re} 를 찾지 못했습니다`);
      return m[1].trim();
    };
    return { subset, file: pick(/src:\s*url\(\.\/files\/([^)]+)\)/), range: pick(/unicode-range:\s*([^;]+);/), style: pick(/font-style:\s*([^;]+);/) };
  });
}

async function main() {
  const list = faces();
  if (!list.length) throw new Error("full.css 에서 @font-face 를 찾지 못했습니다");
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync(path.join(PACKAGE, "LICENSE"), path.join(OUT_DIR, "OFL.txt"));
  const version = JSON.parse(fs.readFileSync(path.join(PACKAGE, "package.json"), "utf8")).version as string;

  const blocks: string[] = [];
  let before = 0;
  let after = 0;
  for (const face of list) {
    const source = fs.readFileSync(path.join(PACKAGE, "files", face.file));
    const font = await subsetFont(source, "", OPTIONS);
    const name = `${face.subset}.woff2`;
    fs.writeFileSync(path.join(OUT_DIR, name), font);
    before += source.length;
    after += font.length;
    console.log(`${face.subset}: ${Math.round(source.length / 1024)}KB → ${Math.round(font.length / 1024)}KB`);
    blocks.push(`@font-face {\n  font-family: "Google Sans Flex Variable";\n  font-style: ${face.style};\n  font-display: swap;\n  font-weight: 1 1000;\n  src: url("./assets/google-sans-flex/${name}") format("woff2-variations");\n  unicode-range: ${face.range};\n}`);
  }

  const body = `/* Google Sans Flex ${version}(Google, SIL OFL 1.1, assets/google-sans-flex/OFL.txt). 대시보드의 본문 글꼴(style.css 의 --font-sans).
   scripts/build-sans-font.ts 가 만든다: 폭 · 획 두께 축을 기본값에 고정하고 글자는 모두 남긴 버전. 손으로 고치지 않는다 */
${blocks.join("\n\n")}
`;
  const options = (await prettier.resolveConfig(OUT_CSS)) ?? {};
  fs.writeFileSync(OUT_CSS, await prettier.format(body, { ...options, filepath: OUT_CSS }));
  console.log(`서브셋 ${list.length}개, ${Math.round(before / 1024)}KB → ${Math.round(after / 1024)}KB`);
}

await main();
