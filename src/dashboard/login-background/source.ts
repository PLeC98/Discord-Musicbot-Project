// 로그인 배경의 원본: 링크에서 받고(직접 링크는 infra/safe-url), 무엇인지 읽어 본다(받기 단계). 올린 파일의 Content-Type 은 믿지 않는다.
// 정지 그림은 sharp 로 읽고(픽셀 수 상한), 움직이는 것(영상 · 움짤)은 ffmpeg 로 읽는다. ffmpeg 에는 늘 READ_ARGS 를 붙인다:
// 재생 목록 · 이어 붙이기 목록처럼 다른 파일 · 주소를 읽는 형식을 막고(형식 거르기) 파일 말고는 열지 않는다(프로토콜 거르기).
// 터무니없는 값(작은 파일이 거대한 해상도를 적은 것 등)은 여기서 막는다

import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import { codedError, messageOf } from "../../rules/error-kind.ts";
import { ffmpeg } from "./ffmpeg.ts";
import * as safeUrl from "../../infra/safe-url.ts";
import type { StageJob, StageResult } from "./runner.ts";
import * as store from "./store.ts";

/** ffmpeg 가 읽어도 되는 형식(영상 컨테이너와 움직이는 그림). 다른 파일 · 주소를 읽는 형식(hls · concat · image2 등)은 뺀다 */
const FORMATS = ["mov", "matroska", "avi", "flv", "mpegts", "mpeg", "ogg", "asf", "gif", "webp_anim", "apng"];
/** 원본을 읽는 ffmpeg 에 늘 붙이는 것 */
const READ_ARGS = ["-protocol_whitelist", "file", "-format_whitelist", FORMATS.join(",")];
/** sharp 로 읽는 정지 그림 형식 */
const STILL_FORMATS = ["jpeg", "png", "webp", "gif", "avif", "heif", "tiff"];
/** 받는 크기 · 길이 · 초당 장면 수의 범위 */
const MIN_SIDE = 16;
const MAX_SIDE = 16384;
const MAX_FPS = 240;
/** sharp 가 읽는 픽셀 수 상한(16K × 12K 남짓) */
const MAX_PIXELS = 200_000_000;
/** 원본을 읽는 시간 상한 */
const INSPECT_MS = 60_000;
/** 링크에서 받을 것: 그림 · 영상(Content-Type 이 없으면 받아서 읽어 본다), 홉마다의 응답 대기 */
const LINK_TYPES = /^\s*(image\/|video\/|application\/octet-stream|binary\/octet-stream)/i;
const LINK_HOP_MS = 15_000;

// libvips 가 연 파일을 캐시에 쥐고 있으면 Windows 에서 배경 폴더를 지우지 못한다(EPERM). 파일 핸들 캐시만 끈다(연산 캐시는 그대로)
sharp.cache({ files: 0 });

/** 원본을 읽은 것 */
type Inspected = Required<Pick<StageResult, "kind" | "width" | "height" | "duration" | "fps">>;

const badSource = (why: string) => codedError("background-bad-source", why);
const sideOk = (side: number) => Number.isFinite(side) && side >= MIN_SIDE && side <= MAX_SIDE;

/** PNG 가 움직이는 것(APNG)인지: 그림 자료(IDAT) 앞에 acTL 덩어리가 있다. sharp 는 APNG 를 한 장으로 읽는다 */
function isApng(file: string): boolean {
  const head = Buffer.alloc(64 * 1024);
  const fd = fs.openSync(file, "r");
  try {
    const read = fs.readSync(fd, head, 0, head.length, 0);
    const text = head.subarray(0, read).toString("latin1");
    const actl = text.indexOf("acTL");
    return actl >= 0 && (text.indexOf("IDAT") < 0 || actl < text.indexOf("IDAT"));
  } finally {
    fs.closeSync(fd);
  }
}

/** 정지 그림이면 그 크기, 움직이는 그림 · 그림이 아니면 null */
async function inspectStill(file: string): Promise<Inspected | null> {
  const meta = await sharp(file, { pages: -1, limitInputPixels: MAX_PIXELS })
    .metadata()
    .catch(() => null);
  if (!meta?.format || !STILL_FORMATS.includes(meta.format)) return null;
  if ((meta.pages ?? 1) > 1 || (meta.format === "png" && isApng(file))) return null;
  // EXIF 방향을 따른 크기
  const { width, height } = meta.autoOrient;
  if (!sideOk(width) || !sideOk(height)) throw badSource(`그림 크기가 범위 밖입니다: ${width} × ${height}`);
  return { kind: "image", width, height, duration: 0, fps: 0 };
}

/**
 * ffmpeg 가 연 입력의 머리. 크기는 보이는 크기(90도 돌려 보이는 영상은 가로세로를 바꾼다), alpha 는 투명이 있는 픽셀 형식(움짤),
 * hdr 은 PQ · HLG 전달 함수(SDR 로 톤 매핑해 굽는다). 열지 못했으면 null
 */
type Probed = { format: string; duration: number | null; width: number; height: number; fps: number | null; alpha: boolean; hdr: boolean };

/** 영상 줄의 크기를 보이는 크기로(회전 정보가 90도면 가로세로를 바꾼다) */
function visibleSize(video: string, stderr: string) {
  const size = /, (\d{2,5})x(\d{2,5})[ ,[]/.exec(video);
  const [width, height] = [Number(size?.[1] ?? 0), Number(size?.[2] ?? 0)];
  const rotation = Number(/rotation of (-?[\d.]+) degrees/.exec(stderr)?.[1] ?? 0);
  return Math.abs(Math.round(rotation / 90)) % 2 === 1 ? { width: height, height: width } : { width, height };
}
function parseInput(stderr: string): Probed | null {
  const format = /Input #0, ([^ ]+), from/.exec(stderr)?.[1];
  const video = /Stream #0:\d+[^\n]*?: Video: [^\n]*/.exec(stderr)?.[0];
  if (!format || !video) return null;
  const fps = /, ([\d.]+) fps/.exec(video)?.[1] ?? /, ([\d.]+) tbr/.exec(video)?.[1];
  const time = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  return {
    format: format.replace(/,$/, ""),
    duration: time ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) : null,
    ...visibleSize(video, stderr),
    fps: fps ? Number(fps) : null,
    alpha: /\b(yuva\w*|rgba\w*|bgra|argb|abgr|ya\d+\w*|pal8|gbrap\w*)\b/.test(video),
    hdr: /smpte2084|arib-std-b67/.test(video),
  };
}

/** 영상 · 움직이는 그림의 머리를 읽는다. 읽지 못하면 background-bad-source */
async function probeVideo(file: string, signal: AbortSignal): Promise<Probed> {
  // 출력 없이 열기만 하면 머리를 적고 "출력이 없다"로 끝난다(끝난 코드는 보지 않는다)
  const { stderr, aborted } = await ffmpeg([...READ_ARGS, "-i", file], { signal, timeoutMs: INSPECT_MS });
  if (aborted) throw codedError("aborted", "그만뒀습니다");
  const input = parseInput(stderr);
  if (!input) throw badSource(`ffmpeg 가 영상으로 읽지 못했습니다: ${stderr.split("\n").filter(Boolean).at(-1) ?? ""}`);
  return input;
}

/** 길이를 적지 않은 입력(움직이는 WebP · APNG): 영상 패킷을 풀지 않고 세어 마지막 장면의 끝 */
async function countedDuration(file: string, signal: AbortSignal): Promise<number | null> {
  const { code, stdout } = await ffmpeg(["-v", "error", ...READ_ARGS, "-i", file, "-map", "0:v:0", "-c", "copy", "-f", "framecrc", "-"], { signal, timeoutMs: INSPECT_MS });
  if (code !== 0) return null;
  const tb = /#tb 0: (\d+)\/(\d+)/.exec(stdout);
  const last = stdout
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .at(-1)
    ?.split(",")
    .map((value) => Number(value.trim()));
  if (!tb || !last) return null;
  return ((last[2] + last[3]) * Number(tb[1])) / Number(tb[2]);
}

/** 영상 · 움직이는 그림 */
async function inspectMoving(file: string, signal: AbortSignal): Promise<Inspected> {
  const input = await probeVideo(file, signal);
  if (!sideOk(input.width) || !sideOk(input.height)) throw badSource(`영상 크기가 범위 밖입니다: ${input.width} × ${input.height}`);
  const fps = input.fps ?? 30;
  if (!(fps > 0 && fps <= MAX_FPS)) throw badSource(`초당 장면 수가 범위 밖입니다: ${fps}`);
  const duration = input.duration ?? (await countedDuration(file, signal));
  if (!duration || !Number.isFinite(duration) || duration <= 0) throw badSource("길이를 알 수 없습니다");
  // 장면이 하나뿐인 것(sharp 가 못 읽은 정지 그림이 영상 틀로 열린 것 등)은 영상이 아니다
  if (duration * fps < 1.5) throw badSource(`움직이는 장면이 없습니다(${duration}초)`);
  return { kind: "video", width: input.width, height: input.height, duration: Math.round(duration * 1000) / 1000, fps };
}

/** 원본이 무엇인지. 쓸 수 없으면 background-bad-source 를 던진다 */
async function inspectSource(file: string, signal: AbortSignal): Promise<Inspected> {
  return (await inspectStill(file)) ?? (await inspectMoving(file, signal));
}

/** 링크의 그림 · 영상을 받는다(내부 주소 · 리다이렉트 · 형식은 safe-url 이 막는다). room 을 넘으면 background-no-space */
async function download(url: string, file: string, room: number, signal: AbortSignal, deps?: safeUrl.RequestDeps) {
  const part = `${file}.part`;
  try {
    const body = await safeUrl.getStream(url, deps, { accept: { contentType: LINK_TYPES, maxBytes: room, timeoutMs: LINK_HOP_MS } });
    await pipeline(body, fs.createWriteStream(part), { signal });
    fs.renameSync(part, file);
  } catch (error) {
    fs.rmSync(part, { force: true });
    if (signal.aborted) throw error;
    if (/최대 크기/.test(messageOf(error))) throw codedError("background-no-space", `남은 공간을 넘는 파일입니다: ${messageOf(error)}`, { cause: error });
    throw codedError("background-link-failed", `링크에서 받지 못했습니다: ${messageOf(error)}`, { cause: error });
  }
}

/** 받기 단계: 링크면 받고, 원본을 읽어 종류 · 크기 · 길이를 적는다 */
async function receive({ item, signal }: StageJob): Promise<StageResult> {
  const file = store.sourceOf(item.id);
  if (item.from === "link" && item.link) await download(item.link, file, store.freeBytes() - store.SPACE_MARGIN, signal);
  if (!fs.existsSync(file)) throw codedError("background-failed", "원본이 없습니다");
  return inspectSource(file, signal);
}

export { receive, inspectSource, probeVideo, download, parseInput, READ_ARGS, FORMATS, MAX_PIXELS };
export type { Inspected, Probed };
