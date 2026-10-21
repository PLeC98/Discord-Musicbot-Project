// 로그인 배경의 정지 그림: 썸네일 단계(가장 작은 폭 하나와 대표색, 로그인 화면이 이것부터 건다)와 정지 그림 단계(나머지 폭). WebP 품질 95.
// 그림은 원본을 EXIF 방향대로 돌려 자르고, 영상은 운영자가 선택한 썸네일 장면(없으면 구간 시작)을 떠서 자른다.
// 색은 sRGB 로 적는다: ICC 프로필은 sharp 가 바꾸고, PNG 의 gAMA(sRGB · ICC 표시 없이 감마만 적힌 것)는 브라우저처럼 그 감마를 풀어 sRGB 로 다시 적는다(sharp 는 gAMA 를 보지 않는다).
// 영상에서 뜬 장면은 ffmpeg 에서 RGB 그대로 받는다(PNG 로 받으면 ffmpeg 가 gAMA 를 적어 어둡게 보인다). 대표색은 rules/art-seed(화면과 같은 계산)

import fs from "node:fs";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import { codedError } from "../../rules/error-kind.ts";
import { hexOfSeed, SEED_SIDE, seedOfPixels } from "../../rules/art-seed.ts";
import { ffmpeg } from "./ffmpeg.ts";
import type { StageJob, StageResult } from "./runner.ts";
import * as store from "./store.ts";
import { cropped, scaleTo, seekArgs, sourceFilter, squareCrop, stillWidths, TRANSPARENT_FILL } from "./ladder.ts";
import { MAX_PIXELS, probeVideo, READ_ARGS, type Probed } from "./source.ts";
import type { LoginBackgroundCrop } from "../contract/login-background.ts";

/** 정지 그림 WebP 품질 */
const QUALITY = 95;
/** 대표색에 쓰는 장면 간격(초) · 장면 수 상한 */
const COLOR_EVERY = 5;
const COLOR_FRAMES = 20;

/** 정지 그림 파일(공개 주소 /login-background/:id/still-<폭>.webp) */
const stillFile = (id: string, width: number) => path.join(store.folderOf(id), `still-${width}.webp`);

/** PNG 의 gAMA(1/감마, 없거나 sRGB · ICC 표시가 있으면 null). 그림 자료(IDAT) 앞의 청크만 본다 */
function pngGamma(file: string): number | null {
  const head = Buffer.alloc(64 * 1024);
  const fd = fs.openSync(file, "r");
  const read = (() => {
    try {
      return fs.readSync(fd, head, 0, head.length, 0);
    } finally {
      fs.closeSync(fd);
    }
  })();
  if (head.toString("latin1", 1, 4) !== "PNG") return null;
  let gamma: number | null = null;
  for (let at = 8; at + 8 <= read;) {
    const length = head.readUInt32BE(at);
    const type = head.toString("latin1", at + 4, at + 8);
    if (type === "IDAT") break;
    if (type === "sRGB" || type === "iCCP") return null;
    if (type === "gAMA" && at + 12 <= read) gamma = head.readUInt32BE(at + 8) / 100000;
    at += 12 + length;
  }
  return gamma && gamma > 0 ? gamma : null;
}

/** 감마 g(파일에 적힌 1/감마)로 적힌 값 → sRGB 로 적은 값(0 ~ 255 표) */
function gammaToSrgb(gamma: number): Uint8Array {
  const encode = (linear: number) => (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055);
  return Uint8Array.from({ length: 256 }, (_, v) => Math.round(Math.min(1, Math.max(0, encode((v / 255) ** (1 / gamma)))) * 255));
}

/** sharp 파이프라인 끝에 표를 건다(RGB 로 풀어 바꾸고 다시 싼다) */
async function withLut(image: Sharp, lut: Uint8Array | null): Promise<Sharp> {
  if (!lut) return image;
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i++) data[i] = lut[data[i]];
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
}

/** 그림 배경: 돌리고 자르고 투명은 검정으로 채운 원본(폭을 줄이기 전), 그 크기와 감마 표 */
async function croppedImage(item: Readonly<store.Stored>, crop: LoginBackgroundCrop) {
  const file = store.sourceOf(item.id);
  // 돌린 크기는 다운로드 단계가 적은 것(item.width · height)
  const area = { left: Math.round(item.width * crop.x), top: Math.round(item.height * crop.y), ...cropped(item.width, item.height, crop) };
  const image = sharp(file, { limitInputPixels: MAX_PIXELS }).autoOrient().extract(area).flatten({ background: TRANSPARENT_FILL });
  const gamma = pngGamma(file);
  return { image, width: area.width, height: area.height, lut: gamma ? gammaToSrgb(gamma) : null };
}

/** 영상의 한 장면(RGB 또는 RGBA)을 그 크기로 뜬다 */
type Frame = { source: string; probed: Probed; at: number; crop: LoginBackgroundCrop; size: { width: number; height: number }; channels: 3 | 4 };
async function frameAt({ source, probed, at, crop, size, channels }: Frame, signal: AbortSignal): Promise<Buffer> {
  const span = { from: Number(at.toFixed(3)), to: null };
  const graph = `${sourceFilter(probed, crop, span)},${scaleTo(size, channels === 4 ? "rgba" : "rgb24")}[o]`;
  const run = await ffmpeg(["-v", "error", ...seekArgs(probed, span), ...READ_ARGS, "-i", source, "-filter_complex", graph, "-map", "[o]", "-frames:v", "1", "-f", "rawvideo", "-"], { signal, timeoutMs: 600_000 });
  if (run.aborted) throw codedError("aborted", "그만뒀습니다");
  const bytes = size.width * size.height * channels;
  if (run.code !== 0 || run.output.length < bytes) throw codedError("background-failed", `장면을 뜨지 못했습니다(${at}초): ${run.stderr.split("\n").filter(Boolean).at(-1) ?? ""}`);
  return run.output.subarray(0, bytes);
}

/** 영상 배경: 썸네일 장면(선택한 장면, 없으면 구간 시작)을 자른 크기 그대로 */
async function thumbFrame(item: Readonly<store.Stored>, signal: AbortSignal) {
  const edit = item.edit!;
  const source = store.sourceOf(item.id);
  const probed = await probeVideo(source, signal);
  const size = cropped(probed.width, probed.height, edit.crop);
  const even = { width: Math.max(2, size.width - (size.width % 2)), height: Math.max(2, size.height - (size.height % 2)) };
  const at = edit.thumbAt ?? edit.range?.[0] ?? 0;
  const data = await frameAt({ source, probed, at, crop: edit.crop, size: even, channels: 3 }, signal);
  return { image: sharp(data, { raw: { width: even.width, height: even.height, channels: 3 } }), width: even.width, height: even.height, lut: null, probed };
}

/** 정지 그림 하나를 그 폭으로 쓴다 */
async function writeStill(id: string, base: { image: Sharp; width: number; lut: Uint8Array | null }, width: number) {
  const resized = base.image.clone().resize({ width: Math.min(width, base.width), kernel: "lanczos3" });
  const file = stillFile(id, width);
  await (await withLut(resized, base.lut)).webp({ quality: QUALITY }).toFile(`${file}.part`);
  fs.renameSync(`${file}.part`, file);
}

/** 대표색: 그림은 자른 그림에서, 영상은 구간에서 5초마다 뜬 장면(최대 20장)을 모아서 */
async function colorOf(item: Readonly<store.Stored>, base: { image: Sharp; lut: Uint8Array | null; probed?: Probed }, signal: AbortSignal): Promise<string | null> {
  const small = { width: SEED_SIDE, height: SEED_SIDE };
  if (!base.probed) {
    const { data } = await (await withLut(base.image.clone().resize(small.width, small.height, { fit: "cover" }), base.lut)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return hexOfSeed(seedOfPixels(data));
  }
  const [from, to] = item.edit!.range ?? [0, item.duration];
  const count = Math.min(COLOR_FRAMES, Math.max(1, Math.floor((to - from) / COLOR_EVERY)));
  const frames: Buffer[] = [];
  const square = squareCrop(base.probed.width, base.probed.height, item.edit!.crop);
  for (let i = 0; i < count; i++) frames.push(await frameAt({ source: store.sourceOf(item.id), probed: base.probed, at: from + ((i + 0.5) * (to - from)) / count, crop: square, size: small, channels: 4 }, signal));
  return hexOfSeed(seedOfPixels(Buffer.concat(frames)));
}

const baseOf = (item: Readonly<store.Stored>, signal: AbortSignal) => (item.kind === "image" ? croppedImage(item, item.edit!.crop) : thumbFrame(item, signal));

/** 썸네일 단계: 가장 작은 폭 하나와 대표색(이것이 생기면 로그인 화면이 이 배경으로 넘어간다) */
async function thumb({ item, signal }: StageJob): Promise<StageResult> {
  const base = await baseOf(item, signal);
  const [first] = stillWidths(base.width);
  await writeStill(item.id, base, first);
  return { media: { ...item.media, stills: [first], color: await colorOf(item, base, signal) } };
}

/** 정지 그림 단계: 나머지 폭 */
async function stills({ item, signal, progress }: StageJob): Promise<StageResult> {
  const base = await baseOf(item, signal);
  const widths = stillWidths(base.width);
  for (const [i, width] of widths.entries()) {
    if (!item.media.stills.includes(width)) await writeStill(item.id, base, width);
    progress((i + 1) / widths.length);
  }
  return { media: { ...item.media, stills: widths } };
}

export { thumb, stills, stillFile, pngGamma, gammaToSrgb, frameAt };
