import test from "node:test";
import assert from "node:assert";
import { iconTones } from "../../src/rules/icon-tones.ts";

// 값은 디스코드에서 견주어 정한 것(톤 40 타일 · 톤 98 기호, 채도 36)
test("바탕색의 색상만 가져와 정한 톤으로: 운영자 색 기본값 · 응답 색", () => {
  assert.deepEqual(iconTones("#2743D2"), { tile: "#525b92", glyph: "#fbf8ff" });
  assert.deepEqual(iconTones("#ED4245"), { tile: "#904a47", glyph: "#fff8f7" });
  assert.deepEqual(iconTones("#FEE75C").tile, "#6a5f11");
  assert.deepEqual(iconTones("#57F287").tile, "#336940");
});

test("극단적인 바탕색도 같은 밝기: 순빨강 · 순파랑의 타일 톤이 같고, 무채색은 회색", () => {
  assert.deepEqual(iconTones("#000000"), iconTones("#FFFFFF"));
  assert.deepEqual(iconTones("#000000"), { tile: "#5e5e5e", glyph: "#f9f9f9" });
  assert.notEqual(iconTones("#FF0000").tile, iconTones("#0000FF").tile);
});
