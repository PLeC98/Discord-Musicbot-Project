// dashboard/src/icons.ts · assets/material-symbols.woff2 — 아이콘 글꼴은 화면이 쓰는 기호만 담는다(scripts/build-icon-font.ts 가 만든다).
// 표를 고치고 글꼴을 다시 만들지 않았거나, 원본 글꼴이 바뀌어 코드포인트가 어긋나면 기호가 빈칸으로 그려진다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import { ICONS } from "../../dashboard/src/icons.ts";

const ROOT = path.join(import.meta.dirname, "..", "..");
const SUBSET = path.join(ROOT, "dashboard", "src", "assets", "material-symbols.woff2");
const SOURCE = path.join(ROOT, "dashboard", "node_modules", "@fontsource-variable", "material-symbols-rounded", "files", "material-symbols-rounded-latin-fill-normal.woff2");

const open = (file: string) => fontkit.create(fs.readFileSync(file)) as fontkit.Font;
const PRIVATE = (cp: number) => cp >= 0xe000 && cp <= 0xf8ff;

test("부분 글꼴은 표의 기호를 빠짐없이, 표에 없는 기호는 담지 않는다(표를 고쳤으면 글꼴도 다시 만들었다)", () => {
  const font = open(SUBSET);
  const inFont = font.characterSet.filter(PRIVATE).sort((a, b) => a - b);
  assert.deepEqual(
    inFont,
    Object.values(ICONS).sort((a, b) => a - b),
  );
  for (const [name, cp] of Object.entries(ICONS)) assert.ok(font.glyphForCodePoint(cp).id > 0, `${name} 의 기호가 비었다`);
  assert.ok(font.variationAxes.FILL && font.variationAxes.wght, "채움 · 굵기 축은 남긴다(아이콘이 고른다)");
});

test("표의 코드포인트는 원본 글꼴에서 그 이름이 가리키는 기호다", () => {
  const font = open(SOURCE);
  const byGlyph = new Map<number, number>();
  for (const cp of font.characterSet.filter(PRIVATE)) byGlyph.set(font.glyphForCodePoint(cp).id, cp);
  const wrong = Object.entries(ICONS).filter(([name, cp]) => {
    const run = font.layout(name);
    return run.glyphs.length !== 1 || byGlyph.get(run.glyphs[0].id) !== cp;
  });
  assert.deepEqual(wrong, []);
});
