// 대시보드 아이콘 글꼴을 쓰는 기호만 남겨 만든다. 손으로 실행한다. postinstall이나 빌드에 걸려 있지 않다.
//   node scripts/build-icon-font.ts            dashboard/src/icons.ts 의 이름으로 다시 만든다
//   node scripts/build-icon-font.ts 이름 …     그 기호를 더해 만든다(빼려면 icons.ts 에서 그 줄을 지우고 다시 만든다)
//
// 원본은 화면 앱이 받는 Material Symbols Rounded 가변 글꼴(채움 축 포함) 전체다(1.4MB 남짓). 기호 이름을 원본의 합자(이름 글자 → 기호)로 풀어
// 코드포인트를 얻고, 그 코드포인트만 담은 글꼴(dashboard/src/assets/material-symbols.woff2)과 이름 → 코드포인트 표(icons.ts)를 쓴다.
// 화면은 이름 대신 코드포인트를 그리므로 합자 표는 담지 않는다. 결과물은 저장소에 넣는다.

import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import subsetFont from "subset-font";
import * as prettier from "prettier";
import { PROJECT } from "../src/infra/project-paths.ts";

const SOURCE = path.join(PROJECT.root, "dashboard", "node_modules", "@fontsource-variable", "material-symbols-rounded", "files", "material-symbols-rounded-latin-fill-normal.woff2");
const OUT_FONT = path.join(PROJECT.root, "dashboard", "src", "assets", "material-symbols.woff2");
const OUT_TABLE = path.join(PROJECT.root, "dashboard", "src", "icons.ts");

/** 지금 표에 있는 이름 */
function listed(): string[] {
  if (!fs.existsSync(OUT_TABLE)) return [];
  return [...fs.readFileSync(OUT_TABLE, "utf8").matchAll(/^ {2}([a-z0-9_]+): 0x[0-9a-f]+,$/gm)].map((m) => m[1]);
}

/** 기호 이름 → 코드포인트. 원본의 합자를 따라가 나온 기호가 개인 영역 코드포인트를 가지면 그것 */
function resolver(font: fontkit.Font) {
  const byGlyph = new Map<number, number>();
  for (const cp of font.characterSet) if (cp >= 0xe000 && cp <= 0xf8ff) byGlyph.set(font.glyphForCodePoint(cp).id, cp);
  return (name: string) => {
    const run = font.layout(name);
    return run.glyphs.length === 1 ? (byGlyph.get(run.glyphs[0].id) ?? null) : null;
  };
}

async function main() {
  const names = [...new Set([...listed(), ...process.argv.slice(2)])].sort();
  const source = fs.readFileSync(SOURCE);
  const codepointOf = resolver(fontkit.create(source) as fontkit.Font);
  const table = names.map((name) => [name, codepointOf(name)] as const);
  const unknown = table.filter(([, cp]) => cp === null).map(([name]) => name);
  if (unknown.length) {
    console.error(`Material Symbols 에 없는 이름: ${unknown.join(", ")}`);
    process.exit(1);
  }

  const font = await subsetFont(source, String.fromCodePoint(...table.map(([, cp]) => cp!)), { targetFormat: "woff2" });
  fs.writeFileSync(OUT_FONT, font);

  const body = `// Material Symbols Rounded 기호: 이름 → 코드포인트. 화면이 쓰는 기호만 두고, 아이콘 글꼴(assets/material-symbols.woff2)도 이것만 담는다.
// 손으로 고치지 않는다: node scripts/build-icon-font.ts 가 만든다(기호를 더하려면 이름을 붙여 실행, 빼려면 그 줄을 지우고 실행)

const ICONS = {
${table.map(([name, cp]) => `  ${name}: 0x${cp!.toString(16)},`).join("\n")}
} as const;

type IconName = keyof typeof ICONS;

export { ICONS };
export type { IconName };
`;
  const options = (await prettier.resolveConfig(OUT_TABLE)) ?? {};
  fs.writeFileSync(OUT_TABLE, await prettier.format(body, { ...options, filepath: OUT_TABLE }));
  console.log(`기호 ${table.length}개, 글꼴 ${(font.length / 1024).toFixed(1)}KB (원본 ${(source.length / 1024).toFixed(0)}KB)`);
}

await main();
