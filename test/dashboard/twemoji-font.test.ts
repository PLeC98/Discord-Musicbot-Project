// dashboard/src/assets/twemoji, twemoji.css: 이모지 글꼴(Musicbot Twemoji, scripts/build-twemoji-font.ts 가 만든다)이 지켜야 할 것들.
// 글꼴은 파이썬으로 10분 넘게 만들어 CI 가 만들 수 없다. Twemoji 를 올리고 다시 만들지 않았거나, 뒤처리가 어긋나면 여기서 걸린다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import { EMOJI_GROUPS } from "../../dashboard/src/emoji-list.ts";
import { codepointsOf } from "../../scripts/unicode-range.ts";

const SRC = path.join(import.meta.dirname, "..", "..", "dashboard", "src");
const DIR = path.join(SRC, "assets", "twemoji");
const font = fontkit.create(fs.readFileSync(path.join(DIR, "twemoji.woff2"))) as fontkit.Font;
const css = fs.readFileSync(path.join(SRC, "twemoji.css"), "utf8");
const KEYCAP = /^[0-9#*]️?⃣$/u;

/** 그 글이 그려지는 글리프 수. 글리프가 없는 VS16(FE0F)은 세지 않는다(합자가 아닌 이모지 + FE0F 는 이모지 글리프 하나로 보인다) */
const glyphCount = (text: string) => font.layout(text).glyphs.filter((g) => !(g.codePoints.length === 1 && g.codePoints[0] === 0xfe0f)).length;

test("만든 정보의 Twemoji 버전이 대시보드가 고정한 버전과 같다", () => {
  // Dependabot 이 @discordapp/twemoji 를 올리면 여기서 걸린다. node scripts/build-twemoji-font.ts 로 다시 만든다
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, "..", "package.json"), "utf8")) as { devDependencies: Record<string, string> };
  const built = JSON.parse(fs.readFileSync(path.join(DIR, "build.json"), "utf8")) as { twemoji: string; emoji: string };
  assert.equal(built.twemoji, pkg.devDependencies["@discordapp/twemoji"], "scripts/build-twemoji-font.ts 를 다시 실행해야 한다");
  assert.equal(built.emoji, `${built.twemoji.split(".")[0]}.0`);
});

test("글자 문자와 키캡은 글꼴에 없다", () => {
  // 있으면 글꼴 목록 맨 앞에 둔 글꼴이 숫자, 공백, 기호를 이모지 글꼴 것으로 그린다
  const text = [0x20, 0x23, 0x2a, 0xa9, 0xae, 0x2122, 0x20e3, ...Array.from({ length: 10 }, (_, i) => 0x30 + i)];
  assert.deepEqual(
    text.filter((cp) => font.hasGlyphForCodePoint(cp)),
    [],
  );
  assert.ok(!font.characterSet.some((cp) => cp < 0x80), "ASCII 가 없다");
});

test("unicode-range 는 글꼴에 든 문자 그대로다", () => {
  const range = /unicode-range:\s*([^;]+);/.exec(css)?.[1];
  assert.ok(range, "twemoji.css 에 unicode-range 가 있다");
  assert.deepEqual(
    codepointsOf(range).sort((a, b) => a - b),
    [...font.characterSet].sort((a, b) => a - b),
  );
});

test("iOS 에서는 글꼴을 정의하지 않는다", () => {
  // 디스코드 iOS 앱처럼 기기 이모지를 쓴다. 정의가 없으면 글꼴 목록에서 건너뛰고 다운로드하지 않는다
  assert.match(css, /@supports not \(-webkit-touch-callout: none\)\s*\{\s*@font-face/);
});

test("선택 목록의 이모지는 키캡 말고 모두 글리프 하나로 그린다(VS16 이 든 형태, 뺀 형태 모두)", () => {
  // 엔진마다 찾는 형태가 달라(받은 그대로, VS16 을 뺀 형태) 둘 다 합자가 있어야 한 그림으로 보인다
  const split: string[] = [];
  for (const { emoji } of EMOJI_GROUPS) {
    for (const { char } of emoji) {
      if (KEYCAP.test(char)) continue;
      for (const form of new Set([char, char.replace(/️/gu, "")])) if (glyphCount(form) !== 1) split.push(form);
    }
  }
  assert.deepEqual(split, []);
});

test("VS16 이 일부만 든 형태도 한 글리프다", () => {
  // emoji-test.txt 의 minimally-qualified 형태. Twemoji 파일 이름(1f441-200d-1f5e8)은 VS16 이 없다
  assert.equal(glyphCount("\u{1F441}️‍\u{1F5E8}"), 1);
  assert.equal(glyphCount("\u{1F441}‍\u{1F5E8}️"), 1);
  assert.equal(glyphCount("\u{1F3F3}‍\u{1F308}"), 1);
});
