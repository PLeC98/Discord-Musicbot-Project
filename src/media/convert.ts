import fs from "node:fs";
import { codedError } from "../rules/error-kind.ts";
import { pictureBlock } from "../rules/flac-picture.ts";
import type { TagInfo } from "../rules/track-tags.ts";
import type { Cover } from "../sources/cover.ts";
import { probeAudio } from "./ffmpeg/process.ts";
import { runFfmpeg, PROGRESS_ARGS } from "./ffmpeg/job.ts";
import { AUDIO_FORMATS, inputFilter } from "./ffmpeg/input-filter.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "track" });
import { planFor, REMUX_MAX_KBPS, REMUX_SLACK, TRANSCODE_TARGET_KBPS, type ConvertPlan } from "../rules/convert-plan.ts";

type Converted = ConvertPlan & { durationSec: number | null };
/** 캐시 파일에 적을 것: 받은 파일의 태그 중 우리가 쓰는 것과 다시 구운 그림 */
type CacheTags = { tags?: Partial<TagInfo> | null; cover?: Cover | null };

/**
 * yt-dlp 분기도 같은 목표를 쓴다. 숫자가 두 군데에 적히지 않게 여기서 가져간다.
 * `--postprocessor-args` 의 `이름:인자` 한 줄이다. youtube-dl-exec 는 객체 값을 인자로 바꾸지 않고 버린다.
 * `ffmpeg:` 는 출력 파일 앞에 붙는다.
 */
const ytdlpPostprocessorArgs = () => `ffmpeg:-b:a ${TRANSCODE_TARGET_KBPS}k`;

/**
 * 정해진 계획을 ffmpeg 인자로. 출력은 언제나 `.opus`(ogg/opus). 캐시 파일명이 그 전제다.
 * 받은 파일의 태그는 버리고(-map_metadata -1) tags(제목 · 가수 · 앨범)만 적는다. pictureFile 이 있으면 그 ffmetadata 파일의 그림 태그를 오디오 스트림에 붙인다.
 * ffmpeg 는 Ogg 에 그림 스트림을 쓰지 못해(Unsupported codec id) 그림은 태그(METADATA_BLOCK_PICTURE)로만 들어간다
 */
function argsFor(plan: Pick<ConvertPlan, "action" | "bitrateKbps">, srcFile: string, outFile: string, { tags, pictureFile }: { tags?: Partial<TagInfo> | null; pictureFile?: string | null } = {}): string[] {
  const codec = plan.action === "copy" ? ["-c:a", "copy"] : ["-c:a", "libopus", "-b:a", `${plan.bitrateKbps}k`];
  const picture = pictureFile ? [...inputFilter(["ffmetadata"], "file"), "-f", "ffmetadata", "-i", pictureFile] : [];
  const pictureMeta = pictureFile ? ["-map_metadata:s:a:0", "1:s:0"] : [];
  const written = (["title", "artist", "album"] as const).flatMap((name) => (tags?.[name] ? ["-metadata:s:a:0", `${name}=${tags[name]}`] : []));
  // `-vn` 은 두 경우 모두 붙인다. 앨범아트가 붙은 파일을 리먹싱하면 그림 스트림까지 따라 들어온다.
  return ["-hide_banner", "-loglevel", "error", ...inputFilter(AUDIO_FORMATS, "file"), "-i", srcFile, ...picture, "-vn", "-map_metadata", "-1", ...pictureMeta, ...written, ...codec, "-f", "opus", "-y", outFile];
}

/** ffmetadata 의 값 이스케이프(= ; # \ 줄바꿈) */
const escapeMeta = (value: string) => value.replace(/[=;#\\\n]/g, (c) => `\\${c}`);

/** 그림 태그 하나를 든 ffmetadata 파일의 내용 */
const pictureMetadata = (cover: Cover) => `;FFMETADATA1\n[STREAM]\nMETADATA_BLOCK_PICTURE=${escapeMeta(Buffer.from(pictureBlock({ mime: "image/jpeg", width: cover.width, height: cover.height, data: cover.jpeg })).toString("base64"))}\n`;

/**
 * 다운로드해 둔 파일을 캐시용 `.opus` 로 만든다. 실패하면 던진다.
 *
 * @param {string} srcFile  다운로드해 둔 원본(확장자 무관)
 * @param {string} outFile  만들 `.opus` 경로
 * @param cache  적을 태그 · 그림. 그림은 `<출력 이름>.meta`(임시 파일 정리가 알아보는 이름)에 적어 넘기고 지운다
 */
async function toCacheOpus(srcFile: string, outFile: string, { tags, cover }: CacheTags = {}): Promise<Converted> {
  const info = await probeAudio(srcFile);
  const plan = planFor(info);

  const pictureFile = cover ? `${outFile.replace(/\.opus$/, "")}.meta` : null;
  try {
    if (pictureFile && cover) fs.writeFileSync(pictureFile, pictureMetadata(cover));
    await run(argsFor(plan, srcFile, outFile, { tags, pictureFile }));
  } finally {
    if (pictureFile) fs.rmSync(pictureFile, { force: true });
  }
  log.debug(`캐시 변환: ${plan.action === "copy" ? "리먹싱" : `변환 ${plan.bitrateKbps}k`} (${plan.why})`);

  return { ...plan, durationSec: info.durationSec };
}

// 진행이 이만큼 멈추면 끊는다. 느린 기기의 긴 변환도 진행은 0.5초마다 온다
const STALL_MS = 60_000;
let stallMs = STALL_MS;
/** 테스트가 멈춤 한도를 줄인다. null 이면 원래대로 */
function useConvertStall(ms: number | null) {
  stallMs = ms ?? STALL_MS;
}

/** 파일로 쓰는 변환. 진행이 멈추면 끊고, 실패하면 표준 오류의 끝을 실어 던진다(부르는 쪽이 한 번 남긴다) */
async function run(args: string[]): Promise<void> {
  const done = await runFfmpeg([...PROGRESS_ARGS, ...args], { label: "download", stallMs, discardStdout: true });
  if (done.code === 0) return;
  const tail = done.stderr.trim().slice(-1000);
  const why = done.timedOut ? `진행이 ${stallMs / 1000}초 동안 멈춰 끊었습니다` : `FFmpeg 종료 (code=${done.code}, signal=${done.signal})`;
  throw codedError("stream-failed", tail ? `${why}: ${tail}` : why);
}

export { toCacheOpus, useConvertStall, planFor, ytdlpPostprocessorArgs, REMUX_MAX_KBPS, REMUX_SLACK, TRANSCODE_TARGET_KBPS };
export const _internals = { argsFor, escapeMeta };
export type { Converted, CacheTags };
