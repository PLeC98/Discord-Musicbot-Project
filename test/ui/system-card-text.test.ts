// /system 이미지의 글자와 아이콘이 그리는 데 쓰는 글꼴과 윤곽 파일에 다 있는지. 이미지는 등록한 글꼴로만 글자를 그려서 빠진 글자는 네모로 나온다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import { PROJECT } from "../../src/infra/project-paths.ts";
import { formatSpan } from "../../src/ui/format.ts";
import { FONTS, fontPath } from "../../src/ui/system-card/fonts.ts";
import { CARD_ICONS, STATUS_ICONS } from "../../src/ui/system-card/icons.ts";
import * as T from "../../src/ui/text/ko/system-card.ts";

// 이미지 밖(디스코드 메시지)에 쓰는 문구
const OUTSIDE = new Set(["title", "updated", "cardAlt", "historyAlt"]);

// 이미지에 들어갈 수 있는 문자열: 문구표(숫자와 값은 1), 업타임(모든 단위), 길이를 미리 알 수 없는 문자열(CPU 모델, 드라이브 이름)이 쓰는 출력 가능한 ASCII 와 말줄임표
function cardTexts() {
  const table = Object.entries(T)
    .filter(([key]) => !OUTSIDE.has(key))
    .map(([, value]) => (typeof value === "function" ? (value as (...args: number[]) => string)(1, 1, 1) : value));
  const ascii = String.fromCharCode(...Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => 0x20 + i));
  return [...table, formatSpan(90061), formatSpan(3661, { withSeconds: true }), ascii, "…"];
}

test("이미지에 들어갈 수 있는 글자는 등록한 글꼴 중 하나에 있다", () => {
  const fonts = FONTS.map((one) => fontkit.openSync(fontPath(one.file)) as fontkit.Font);
  const chars = [...new Set(cardTexts().join(""))].filter((ch) => ch.trim());
  const missing = chars.filter((ch) => !fonts.some((font) => font.hasGlyphForCodePoint(ch.codePointAt(0)!)));
  assert.deepEqual(missing, []);
});

test("카드 아이콘의 윤곽이 data/discord-icons/system-card.json 에 있다(빠지면 scripts/build-discord-icons.ts 를 다시 돌린다)", () => {
  const data = JSON.parse(fs.readFileSync(path.join(PROJECT.data, "discord-icons", "system-card.json"), "utf8")) as { line: Record<string, string>; fill: Record<string, string> };
  assert.deepEqual(Object.keys(data.line).sort(), [...CARD_ICONS].sort());
  assert.deepEqual(Object.keys(data.fill).sort(), [...STATUS_ICONS].sort());
});
