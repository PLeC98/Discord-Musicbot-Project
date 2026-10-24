// dashboard/src/utils/color.ts — 색 선택의 #RRGGBB ↔ RGB ↔ HSV

import { test } from "node:test";
import assert from "node:assert/strict";
import { hexToHsv, hexToRgb, hsvToHex, hsvToRgb, isHex, keepHue, parseHex, rgbToHex, rgbToHsv } from "../../../dashboard/src/utils/color.ts";

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

test("#RRGGBB 형식만 색으로 본다", () => {
  assert.ok(isHex("#2743d2"));
  for (const bad of ["", "2743D2", "#2743D", "#2743D2F", "#GGGGGG", " #2743D2"]) assert.equal(isHex(bad), false, bad);
});

test("입력한 HEX: # 은 없어도 되고 세 자리는 늘린다, 대문자로", () => {
  assert.equal(parseHex("#2743d2"), "#2743D2");
  assert.equal(parseHex(" 2743d2 "), "#2743D2");
  assert.equal(parseHex("#f0a"), "#FF00AA");
  assert.equal(parseHex("abc"), "#AABBCC");
  for (const bad of ["", "#", "#12", "#1234", "#2743D2F", "#GGGGGG"]) assert.equal(parseHex(bad), null, bad);
});

test("RGB 는 0~255, HEX · HSV 와 오간다", () => {
  assert.deepEqual(hexToRgb("#2743D2"), { r: 39, g: 67, b: 210 });
  assert.equal(rgbToHex({ r: 39, g: 67, b: 210 }), "#2743D2");
  assert.deepEqual(hsvToRgb(rgbToHsv({ r: 39, g: 67, b: 210 })), { r: 39, g: 67, b: 210 });
});

test("검정 · 무채색으로 가도 지금 색상(검정이면 채도도)을 남긴다", () => {
  const now = { h: 230, s: 0.8, v: 0.8 };
  assert.deepEqual(keepHue(hexToHsv("#000000"), now), { h: 230, s: 0.8, v: 0 });
  assert.deepEqual(keepHue(hexToHsv("#808080"), now), { h: 230, s: 0, v: 128 / 255 });
  assert.deepEqual(keepHue(hexToHsv("#FF0000"), now), { h: 0, s: 1, v: 1 }, "색이 있으면 새 색상");
});
