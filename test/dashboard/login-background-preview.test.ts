// src/dashboard/login-background/preview.ts — 편집 창의 미리보기와 세트 크기 어림. 실제 ffmpeg 로 돌린다(없으면 건너뛴다).
// 영상(보통 · 투명이 있는 GIF · HDR)은 480p 안쪽 H.264 미리보기와 초마다의 어림, 그림은 WebP 미리보기와 정지 그림 세트의 어림. 크롭을 정하면 그 구간만 다시 센다

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { ffmpegPath } from "../../src/media/ffmpeg/path.ts";
import { runFfmpeg } from "../../src/media/ffmpeg/job.ts";
import * as store from "../../src/dashboard/login-background/store.ts";
import * as encoders from "../../src/dashboard/login-background/encoders.ts";
import { inspectSource, probeVideo } from "../../src/dashboard/login-background/source.ts";
import { preview, previewOf, recount, perSecondOf } from "../../src/dashboard/login-background/preview.ts";
import { layoutOf, strip, stripOf } from "../../src/dashboard/login-background/strip.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "login-bg-preview-"));
const SAMPLES = fs.mkdtempSync(path.join(os.tmpdir(), "login-bg-samples-"));
after(() => {
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
  fs.rmSync(SAMPLES, { recursive: true, force: true, maxRetries: 5 });
});
const signal = new AbortController().signal;
const BIN = (() => {
  try {
    return ffmpegPath();
  } catch {
    return null;
  }
})();
const opts = { skip: BIN ? false : "ffmpeg 바이너리 없음" };

const sample = (name: string) => path.join(SAMPLES, name);
const lavfi = (source: string, args: string[]) => runFfmpeg(["-v", "error", "-y", "-f", "lavfi", "-i", source, "-t", "3", ...args]);

before(async () => {
  if (!BIN) return;
  store._useDir(DIR);
  encoders.startEncoderCheck();
  await encoders.encodersReady();
  await lavfi("testsrc2=size=1280x720:rate=60", ["-c:v", "mpeg4", "-q:v", "4", sample("clip.mp4")]);
  // 반투명한 GIF(투명한 곳은 검정으로 채운다)
  await lavfi("testsrc2=size=320x240:rate=10,format=rgba,colorchannelmixer=aa=0.5", ["-c:v", "gif", sample("alpha.gif")]);
  await lavfi("testsrc2=size=640x360:rate=30,format=yuv420p10le", ["-c:v", "libsvtav1", "-preset", "12", "-color_trc", "smpte2084", "-color_primaries", "bt2020", "-colorspace", "bt2020nc", sample("hdr.mp4")]);
  await sharp({ create: { width: 2000, height: 1000, channels: 4, background: { r: 20, g: 120, b: 220, alpha: 0.5 } } })
    .png()
    .toFile(sample("still.png"));
});

/** 원본을 올린 것처럼 기록을 만들고 받기 결과를 적는다 */
async function made(name: string) {
  const one = store.create({ kind: "video", from: "upload", name });
  fs.copyFileSync(sample(name), store.sourceOf(one.id));
  Object.assign(one, await inspectSource(store.sourceOf(one.id), signal));
  return one;
}
const run = async (one: store.Stored) => {
  const progress: number[] = [];
  const result = await preview({ item: one, folder: store.folderOf(one.id), signal, progress: (value) => progress.push(value) });
  return { result, progress };
};

test("영상: 원본보다 크게 만들지 않는 480p 미리보기(30fps 이하)와 초마다의 세트 어림", opts, async () => {
  const one = await made("clip.mp4");
  const { result, progress } = await run(one);
  const file = previewOf(one.id)!;
  assert.match(file, /preview\.mp4$/);
  const probed = await probeVideo(file, signal);
  assert.deepEqual([probed.width, probed.height, probed.fps], [854, 480, 30]);
  assert.ok(progress.length > 0 && progress.at(-1)! > 0.5, `진행 ${progress.at(-1)}`);
  if (encoders.encoderFor("av1") !== "libsvtav1") return;
  const estimate = result.estimate!;
  assert.equal(estimate.perSecond.length, 3);
  // 1080p 아래 원본: 1080p 세트 비율 + H.264 720p 2.5Mbps
  assert.ok(
    estimate.perSecond.every((bytes) => bytes > 2_500_000 / 8),
    JSON.stringify(estimate.perSecond),
  );
  assert.ok(estimate.encodeRatio > 0 && estimate.stillBytes > 0);
  assert.deepEqual([estimate.crop, estimate.counted, estimate.rough], [{ x: 0, y: 0, w: 1, h: 1 }, null, false]);
});

test("투명이 있는 GIF · HDR 영상도 미리보기를 만든다", opts, async () => {
  for (const name of ["alpha.gif", "hdr.mp4"]) {
    const one = await made(name);
    await run(one);
    const probed = await probeVideo(previewOf(one.id)!, signal);
    assert.deepEqual([probed.alpha, probed.hdr], [false, false], name);
  }
  // 투명한 곳은 검정 위에: 반투명한 시험 영상의 밝기가 절반 아래로
  const gif = store.items().find((one) => one.name === "alpha.gif")!;
  const frame = await runFfmpeg(["-v", "error", "-i", previewOf(gif.id)!, "-frames:v", "1", "-vf", "scale=1:1,format=gray", "-f", "rawvideo", "-"]);
  assert.ok(frame.output[0] < 140, `밝기 ${frame.output[0]}`);
});

test("그림: 긴 변 1280 WebP 미리보기(투명은 검정), 정지 그림 세트 어림. 크롭하면 넓이만큼", opts, async () => {
  const one = await made("still.png");
  assert.equal(one.kind, "image");
  const { result } = await run(one);
  const meta = await sharp(previewOf(one.id)!).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height, meta.hasAlpha], ["webp", 1280, 640, false]);
  one.estimate = result.estimate!;
  // 폭 2000: 1280 · 1920 두 장
  assert.ok(one.estimate.stillBytes > 0);
  const half = await recount({ item: one, folder: store.folderOf(one.id), crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, range: null, signal });
  assert.ok(half.stillBytes < one.estimate.stillBytes, `${half.stillBytes} < ${one.estimate.stillBytes}`);
});

test("다시 세기: 고른 구간의 초만 새 크롭으로 바꾸고 counted 에 적는다", opts, async () => {
  if (encoders.encoderFor("av1") !== "libsvtav1") return;
  const one = await made("clip.mp4");
  one.estimate = (await run(one)).result.estimate!;
  const next = await recount({ item: one, folder: store.folderOf(one.id), crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, range: [1, 2], signal });
  assert.deepEqual([next.counted, next.crop], [[1, 2], { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }]);
  assert.equal(next.perSecond[0], one.estimate.perSecond[0]);
  assert.equal(next.perSecond[2], one.estimate.perSecond[2]);
  assert.notEqual(next.perSecond[1], one.estimate.perSecond[1]);
});

test("framecrc 를 초마다 더한다(빈 초는 0)", () => {
  const framecrc = "#tb 0: 1/30\n#media_type 0: video\n0, 0, 0, 1, 100, 0x1\n0, 1, 1, 1, 50, 0x2\n0, 60, 60, 1, 7, 0x3\n";
  assert.deepEqual(perSecondOf(framecrc), [150, 0, 7]);
});

test("장면 띠: 0.5초 간격(최대 160장)으로 높이 128 장면을 10열 격자 WebP 한 장으로", opts, async () => {
  const one = await made("clip.mp4");
  await run(one);
  const result = await strip({ item: one, folder: store.folderOf(one.id), signal, progress: () => {} });
  // 3초: 6장 · 0.5초, 16:9 미리보기라 한 칸 228 × 128
  assert.deepEqual(result.strip, { count: 6, every: 0.5, columns: 10, width: 228, height: 128 });
  const meta = await sharp(stripOf(one.id)!).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 2280, 128]);
  assert.deepEqual(layoutOf(600, 854, 480), { count: 160, every: 3.75, columns: 10, width: 228, height: 128 });
});

test("이어 하기: 끊긴 미리보기 몫이 남아 있어도 다시 만든다", opts, async () => {
  const one = await made("clip.mp4");
  fs.writeFileSync(path.join(store.folderOf(one.id), "preview.mp4.part"), "끊긴 몫");
  await run(one);
  assert.match(previewOf(one.id)!, /preview\.mp4$/);
});

test("유튜브: 480p 로 재고 고해상도로 굽는 어림은 넓이 비만큼 키운다", opts, async () => {
  if (encoders.encoderFor("av1") !== "libsvtav1") return;
  const upload = await made("clip.mp4");
  const asUploaded = (await run(upload)).result.estimate!;
  const tube = await made("clip.mp4");
  // 고해상도로 받을 크기(4K)를 적은 유튜브 배경, 원본 자리에는 같은 720p 파일
  Object.assign(tube, { from: "youtube", width: 3840, height: 2160 });
  const asYoutube = (await run(tube)).result.estimate!;
  assert.equal(asYoutube.rough, true);
  const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
  assert.ok(sum(asYoutube.perSecond) > sum(asUploaded.perSecond) * 3, `${sum(asYoutube.perSecond)} > ${sum(asUploaded.perSecond)} × 3`);
});
