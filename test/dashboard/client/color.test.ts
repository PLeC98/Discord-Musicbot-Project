// dashboard/src/utils/color.ts — 색 고르기의 HSV ↔ #RRGGBB

import { test } from "node:test";
import assert from "node:assert/strict";
import { hexToHsv, hsvToHex, isHex } from "../../../dashboard/src/utils/color.ts";

test("#RRGGBB 를 HSV 로 갔다 오면 같은 색(대문자)", () => {
  for (const hex of ["#2743D2", "#000000", "#FFFFFF", "#808080", "#FF0000", "#00FF00", "#0000FF", "#F1C40F", "#123456", "#fedcba"]) assert.equal(hsvToHex(hexToHsv(hex)), hex.toUpperCase(), hex);
});

test("HSV 는 색상 · 채도 · 밝기", () => {
  assert.deepEqual(hexToHsv("#FF0000"), { h: 0, s: 1, v: 1 });
  assert.deepEqual(hexToHsv("#00FF00"), { h: 120, s: 1, v: 1 });
  assert.deepEqual(hexToHsv("#0000FF"), { h: 240, s: 1, v: 1 });
  assert.deepEqual(hexToHsv("#FF00FF"), { h: 300, s: 1, v: 1 });
  assert.deepEqual(hexToHsv("#000000"), { h: 0, s: 0, v: 0 }, "검정은 색상 · 채도가 없다");
  assert.deepEqual(hexToHsv("#FFFFFF"), { h: 0, s: 0, v: 1 });
});

test("채도나 밝기가 0 이면 색상과 무관하게 같은 색", () => {
  assert.equal(hsvToHex({ h: 200, s: 0, v: 0.5 }), "#808080");
  assert.equal(hsvToHex({ h: 77, s: 1, v: 0 }), "#000000");
  assert.equal(hsvToHex({ h: 359.9, s: 1, v: 1 }), "#FF0000", "끝은 빨강으로 돈다");
});

test("#RRGGBB 꼴만 색으로 본다", () => {
  assert.ok(isHex("#2743d2"));
  for (const bad of ["", "2743D2", "#2743D", "#2743D2F", "#GGGGGG", " #2743D2"]) assert.equal(isHex(bad), false, bad);
});
