// 디스코드에 내는 이미지의 아이콘 윤곽을 추출한다. 손으로 실행한다. postinstall이나 빌드에 걸려 있지 않다. 결과물은 저장소에 넣는다.
//   node scripts/build-discord-icons.ts      data/discord-icons의 두 파일을 다시 만든다
//     glyphs.json        앱 이모지(src/ui/icons.ts 표의 기호)
//     system-card.json   /system 이미지의 아이콘(src/ui/system-card/icons.ts)
//
// 원본은 화면 앱이 받는 Material Symbols Rounded 가변 글꼴 중 축이 넷 다 있는 것(FILL, wght, GRAD, opsz)이다. 기호 이름을 원본의 합자로 풀어 코드포인트를 얻고,
// 쓰는 곳에 맞춘 값으로 축을 고정한 글꼴(subset-font. fontkit은 이 WOFF2의 축을 풀지 못한다)에서 윤곽을 SVG 경로로 저장한다(글꼴 단위 960, y축은 위쪽이 양수).
// 봇은 이 파일로 그린다(ui/icon-images, ui/system-card). 글꼴 도구는 개발 의존성이라 봇 코드는 불러오지 않는다. 기호 "sponsorblock"은 글꼴이 아니라 skipIcon.svg, 로고(logo)는 이미지 파일이다

import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import subsetFont from "subset-font";
import { PROJECT } from "../src/infra/project-paths.ts";
import { ICONS, type IconSpec } from "../src/ui/icons.ts";
import { CARD_ICONS, STATUS_ICONS } from "../src/ui/system-card/icons.ts";

const SOURCE = path.join(PROJECT.root, "dashboard", "node_modules", "@fontsource-variable", "material-symbols-rounded", "files", "material-symbols-rounded-latin-full-normal.woff2");
const OUT = path.join(PROJECT.data, "discord-icons");
// 앱 이모지: 20px 안팎으로 보이는 이모지라 작은 크기용 모양(opsz 20)에 굵게, 채운 모양(디스코드에서 비교해 정함)
const EMOJI_AXES = { FILL: 1, wght: 700, GRAD: 0, opsz: 20 };
// /system 이미지: 대시보드 아이콘과 같은 굵기(450), 채우지 않은 모양. 상태 아이콘만 채운다
const CARD_AXES = { line: { FILL: 0, wght: 450, GRAD: 0, opsz: 20 }, fill: { FILL: 1, wght: 450, GRAD: 0, opsz: 20 } };

const source = fs.readFileSync(SOURCE);
const font = fontkit.create(source) as fontkit.Font;
const byGlyph = new Map<number, number>();
for (const cp of font.characterSet) if (cp >= 0xe000 && cp <= 0xf8ff) byGlyph.set(font.glyphForCodePoint(cp).id, cp);
const codepointOf = (name: string) => {
  const run = font.layout(name);
  return run.glyphs.length === 1 ? (byGlyph.get(run.glyphs[0].id) ?? null) : null;
};
const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(SOURCE)), "package.json"), "utf8")) as { version: string };
const sourceName = `@fontsource-variable/material-symbols-rounded@${pkg.version} ${path.basename(SOURCE)}`;

/** 축을 고정한 글꼴에서 이름마다 SVG 경로 */
async function outlines(names: readonly string[], axes: Record<string, number>) {
  const pinned = fontkit.create(await subsetFont(source, String.fromCodePoint(...names.map((name) => codepointOf(name)!)), { targetFormat: "sfnt", variationAxes: axes })) as fontkit.Font;
  return Object.fromEntries(names.map((name) => [name, pinned.glyphForCodePoint(codepointOf(name)!).path.toSVG()]));
}

function write(file: string, data: object) {
  const out = path.join(OUT, file);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 1) + "\n");
  return `${path.relative(PROJECT.root, out)} (${(fs.statSync(out).size / 1024).toFixed(1)}KB)`;
}

const emoji = [...new Set((Object.values(ICONS) as IconSpec[]).filter((spec) => spec.shape !== "logo").map((spec) => spec.glyph))].filter((name) => name !== "sponsorblock").sort();
const unknown = [...emoji, ...CARD_ICONS, ...STATUS_ICONS].filter((name) => codepointOf(name) === null);
if (unknown.length) {
  console.error(`Material Symbols에 없는 이름: ${[...new Set(unknown)].join(", ")}`);
  process.exit(1);
}

console.log(`앱 이모지 기호 ${emoji.length}개 → ${write("glyphs.json", { source: sourceName, axes: EMOJI_AXES, unitsPerEm: font.unitsPerEm, glyphs: await outlines(emoji, EMOJI_AXES) })}`);
const card = { source: sourceName, axes: CARD_AXES, unitsPerEm: font.unitsPerEm, line: await outlines(CARD_ICONS, CARD_AXES.line), fill: await outlines(STATUS_ICONS, CARD_AXES.fill) };
console.log(`/system 아이콘 ${CARD_ICONS.length + STATUS_ICONS.length}개 → ${write("system-card.json", card)}`);
