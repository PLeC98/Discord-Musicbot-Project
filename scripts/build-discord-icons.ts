// 디스코드 앱 이모지의 기호 윤곽을 뽑는다. 손으로 실행한다. postinstall이나 빌드에 걸려 있지 않다. 결과물은 저장소에 넣는다.
//   node scripts/build-discord-icons.ts      src/ui/icons.ts 표의 기호로 data/discord-icons/glyphs.json 을 다시 만든다
//
// 원본은 화면 앱이 받는 Material Symbols Rounded 가변 글꼴 중 축이 넷 다 있는 것(FILL · wght · GRAD · opsz)이다. 기호 이름을 원본의 합자로 풀어 코드포인트를 얻고,
// 축을 디스코드에서 정한 값으로 고정한 글꼴(subset-font. fontkit 은 이 WOFF2 의 축을 풀지 못한다)에서 윤곽을 SVG 경로로 적는다(글꼴 칸 960, y 위로).
// 봇은 이 파일로 PNG 를 굽는다(ui/icon-images). 글꼴 도구는 개발 의존성이라 봇이 부르지 않는다. 기호 "sponsorblock" 은 글꼴이 아니라 skipIcon.svg 다

import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import subsetFont from "subset-font";
import { PROJECT } from "../src/infra/project-paths.ts";
import { ICONS } from "../src/ui/icons.ts";

const SOURCE = path.join(PROJECT.root, "dashboard", "node_modules", "@fontsource-variable", "material-symbols-rounded", "files", "material-symbols-rounded-latin-full-normal.woff2");
const OUT = path.join(PROJECT.data, "discord-icons", "glyphs.json");
// 20px 안팎으로 보이는 이모지라 작은 크기용 모양(opsz 20)에 굵게, 채운 모양(디스코드에서 견주어 정함)
const AXES = { FILL: 1, wght: 700, GRAD: 0, opsz: 20 };

const source = fs.readFileSync(SOURCE);
const font = fontkit.create(source) as fontkit.Font;
const byGlyph = new Map<number, number>();
for (const cp of font.characterSet) if (cp >= 0xe000 && cp <= 0xf8ff) byGlyph.set(font.glyphForCodePoint(cp).id, cp);
const codepointOf = (name: string) => {
  const run = font.layout(name);
  return run.glyphs.length === 1 ? (byGlyph.get(run.glyphs[0].id) ?? null) : null;
};

const names = [...new Set(Object.values(ICONS).map((spec) => spec.glyph))].filter((name) => name !== "sponsorblock").sort();
const unknown = names.filter((name) => codepointOf(name) === null);
if (unknown.length) {
  console.error(`Material Symbols 에 없는 이름: ${unknown.join(", ")}`);
  process.exit(1);
}
const pinned = fontkit.create(await subsetFont(source, String.fromCodePoint(...names.map((name) => codepointOf(name)!)), { targetFormat: "sfnt", variationAxes: AXES })) as fontkit.Font;
const glyphs = Object.fromEntries(names.map((name) => [name, pinned.glyphForCodePoint(codepointOf(name)!).path.toSVG()]));
const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(SOURCE)), "package.json"), "utf8")) as { version: string };

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: `@fontsource-variable/material-symbols-rounded@${pkg.version} ${path.basename(SOURCE)}`, axes: AXES, unitsPerEm: font.unitsPerEm, glyphs }, null, 1) + "\n");
console.log(`기호 ${names.length}개 → ${path.relative(PROJECT.root, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(1)}KB)`);
