// src/rules/clip-text.ts: 디스코드 글자 상한과 화면 폭에 맞춰 자른다. 글자 묶음을 가르지 않고 UTF-16 길이, 화면 폭 상한을 넘지 않는다

import { test } from "node:test";
import assert from "node:assert/strict";
import { clipText, clipWidth, displayWidth, graphemeLength } from "../../src/rules/clip-text.ts";

test("상한 안이면 그대로, 넘으면 … 를 붙여 상한(UTF-16 길이)에 맞춘다", () => {
  assert.equal(clipText("짧은 제목", 100), "짧은 제목");
  const long = "가".repeat(150);
  assert.equal(clipText(long, 100), `${"가".repeat(99)}…`);
  assert.equal(clipText(long, 100).length, 100);
});

test("이모지, 결합 문자는 반으로 가르지 않는다", () => {
  const flags = "🇰🇷".repeat(60); // 국기 하나가 UTF-16 4칸
  const clipped = clipText(flags, 100);
  assert.ok(clipped.length <= 100);
  assert.equal(clipped, `${"🇰🇷".repeat(24)}…`);
  const family = "👨‍👩‍👧".repeat(20);
  assert.ok(clipText(family, 30).startsWith("👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧…"));
});

test("글자 묶음 수", () => {
  assert.equal(graphemeLength("아이유"), 3);
  assert.equal(graphemeLength("🇰🇷a"), 2);
  assert.equal(graphemeLength(""), 0);
});

test("화면 폭: 한글, 한자, 가나, 전각, 이모지는 2, 나머지는 1", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("가나"), 4);
  assert.equal(displayWidth("漢かカ"), 6);
  assert.equal(displayWidth("Ａ！"), 4);
  assert.equal(displayWidth("👨‍👩‍👧a"), 3);
});

test("화면 폭 자르기: 폭 이하면 그대로, 넘으면 폭 - 2까지 남기고 …를 붙인다", () => {
  assert.equal(clipWidth("가".repeat(39), 78), "가".repeat(39));
  assert.equal(clipWidth("가".repeat(40), 78), `${"가".repeat(38)}…`);
  assert.equal(clipWidth("a".repeat(79), 78), `${"a".repeat(76)}…`);
  // 남는 폭이 1이면 넓은 글자는 넣지 않는다
  assert.equal(clipWidth(`a${"가".repeat(40)}`, 78), `a${"가".repeat(37)}…`);
  assert.equal(clipWidth("👨‍👩‍👧".repeat(10), 9), "👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧…");
});
