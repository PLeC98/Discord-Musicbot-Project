import { spawnFfmpeg, probeAudio } from "./ffmpeg/process.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "track" });
import { planFor, REMUX_MAX_KBPS, REMUX_SLACK, TRANSCODE_TARGET_KBPS, type ConvertPlan } from "../rules/convertPlan.ts";

type Converted = ConvertPlan & { durationSec: number | null };

/**
 * yt-dlp 갈래도 같은 목표를 쓴다. 숫자가 두 군데에 적히지 않게 여기서 가져간다.
 * `--postprocessor-args` 의 `이름:인자` 한 줄이다. youtube-dl-exec 는 객체 값을 인자로 바꾸지 않고 버린다.
 * `ffmpeg:` 는 출력 파일 앞에 붙는다.
 */
const ytdlpPostprocessorArgs = () => `ffmpeg:-b:a ${TRANSCODE_TARGET_KBPS}k`;

/** 정해진 계획을 ffmpeg 인자로. 출력은 언제나 `.opus`(ogg/opus). 캐시 파일명이 그 전제다. */
function argsFor(plan: Pick<ConvertPlan, "action" | "bitrateKbps">, srcFile: string, outFile: string): string[] {
  const codec = plan.action === "copy" ? ["-c:a", "copy"] : ["-c:a", "libopus", "-b:a", `${plan.bitrateKbps}k`];
  // `-vn` 은 두 경우 모두 붙인다. 앨범아트가 붙은 파일을 리먹싱하면 그림까지 따라 들어온다.
  return ["-hide_banner", "-loglevel", "error", "-i", srcFile, "-vn", ...codec, "-f", "opus", "-y", outFile];
}

/**
 * 받아 둔 파일을 캐시용 `.opus` 로 만든다. 실패하면 던진다.
 *
 * @param {string} srcFile  받아 둔 원본(확장자 무관)
 * @param {string} outFile  만들 `.opus` 경로
 */
async function toCacheOpus(srcFile: string, outFile: string): Promise<Converted> {
  const info = await probeAudio(srcFile);
  const plan = planFor(info);

  await run(argsFor(plan, srcFile, outFile));
  log.debug(`캐시 변환: ${plan.action === "copy" ? "리먹싱" : `변환 ${plan.bitrateKbps}k`} (${plan.why})`);

  return { ...plan, durationSec: info.durationSec };
}

/** 출력이 파일이라 stdout 을 소비하지 않는다(killOnStdoutClose 해제. 켜면 조기 종료한다). */
function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnFfmpeg(args, "download", { killOnStdoutClose: false });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg 종료 (code=${code}, signal=${signal})`));
    });
  });
}

export { toCacheOpus, planFor, ytdlpPostprocessorArgs, REMUX_MAX_KBPS, REMUX_SLACK, TRANSCODE_TARGET_KBPS };
export const _internals = { argsFor };
export type { Converted };
