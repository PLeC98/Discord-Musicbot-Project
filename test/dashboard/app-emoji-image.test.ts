// src/dashboard/app-emoji-image.ts: 올린 그림으로 앱 이모지 만들기(돌리고, 뒤집고, 정사각형으로 자르고, 128px).
// 방향은 귀퉁이 색으로 본다: 원본은 왼쪽 위 40×40 만 빨갛고 나머지는 파랗다

import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { makeEmojiImage, EMOJI_SIZE, EMOJI_MAX_BYTES, MAX_FRAMES, type EmojiEdit } from "../../src/dashboard/app-emoji-image.ts";

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const marked = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } })
    .composite([{ input: { create: { width: 40, height: 40, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }, left: 0, top: 0 }])
    .png()
    .toBuffer();

/** 결과 첫 프레임의 한 점 색(RGB) */
async function colorAt(image: Buffer, x: number, y: number) {
  const { data, info } = await sharp(image, { page: 0 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at], data[at + 1], data[at + 2]];
}
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 40);
const edit = (over: Partial<EmojiEdit>): EmojiEdit => ({ rotate: 0, flip: false, left: 0, top: 0, side: 100, ...over });

test("자르기만: 128px PNG, 왼쪽 위가 빨갛다", async () => {
  const out = await makeEmojiImage(await marked(200, 100), edit({}));
  assert.equal(out.format, "png");
  assert.equal(out.animated, false);
  const meta = await sharp(out.data).metadata();
  assert.deepEqual([meta.width, meta.height], [EMOJI_SIZE, EMOJI_SIZE]);
  assert.ok(near(await colorAt(out.data, 5, 5), RED));
  assert.ok(near(await colorAt(out.data, 120, 120), BLUE));
});

test("90도 돌리면 빨강이 오른쪽 위로, 돌린 뒤 뒤집으면 다시 왼쪽 위로(돌린 이미지 위에서 자른다)", async () => {
  const source = await marked(200, 100);
  const turned = await makeEmojiImage(source, edit({ rotate: 90 }));
  assert.ok(near(await colorAt(turned.data, 120, 5), RED));
  assert.ok(near(await colorAt(turned.data, 5, 5), BLUE));
  const flipped = await makeEmojiImage(source, edit({ rotate: 90, flip: true }));
  assert.ok(near(await colorAt(flipped.data, 5, 5), RED));
  assert.ok(near(await colorAt(flipped.data, 120, 5), BLUE));
});

test("자를 영역이 돌린 이미지 밖이면 거절", async () => {
  // 90도 돌리면 100×200 이라 왼쪽 150 은 밖이다
  await assert.rejects(makeEmojiImage(await marked(200, 100), edit({ rotate: 90, left: 150 })), { code: "EMOJI_EDIT" });
});

test("움직이는 그림: 프레임마다 같은 편집, 프레임 수와 지연, 반복이 그대로", async () => {
  const colors = [RED, [0, 255, 0], BLUE];
  const frames = await Promise.all(
    colors.map(([r, g, b]) =>
      sharp({ create: { width: 100, height: 100, channels: 4, background: { r, g, b, alpha: 1 } } })
        .raw()
        .toBuffer(),
    ),
  );
  const gif = await sharp(Buffer.concat(frames), { raw: { width: 100, height: 300, channels: 4, pageHeight: 100 } })
    .gif({ delay: [100, 200, 300], loop: 0 })
    .toBuffer();
  const out = await makeEmojiImage(gif, edit({ rotate: 270, flip: true }));
  assert.equal(out.format, "gif");
  const meta = await sharp(out.data, { animated: true }).metadata();
  assert.equal(meta.pages, 3);
  assert.deepEqual(meta.delay, [100, 200, 300]);
  assert.equal(meta.loop, 0);
  const third = await sharp(out.data, { page: 2 }).ensureAlpha().raw().toBuffer();
  assert.ok(near([third[0], third[1], third[2]], BLUE), "세 번째 프레임은 파랗다");
});

test("디스코드 한도(256KiB)를 넘으면 거절한다", async () => {
  // 잡음 프레임은 압축되지 않아 GIF, WebP 모두 한도를 넘는다
  const count = 120;
  const noise = Buffer.alloc(128 * 128 * 4 * count);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
  const gif = await sharp(noise, { raw: { width: 128, height: 128 * count, channels: 4, pageHeight: 128 } })
    .gif()
    .toBuffer();
  await assert.rejects(makeEmojiImage(gif, edit({ side: 128 })), { code: "EMOJI_TOO_LARGE" });
  assert.ok(EMOJI_MAX_BYTES === 256 * 1024);
});

test("프레임이 너무 많으면 만들기 전에 거절한다", async () => {
  const count = MAX_FRAMES + 1;
  // 비슷한 프레임은 GIF 인코더가 합치므로 프레임마다 흰 점 하나를 다른 자리에(검은 20×20)
  const side = 20;
  const frames = Buffer.alloc(side * side * 4 * count);
  for (let i = 0; i < count; i++) {
    const base = i * side * side * 4;
    for (let px = 0; px < side * side; px++) frames[base + px * 4 + 3] = 255;
    frames.fill(255, base + i * 4, base + i * 4 + 4);
  }
  const gif = await sharp(frames, { raw: { width: side, height: side * count, channels: 4, pageHeight: side } })
    .gif()
    .toBuffer();
  await assert.rejects(makeEmojiImage(gif, edit({ side })), { code: "EMOJI_IMAGE_TOO_BIG" });
});
