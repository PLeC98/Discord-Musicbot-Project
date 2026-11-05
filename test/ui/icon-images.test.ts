// src/ui/icon-images.ts: 앱 이모지 이미지(타일, 기호, 움직이는 GIF). 같은 입력이면 같은 바이트

import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { withConfig } from "../helpers/config.ts";
import { ICONS } from "../../src/ui/icons.ts";
import { imageOf, SIZE } from "../../src/ui/icon-images.ts";

// 이미지의 한 점(RGBA)
async function pixel(data: Buffer, x: number, y: number) {
  const { data: raw, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * 4;
  return [...raw.subarray(at, at + 4)];
}

test("같은 입력이면 같은 바이트(맞추기가 디스코드에 올라간 것과 바이트로 견준다)", async () => {
  const a = await imageOf(ICONS.pause, "brand");
  const b = await imageOf(ICONS.pause, "brand");
  assert.ok(a.data.equals(b.data));
  assert.equal(a.animated, false);
  const meta = await sharp(a.data).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["png", SIZE, SIZE]);
});

test("타일은 바탕색에서 뽑은 톤 40: 운영자 색, 응답 색, 바탕색이 다르면 다른 그림", () =>
  withConfig({ bot: { embedColor: "#2743D2" } }, async () => {
    // 모서리를 피한 가장자리(타일 바탕)
    assert.deepEqual(await pixel((await imageOf(ICONS.pause, "brand")).data, 64, 4), [0x52, 0x5b, 0x92, 255]);
    assert.deepEqual(await pixel((await imageOf(ICONS.failed, "error")).data, 64, 4), [0x90, 0x4a, 0x47, 255]);
    const other = await withConfig({ bot: { embedColor: "#FF0000" } }, () => imageOf(ICONS.pause, "brand"));
    assert.ok(!other.data.equals((await imageOf(ICONS.pause, "brand")).data));
  }));

test("흰 기호(색 버튼)는 타일이 없다: 모서리가 투명하고 기호는 흰색", async () => {
  const { data } = await imageOf(ICONS.stop, "brand");
  assert.equal((await pixel(data, 2, 2))[3], 0);
  assert.deepEqual(await pixel(data, 64, 64), [255, 255, 255, 255]);
});

test("SponsorBlock 방패도 그린다(가운데가 바탕이 아니다)", async () => {
  const { data } = await imageOf(ICONS.highlight, "brand");
  assert.notDeepEqual(await pixel(data, 64, 30), await pixel(data, 64, 4));
});

test("도는 것은 움직이는 GIF: 24장, 장마다 50ms", async () => {
  const { data, animated } = await imageOf(ICONS.progress, "brand");
  assert.equal(animated, true);
  const meta = await sharp(data, { animated: true }).metadata();
  assert.equal(meta.format, "gif");
  assert.equal(meta.pages, 24);
  assert.deepEqual(new Set(meta.delay), new Set([50]));
});

test("로고는 브랜드 색 타일 위의 흰 아이콘이다. 운영자 색을 따르지 않고 같은 입력이면 같은 바이트", () =>
  withConfig({ bot: { embedColor: "#2743D2" } }, async () => {
    const youtube = (await imageOf(ICONS.youtube, "brand")).data;
    assert.equal((await pixel(youtube, 1, 1))[3], 0, "둥근 모서리 밖은 투명");
    assert.deepEqual(await pixel(youtube, 64, 4), [0xff, 0x00, 0x33, 255], "가장자리는 유튜브 빨강");
    assert.deepEqual(await pixel(youtube, 40, 64), [255, 255, 255, 255], "아이콘의 흰 부분");
    const spotify = (await imageOf(ICONS.spotify, "brand")).data;
    assert.deepEqual(await pixel(spotify, 64, 4), [0x1e, 0xd7, 0x60, 255], "가장자리는 스포티파이 초록");
    const other = await withConfig({ bot: { embedColor: "#FF0000" } }, () => imageOf(ICONS.youtube, "brand"));
    assert.ok(other.data.equals(youtube));
    assert.ok((await imageOf(ICONS.spotify, "brand")).data.equals(spotify));
  }));
