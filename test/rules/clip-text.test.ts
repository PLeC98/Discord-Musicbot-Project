// src/rules/clip-text.ts: 디스코드 글자 상한에 맞춘 자르기. 글자 묶음이 갈리지 않고 UTF-16 길이로 상한을 넘지 않는다

import { test } from "node:test";
import assert from "node:assert/strict";
import { clipText, graphemeLength } from "../../src/rules/clip-text.ts";

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
