// src/dashboard/app-emoji-font.ts: 앱 이모지 그림 글꼴(sbix, SVG). 표 구조는 fontkit 으로 다시 읽어 본다.
// 브라우저가 그리는지는 notes 의 실험 스크립트(ipad-test.mjs 의 /pua, /pick)로 손으로 본다

import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import * as fontkit from "fontkit";
import { buildEmojiFont } from "../../src/dashboard/app-emoji-font.ts";

const SIZE = 64;
const png = (r: number) =>
  sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r, g: 0, b: 0, alpha: 1 } } })
    .png()
    .toBuffer();
const glyphs = async () => [
  { codepoint: 0xf0001, png: await png(200) },
  { codepoint: 0xf0000, png: await png(100) },
];
const open = (data: Buffer) => fontkit.create(data) as fontkit.Font;
// @types/fontkit 은 표 목록을 적지 않는다(fontkit 은 읽는다)
const tables = (font: fontkit.Font) => (font as unknown as { directory: { tables: Record<string, { offset: number; length: number } | undefined> } }).directory.tables;

/** sfnt 전체를 4바이트씩 더한 값. head 의 checkSumAdjustment 가 맞으면 0xB1B0AFBA */
function fontSum(font: Buffer) {
  let sum = 0;
  for (let i = 0; i < font.length; i += 4) sum = (sum + font.readUInt32BE(i)) >>> 0;
  return sum;
}

test("문자마다 제 글리프, 1em 너비, 체크섬이 맞다", async () => {
  const data = buildEmojiFont("Example Emoji", await glyphs(), SIZE, "sbix");
  const font = open(data);
  assert.equal(font.unitsPerEm, 1024);
  assert.deepEqual(font.characterSet.sort(), [0xf0000, 0xf0001]);
  assert.equal(font.glyphForCodePoint(0xf0000).id, 1, "코드포인트 순서로");
  assert.equal(font.glyphForCodePoint(0xf0001).id, 2);
  assert.equal(font.glyphForCodePoint(0xf0000).advanceWidth, 1024);
  assert.equal(font.familyName, "Example Emoji");
  assert.equal(data.length % 4, 0);
  assert.equal(fontSum(data), 0xb1b0afba);
});

test("sbix: 글리프마다 그 PNG 가 그대로, 단계는 PNG 한 변", async () => {
  const list = await glyphs();
  const font = open(buildEmojiFont("Example Emoji", list, SIZE, "sbix"));
  const image = (font.glyphForCodePoint(0xf0000) as unknown as { getImageForSize(size: number): { type: string; data: Buffer } | null }).getImageForSize(SIZE);
  assert.equal(image?.type, "png ");
  assert.ok(image && Buffer.from(image.data).equals(list[1].png), "0xf0000 의 그림");
  assert.ok(!tables(font)["SVG "], "SVG 표는 넣지 않는다(사파리가 SVG 를 먼저 써 그리지 못한다)");
});

test("SVG: 글리프마다 문서 하나, PNG 를 data 주소로", async () => {
  const list = await glyphs();
  const data = buildEmojiFont("Example Emoji", list, SIZE, "svg");
  const font = open(data);
  const table = tables(font)["SVG "];
  assert.ok(table && !tables(font).sbix);
  const svg = data.subarray(table.offset, table.offset + table.length);
  const index = svg.readUInt32BE(2);
  assert.equal(svg.readUInt16BE(index), 2, "문서 수");
  const text = svg.toString("latin1");
  assert.match(text, /<g id="glyph1" transform="matrix\(16 0 0 16 0 -922\)">/);
  assert.ok(text.includes(list[1].png.toString("base64")), "glyph1 = 0xf0000 의 그림");
});
