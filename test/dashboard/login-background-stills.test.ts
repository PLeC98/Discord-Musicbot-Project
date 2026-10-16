// src/dashboard/login-background/stills.ts · tones.ts · rules/art-seed.ts — 썸네일 · 정지 그림(폭별 WebP, sRGB) · 대표색 · 장면 바뀜과 장면 색.
// 실제 ffmpeg 로 표본을 만든다(없으면 건너뛴다)

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import sharp from "sharp";
import { ffmpegPath } from "../../src/media/ffmpeg/path.ts";
import { runFfmpeg } from "../../src/media/ffmpeg/job.ts";
import { COLORLESS, hexOfSeed, seedOfPixels } from "../../src/rules/art-seed.ts";
import * as store from "../../src/dashboard/login-background/store.ts";
import { inspectSource } from "../../src/dashboard/login-background/source.ts";
import { gammaToSrgb, pngGamma, stillFile, stills, thumb } from "../../src/dashboard/login-background/stills.ts";
import { cutsOf, tones } from "../../src/dashboard/login-background/tones.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "login-bg-stills-"));
const SAMPLES = fs.mkdtempSync(path.join(os.tmpdir(), "login-bg-stills-samples-"));
after(() => {
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
  fs.rmSync(SAMPLES, { recursive: true, force: true, maxRetries: 5 });
});
const BIN = (() => {
  try {
    return ffmpegPath();
  } catch {
    return null;
  }
})();
const opts = { skip: BIN ? false : "ffmpeg 바이너리 없음" };
const signal = new AbortController().signal;
const sample = (name: string) => path.join(SAMPLES, name);

/** PNG 의 IHDR 뒤에 덩어리 하나를 끼운다 */
function withChunk(png: Buffer, type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, "latin1"), data])));
  return Buffer.concat([png.subarray(0, 33), head, data, crc, png.subarray(33)]);
}
const gamma = (value: number) => {
  const data = Buffer.alloc(4);
  data.writeUInt32BE(value);
  return data;
};

before(async () => {
  store._useDir(DIR);
  const photo = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 30, g: 90, b: 200 } } })
    .png()
    .toBuffer();
  fs.writeFileSync(sample("photo.png"), photo);
  // 어두운 회색(20)에 감마 2.2 만 적힌 PNG: 브라우저는 sRGB 보다 어둡게 그린다
  const dark = await sharp({ create: { width: 1400, height: 800, channels: 3, background: { r: 20, g: 20, b: 20 } } })
    .png()
    .toBuffer();
  fs.writeFileSync(sample("gamma.png"), withChunk(dark, "gAMA", gamma(45455)));
  fs.writeFileSync(sample("gamma-srgb.png"), withChunk(withChunk(dark, "gAMA", gamma(45455)), "sRGB", Buffer.from([0])));
  if (!BIN) return;
  // 빨강 → 어두운 파랑 → 밝은 초록, 2초씩(장면 바뀜 둘. scene 점수는 밝기 차이를 크게 보므로 밝기가 다른 색으로)
  await runFfmpeg([...["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xd02020:s=1920x1080:r=30:d=2", "-f", "lavfi", "-i", "color=c=0x081860:s=1920x1080:r=30:d=2", "-f", "lavfi", "-i", "color=c=0x40e060:s=1920x1080:r=30:d=2"], ...["-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1[v]", "-map", "[v]", "-c:v", "mpeg4", "-q:v", "3", sample("cuts.mp4")]]);
});

/** 원본을 올리고 편집을 적용한 것처럼 */
async function applied(name: string, edit: store.Stored["edit"]) {
  const one = store.create({ kind: "video", from: "upload", name });
  fs.copyFileSync(sample(name), store.sourceOf(one.id));
  Object.assign(one, await inspectSource(store.sourceOf(one.id), signal), { edit });
  return one;
}
const job = (one: store.Stored) => ({ item: one, folder: store.folderOf(one.id), signal, progress: () => {} });
const FULL = { x: 0, y: 0, w: 1, h: 1 };
const pixel = async (file: string) => [...(await sharp(file).raw().toBuffer()).subarray(0, 3)];

test("대표색: 화면과 같은 셈(Celebi · Score). 무채색이면 COLORLESS(null)", () => {
  const solid = (r: number, g: number, b: number) => Array.from({ length: 40 * 40 }, () => [r, g, b, 255]).flat();
  assert.match(hexOfSeed(seedOfPixels(solid(30, 90, 200)))!, /^#[0-9a-f]{6}$/);
  assert.equal(seedOfPixels(solid(128, 128, 128)), COLORLESS);
  assert.equal(hexOfSeed(COLORLESS), null);
});

test("PNG 의 gAMA: 감마만 적혔으면 그 값, sRGB 표시가 있으면 보지 않는다. 감마 2.2 → sRGB 표는 어두운 쪽을 낮춘다", () => {
  assert.equal(pngGamma(sample("gamma.png")), 0.45455);
  assert.equal(pngGamma(sample("gamma-srgb.png")), null);
  assert.equal(pngGamma(sample("photo.png")), null);
  const lut = gammaToSrgb(0.45455);
  assert.deepEqual([lut[0], lut[255]], [0, 255]);
  assert.ok(lut[20] < 15 && Math.abs(lut[128] - 128) <= 3, `${lut[20]} · ${lut[128]}`);
});

test("그림: 썸네일은 가장 작은 폭과 대표색, 정지 그림은 원본 폭까지 나머지 폭. 크롭을 따른다", async () => {
  const one = await applied("photo.png", { crop: FULL, range: null, thumbAt: null });
  assert.equal(one.kind, "image");
  const first = await thumb(job(one));
  assert.deepEqual(first.media!.stills, [1280]);
  assert.match(first.media!.color!, /^#[0-9a-f]{6}$/);
  one.media = first.media!;
  const all = await stills(job(one));
  assert.deepEqual(all.media!.stills, [1280, 1920]);
  const meta = await sharp(stillFile(one.id, 1920)).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 1920, 960]);
  // 왼쪽 절반만: 1000 폭이라 원본 폭 하나
  const half = await applied("photo.png", { crop: { x: 0, y: 0, w: 0.5, h: 1 }, range: null, thumbAt: null });
  assert.deepEqual((await thumb(job(half))).media!.stills, [1000]);
});

test("그림: 감마만 적힌 PNG 는 sRGB 로 다시 적어 브라우저에서 보이던 만큼 어둡다", async () => {
  const one = await applied("gamma.png", { crop: FULL, range: null, thumbAt: null });
  await thumb(job(one));
  const [r] = await pixel(stillFile(one.id, 1280));
  assert.ok(r < 16, `어두운 회색 20 → ${r}`);
  const plain = await applied("gamma-srgb.png", { crop: FULL, range: null, thumbAt: null });
  await thumb(job(plain));
  assert.ok(Math.abs((await pixel(stillFile(plain.id, 1280)))[0] - 20) <= 2);
});

test("영상: 썸네일은 고른 장면(크롭), 대표색은 구간의 장면을 모아서", opts, async () => {
  const one = await applied("cuts.mp4", { crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, range: [0, 6], thumbAt: 3 });
  const result = await thumb(job(one));
  // 960 × 1080 으로 잘라 가장 작은 폭(원본 폭 960)
  assert.deepEqual(result.media!.stills, [960]);
  const [r, g, b] = await pixel(stillFile(one.id, 960));
  assert.ok(b > r && b > g, `3초는 파랑 장면: ${r},${g},${b}`);
  assert.match(result.media!.color!, /^#[0-9a-f]{6}$/);
});

test("장면 바뀜과 장면마다의 색(구간 처음부터 초)", opts, async () => {
  const one = await applied("cuts.mp4", { crop: FULL, range: [1, 6], thumbAt: null });
  const result = await tones(job(one));
  const scenes = result.media!.scenes;
  assert.equal(scenes.length, 3, JSON.stringify(scenes));
  assert.equal(scenes[0].at, 0);
  assert.ok(Math.abs(scenes[1].at - 1) < 0.1 && Math.abs(scenes[2].at - 3) < 0.1, JSON.stringify(scenes));
  assert.equal(new Set(scenes.map((one) => one.color)).size, 3);
});

test("장면 바뀜 고르기: 처음 · 끝 0.5초 안과 1초 안에 거듭 바뀐 것은 하나로", () => {
  assert.deepEqual(cutsOf([0.2, 1.5, 2.0, 2.4, 3.7, 9.8], 10), [1.5, 3.7]);
});
