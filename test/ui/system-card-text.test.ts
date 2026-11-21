// src/ui/card-render/fonts.ts, icons.ts: /system 이미지의 글자와 아이콘이 그리는 데 쓰는 글꼴과 윤곽 파일에 다 있는지. 이미지는 등록한 글꼴로만 글자를 그려서 빠진 글자는 네모로 나온다.
// 모든 언어(테스트 언어 포함)를 검사한다. 다른 문자를 쓰는 언어를 추가했을 때 여기서 걸리면 글꼴 목록(FONTS)에 해당 글꼴을 추가한다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import { PROJECT } from "../../src/infra/project-paths.ts";
import { FONTS, fontPath } from "../../src/ui/card-render/fonts.ts";
import { CARD_ICONS, STATUS_ICONS } from "../../src/ui/card-render/icons.ts";
import { textFor } from "../../src/ui/text/index.ts";
import { sharedTextFor } from "../../src/ui/text/shared.ts";
import { LANGUAGES, TEST_LANGUAGE, infoOf, type Language } from "../../src/rules/languages.ts";

// 이미지 밖(디스코드 메시지)에 쓰는 문구
const OUTSIDE = new Set(["title", "versions", "updated", "panelLink", "drawing", "drawFailed", "cardAlt", "historyAlt"]);
const LANGUAGES_SEEN: Language[] = [...LANGUAGES.map((one) => one.tag), TEST_LANGUAGE];

// 이미지에 들어갈 수 있는 문자열: 해당 언어의 문구표(숫자와 값은 1), 업타임(모든 단위), 형식 로케일로 포맷한 숫자(천 단위 구분자, 숫자 모양),
// 길이를 미리 알 수 없는 문자열(CPU 모델, 드라이브 이름)이 쓰는 출력 가능한 ASCII와 말줄임표
function cardTexts(language: Language) {
  const T = sharedTextFor(language).systemCard;
  const table = Object.entries(T)
    .filter(([key]) => !OUTSIDE.has(key))
    .map(([, value]) => (typeof value === "function" ? (value as (...args: number[]) => string)(1, 1, 1) : value));
  const counts = [1234567, 2499, 0.5].map((n) => n.toLocaleString(infoOf(language).locale));
  const ascii = String.fromCharCode(...Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => 0x20 + i));
  return [...table, textFor(language).labels.span(90061), ...counts, ascii, "…"];
}

const fonts = FONTS.map((one) => fontkit.openSync(fontPath(one.file)) as fontkit.Font);
/** 등록한 글꼴 어디에도 없는 글자 */
const missingIn = (texts: string[]) => [...new Set(texts.join(""))].filter((ch) => ch.trim() && !fonts.some((font) => font.hasGlyphForCodePoint(ch.codePointAt(0)!)));

for (const language of LANGUAGES_SEEN) {
  test(`이미지에 들어갈 수 있는 글자는 등록한 글꼴 중 하나에 포함된다(${language})`, () => {
    assert.deepEqual(missingIn(cardTexts(language)), []);
  });
}

test("글꼴에 없는 글자는 걸린다(검사가 실제로 동작한다)", () => {
  // 정해 둔 문자가 나중에 글꼴에 포함되더라도 검사가 유효하도록, 등록한 글꼴 어디에도 없는 글자를 찾아 넣는다
  const absent = Array.from({ length: 0x3000 }, (_, i) => String.fromCodePoint(0x0400 + i)).find((ch) => missingIn([ch]).length === 1);
  assert.ok(absent, "등록한 글꼴에 없는 글자를 찾았다");
  assert.deepEqual(missingIn([...cardTexts(LANGUAGES_SEEN[0]), absent]), [absent]);
});

test("카드 아이콘의 윤곽이 data/discord-icons/card-icons.json 에 있다(빠지면 scripts/build-discord-icons.ts 를 다시 돌린다)", () => {
  const data = JSON.parse(fs.readFileSync(path.join(PROJECT.data, "discord-icons", "card-icons.json"), "utf8")) as { line: Record<string, string>; fill: Record<string, string> };
  assert.deepEqual(Object.keys(data.line).sort(), [...CARD_ICONS].sort());
  assert.deepEqual(Object.keys(data.fill).sort(), [...STATUS_ICONS].sort());
});
