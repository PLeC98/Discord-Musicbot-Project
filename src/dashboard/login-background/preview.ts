// 로그인 배경의 미리보기 단계: 편집 창이 띄울 미리보기와 세트 크기 어림(research §11.7).
// 영상은 원본을 한 번 풀어 둘로 나눠 480p H.264 미리보기를 쓰고, 같은 장면을 1080p AV1 preset 12 crf 40 으로 구워 버리며 패킷 크기만 받는다(framecrc, 디스크를 쓰지 않는다).
// 초마다의 크기에 미리 잰 세트 비율을 곱해 둔다(영상 다섯 중 넷이 ±2%, 하나 -20%). 크롭을 정하면 그 크롭 · 구간만 다시 센다(recount).
// 그림은 긴 변 1280 WebP 미리보기와, 가장 작은 폭을 실제로 구워 넓이 비율로 늘린 정지 그림 세트의 어림

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { codedError } from "../../rules/error-kind.ts";
import { ffmpeg } from "./ffmpeg.ts";
import type { Estimate, Stored } from "./store.ts";
import * as store from "./store.ts";
import type { Recounter, StageJob, StageResult } from "./runner.ts";
import { encoderFor, encodersReady } from "./encoders.ts";
import { MAX_PIXELS, probeVideo, READ_ARGS } from "./source.ts";
import { cropped, fitShort, scaleTo, sourceFilter, stillWidths, TRANSPARENT_FILL, UHD } from "./ladder.ts";
import type { LoginBackgroundCrop } from "../contract/login-background.ts";

/** 미리보기 · 어림의 짧은 변 */
const PREVIEW_SHORT = 480;
const PROBE_SHORT = 1080;
/** 그림 미리보기의 긴 변 */
const PREVIEW_LONG = 1280;
/** 세트(AV1 · VP9 단계)의 크기 / 어림의 크기. 4K 까지 · 1080p 만(영상 다섯의 중앙값 9.53 · 3.09, research §11.7) */
const SET_RATIO = { full: 9.5, fhd: 3.1 };
/** 세트를 굽는 시간 / 어림 시간. 영상 둘로 잰 거친 값에서 한 번 풀어 나누기(21 ~ 23% 빠름)를 뺐다 */
const SET_TIME = { full: 20, fhd: 7 };
/** H.264 720p 단계(2.5Mbps 고정)의 초당 크기 */
const H264_BYTES_PER_SECOND = 2_500_000 / 8;
/** 영상 썸네일 세트의 어림(품질 95 WebP 의 화소당 크기, research §11.7 이미지 품질) */
const STILL_BYTES_PER_PIXEL = 0.12;
/** H.264 미리보기의 인코더별 옵션(굽기의 720p 와 같은 방식) */
const PREVIEW_H264: Record<string, string[]> = {
  h264_nvenc: ["-preset", "p7", "-tune", "hq", "-rc", "vbr", "-b:v", "2200k", "-maxrate", "2200k", "-bufsize", "2200k", "-bf", "2"],
  libopenh264: ["-rc_mode", "bitrate", "-b:v", "2500k", "-qmin", "1", "-qmax", "51"],
};
const FULL: LoginBackgroundCrop = { x: 0, y: 0, w: 1, h: 1 };

const previewVideo = (id: string) => path.join(store.folderOf(id), "preview.mp4");
const previewImage = (id: string) => path.join(store.folderOf(id), "preview.webp");
/** 편집 창의 미리보기 파일(없으면 null) */
const previewOf = (id: string) => [previewVideo(id), previewImage(id)].find((file) => fs.existsSync(file)) ?? null;

/** 시간 상한: 원본 길이의 다섯 배에 5분(약한 서버에서도 미리보기는 실시간의 몇 배 안쪽) */
const limitFor = (seconds: number) => seconds * 5_000 + 300_000;

/** framecrc 의 패킷 크기를 초마다 더한다(장면이 없는 초는 0) */
function perSecondOf(framecrc: string): number[] {
  const tb = /#tb 0: (\d+)\/(\d+)/.exec(framecrc);
  const unit = tb ? Number(tb[1]) / Number(tb[2]) : 1 / 1000;
  const out: number[] = [];
  for (const line of framecrc.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [, , pts, , size] = line.split(",").map((value) => Number(value.trim()));
    const second = Math.floor(pts * unit);
    out[second] = (out[second] ?? 0) + size;
  }
  return Array.from(out, (bytes) => bytes ?? 0);
}

/** 어림 크기 → 세트 크기(초마다). 4K 단계가 있을 크기면 4K 까지의 비율 */
const toSet = (probe: number[], width: number, height: number) => probe.map((bytes) => Math.round(bytes * (Math.min(width, height) >= UHD ? SET_RATIO.full : SET_RATIO.fhd) + H264_BYTES_PER_SECOND));
const setTime = (width: number, height: number) => (Math.min(width, height) >= UHD ? SET_TIME.full : SET_TIME.fhd);
/** 정지 그림 세트(폭별)의 화소 수 · 크기 어림 */
const stillPixels = (width: number, height: number) => stillWidths(width).reduce((sum, w) => sum + w * Math.round((height * w) / width), 0);
const stillBytesOf = (width: number, height: number, perPixel = STILL_BYTES_PER_PIXEL) => Math.round(stillPixels(width, height) * perPixel);

/**
 * 어림을 잰 크기가 구울 원본보다 작을 때(유튜브: 480p 로 재고 고해상도로 굽는다) 어림 크기 · 시간에 곱할 몫. 1080p 로 줄인 넓이의 비로 어림한다(화소 수에 비례한다고 친다)
 */
function upscale(item: Readonly<Stored>, probed: { width: number; height: number }, crop: LoginBackgroundCrop): number {
  const area = (size: { width: number; height: number }) => size.width * size.height;
  const real = cropped(item.width, item.height, crop);
  const measured = cropped(probed.width, probed.height, crop);
  return Math.max(1, area(fitShort(real.width, real.height, PROBE_SHORT)) / area(fitShort(measured.width, measured.height, PROBE_SHORT)));
}

/** 어림을 굽는 갈래(AV1 이 SVT-AV1 일 때만, 아니면 어림을 건너뛴다) */
const probeOutput = (label: string) => ["-map", label, "-c:v", "libsvtav1", "-preset", "12", "-crf", "40", "-g", "60", "-f", "framecrc", "-"];
const canProbe = () => encoderFor("av1") === "libsvtav1";

async function previewOfImage(item: Readonly<Stored>): Promise<StageResult> {
  const image = sharp(store.sourceOf(item.id), { limitInputPixels: MAX_PIXELS }).autoOrient();
  const part = `${previewImage(item.id)}.part`;
  await image.clone().resize({ width: PREVIEW_LONG, height: PREVIEW_LONG, fit: "inside", withoutEnlargement: true }).flatten({ background: TRANSPARENT_FILL }).webp({ quality: 90 }).toFile(part);
  fs.renameSync(part, previewImage(item.id));
  // 가장 작은 폭을 실제 품질로 구워 화소당 크기를 재고, 나머지 폭은 넓이로 늘린다
  const first = stillWidths(item.width)[0];
  const sample = await image.clone().resize({ width: first }).flatten({ background: TRANSPARENT_FILL }).webp({ quality: 95 }).toBuffer();
  const perPixel = sample.length / (first * Math.round((item.height * first) / item.width));
  return { estimate: { perSecond: [], stillBytes: stillBytesOf(item.width, item.height, perPixel), crop: FULL, counted: null, encodeRatio: 0, rough: false } };
}

async function previewOfVideo(item: Readonly<Stored>, signal: AbortSignal, progress: (value: number) => void): Promise<StageResult> {
  await encodersReady();
  const h264 = encoderFor("h264");
  if (!h264) throw codedError("background-failed", "H.264 인코더가 없습니다");
  const source = store.sourceOf(item.id);
  const probed = await probeVideo(source, signal);
  const probe = canProbe();
  const view = fitShort(probed.width, probed.height, PREVIEW_SHORT);
  const measure = fitShort(probed.width, probed.height, PROBE_SHORT);
  const graph = `${sourceFilter(probed)},split=${probe ? 2 : 1}[a]${probe ? "[b]" : ""};[a]${scaleTo(view)}[p]${probe ? `;[b]${scaleTo(measure)}[e]` : ""}`;
  const part = `${previewVideo(item.id)}.part`;
  // 이어 하기: 끊긴 몫이 남아 있으면 ffmpeg 가 덮어쓰지 않는다
  fs.rmSync(part, { force: true });
  const started = Date.now();
  const run = await ffmpeg([...["-v", "error", "-progress", "pipe:2", "-nostats", ...READ_ARGS, "-i", source, "-filter_complex", graph, "-an", "-sn", "-dn"], ...["-map", "[p]", "-c:v", h264, ...(PREVIEW_H264[h264] ?? []), "-g", "60", "-movflags", "+faststart", "-f", "mp4", part], ...(probe ? probeOutput("[e]") : [])], {
    signal,
    timeoutMs: limitFor(item.duration),
    onStderrLine: (line) => {
      const time = /^out_time_us=(\d+)/.exec(line);
      if (time) progress(Number(time[1]) / 1e6 / item.duration);
    },
  });
  if (run.aborted) throw codedError("aborted", "그만뒀습니다");
  if (run.code !== 0) {
    fs.rmSync(part, { force: true });
    throw codedError("background-failed", `미리보기를 만들지 못했습니다: ${run.timedOut ? "시간 초과" : run.stderr.split("\n").filter(Boolean).slice(-3).join(" ")}`);
  }
  fs.renameSync(part, previewVideo(item.id));
  if (!probe) return {};
  const seconds = (Date.now() - started) / 1000;
  const scale = upscale(item, probed, FULL);
  const estimate: Estimate = {
    // 비율 · 정지 그림은 구울 원본의 크기로(유튜브는 480p 로 재고 고해상도로 굽는다)
    perSecond: toSet(
      perSecondOf(run.stdout).map((bytes) => bytes * scale),
      item.width,
      item.height,
    ),
    stillBytes: stillBytesOf(item.width, item.height),
    crop: FULL,
    counted: null,
    encodeRatio: (seconds / item.duration) * setTime(item.width, item.height) * scale,
    rough: item.from === "youtube",
  };
  return { estimate };
}

/** 미리보기 단계 */
async function preview({ item, signal, progress }: StageJob): Promise<StageResult> {
  return item.kind === "image" ? previewOfImage(item) : previewOfVideo(item, signal, progress);
}

/** 크기 어림 다시 세기: 그 크롭 · 구간만 구워 그 초의 크기를 바꾼다(영상만, 그림은 넓이로 다시 셈) */
const recount: Recounter = async ({ item, crop, range, signal }) => {
  const before = item.estimate;
  if (!before) throw codedError("background-failed", "어림이 없습니다");
  const size = cropped(item.width, item.height, crop);
  // 그림은 잰 화소당 크기 그대로 넓이만 다시 센다
  if (item.kind === "image") return { ...before, crop, stillBytes: stillBytesOf(size.width, size.height, before.stillBytes / stillPixels(item.width, item.height)) };
  if (!canProbe()) return before;
  const source = store.sourceOf(item.id);
  const probed = await probeVideo(source, signal);
  const [from, to] = range ?? [0, item.duration];
  const graph = `${sourceFilter(probed, crop)},${scaleTo(fitShort(size.width, size.height, PROBE_SHORT))}[e]`;
  const run = await ffmpeg(["-v", "error", "-ss", String(from), "-to", String(to), ...READ_ARGS, "-i", source, "-filter_complex", graph, "-an", ...probeOutput("[e]")], { signal, timeoutMs: limitFor(to - from) });
  if (run.code !== 0) throw codedError("background-failed", `어림을 다시 세지 못했습니다: ${run.stderr.split("\n").filter(Boolean).at(-1) ?? ""}`);
  // 이 구간의 초만 새 크롭의 크기로(구간 밖은 앞선 어림 그대로, 넓히면 화면이 다시 세게 한다)
  const scale = upscale(item, probed, crop);
  const counted = toSet(
    perSecondOf(run.stdout).map((bytes) => bytes * scale),
    size.width,
    size.height,
  );
  const perSecond = [...before.perSecond];
  counted.forEach((bytes, i) => (perSecond[Math.floor(from) + i] = bytes));
  return { ...before, perSecond, crop, counted: [from, to], stillBytes: stillBytesOf(size.width, size.height) };
};

export { preview, recount, previewOf, perSecondOf };
