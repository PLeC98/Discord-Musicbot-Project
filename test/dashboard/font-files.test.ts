// 화면 글꼴의 라이선스 조건(scripts/font-names.ts 와 그것으로 만든 dashboard/src/assets 의 글꼴).
// 셋 다 SIL OFL 1.1 이다. 조각마다 라이선스(name 13 · 14번)가 따라가야 하고, 예약 글꼴 이름(RFN)이 걸린 D2Coding 의 수정본은 그 이름을 쓸 수 없다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import { setNames, toSfnt, OFL_NAMES } from "../../scripts/font-names.ts";

const ASSETS = path.join(import.meta.dirname, "..", "..", "dashboard", "src", "assets");
const open = (data: Buffer) => fontkit.create(data) as fontkit.Font;
// @types/fontkit 은 name 표를 적지 않는다(fontkit 은 읽는다)
const names = (font: fontkit.Font) => (font as unknown as { name: { records: Record<string, Record<string, string> | undefined> } }).name.records;
const en = (font: fontkit.Font, key: string) => Object.values(names(font)[key] ?? {})[0];

/** sfnt 전체를 4바이트씩 더한 값. head 의 checkSumAdjustment 가 맞으면 0xB1B0AFBA */
function fontSum(font: Buffer) {
  let sum = 0;
  for (let i = 0; i < font.length; i += 4) sum = (sum + font.readUInt32BE(i)) >>> 0;
  return sum;
}

test("setNames: 고른 번호만 바꾸고 지우며, 나머지 이름 · 글자 · 체크섬은 맞다", async () => {
  const source = await toSfnt(fs.readFileSync(path.join(ASSETS, "material-symbols.woff2")));
  const before = open(source);
  const out = setNames(source, { 1: "Example Sans", 4: "Example Sans Regular", 6: "", ...OFL_NAMES });
  const after = open(out);
  assert.equal(en(after, "fontFamily"), "Example Sans");
  assert.equal(en(after, "fullName"), "Example Sans Regular");
  assert.equal(names(after).postscriptName, undefined, "빈 글은 그 번호를 지운다");
  assert.equal(en(after, "license"), OFL_NAMES[13]);
  assert.equal(en(after, "copyright"), en(before, "copyright"), "고르지 않은 번호는 그대로");
  assert.equal(after.numGlyphs, before.numGlyphs);
  assert.deepEqual(after.characterSet, before.characterSet);
  assert.equal(out.length % 4, 0);
  assert.equal(fontSum(out), 0xb1b0afba, "head 의 checkSumAdjustment");
});

test("setNames: 글꼴 하나(sfnt)가 아니면 거절한다", () => {
  assert.throws(() => setNames(fs.readFileSync(path.join(ASSETS, "material-symbols.woff2")), {}), /sfnt/);
});

/** 화면이 내주는 글꼴 파일 전부 */
const shipped = () =>
  ["mono", "google-sans-flex"]
    .flatMap((dir) =>
      fs
        .readdirSync(path.join(ASSETS, dir))
        .filter((f) => f.endsWith(".woff2"))
        .map((f) => path.join(ASSETS, dir, f)),
    )
    .concat(path.join(ASSETS, "material-symbols.woff2"));

test("내주는 글꼴은 조각마다 저작권 · 라이선스 설명 · 주소를 담는다(OFL FAQ 2.4)", () => {
  const missing = shipped().filter((file) => {
    const font = open(fs.readFileSync(file));
    return !en(font, "copyright") || en(font, "license") !== OFL_NAMES[13] || en(font, "licenseURL") !== OFL_NAMES[14];
  });
  assert.deepEqual(missing, []);
  for (const license of ["mono/OFL.txt", "google-sans-flex/OFL.txt", "material-symbols-OFL.txt"]) assert.ok(fs.existsSync(path.join(ASSETS, license)), `${license} 가 글꼴 옆에 있다`);
});

test("D2Coding 의 수정본(고정폭 조각)은 예약 글꼴 이름을 저작권 줄 밖에서 쓰지 않는다(OFL 조건 3)", () => {
  const files = shipped().filter((file) => file.includes(`${path.sep}mono${path.sep}`));
  assert.ok(files.length > 0);
  const named = files.filter((file) =>
    Object.entries(names(open(fs.readFileSync(file))))
      .filter(([key]) => key !== "copyright")
      .some(([, value]) => /D2Coding/i.test(JSON.stringify(value))),
  );
  assert.deepEqual(named, []);
  assert.doesNotMatch(fs.readFileSync(path.join(ASSETS, "..", "mono.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), /D2Coding/i, "CSS 이름에도 쓰지 않는다(주석의 출처 표기는 된다)");
});
