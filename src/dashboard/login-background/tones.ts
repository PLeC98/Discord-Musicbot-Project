// 로그인 배경의 장면 색 단계(영상만): 몰입형 테마 색상이 장면이 바뀔 때만 넘어가도록(2026-10-15 사용자) 장면 바뀜과 장면마다의 색을 미리 추출한다.
// 장면 바뀜은 자른 구간을 작게(짧은 변 270) 풀어 ffmpeg scene 0.3 을 넘는 곳, 1초 안에 거듭 바뀐 것과 처음 · 끝 0.5초 안은 하나로 본다(데모 /gallery/tint 와 같은 계산).
// 장면마다 바뀐 뒤 0.4초의 장면(바뀌는 중인 장면을 피한다)의 가운데 정사각형을 40×40 으로 떠 대표색을 선택한다(rules/art-seed, 화면의 앨범아트와 같은 계산)

import { codedError } from "../../rules/error-kind.ts";
import { hexOfSeed, SEED_SIDE, seedOfPixels } from "../../rules/art-seed.ts";
import { ffmpeg, longJob, PROGRESS_ARGS } from "./ffmpeg.ts";
import type { LoginBackgroundScene } from "../contract/login-background.ts";
import type { StageJob, StageResult } from "./runner.ts";
import * as store from "./store.ts";
import { fitShort, seekArgs, sourceFilter, squareCrop } from "./ladder.ts";
import { probeVideo, READ_ARGS } from "./source.ts";
import { frameAt } from "./stills.ts";

/** 장면 바뀜의 문턱(ffmpeg scene 점수) · 하나로 보는 간격 · 처음 · 끝에서 빼는 몫 · 장면을 뜨는 때(바뀐 뒤) · 찾을 때의 짧은 변 */
const THRESHOLD = 0.3;
const MERGE = 1;
const EDGE = 0.5;
const SETTLE = 0.4;
const DETECT_SHORT = 270;

/** 장면 바뀜 시각(구간 처음부터 초)을 선택한다: 처음 · 끝 EDGE 안과 앞 바뀜에서 MERGE 안은 뺀다 */
function cutsOf(times: number[], length: number): number[] {
  const cuts: number[] = [];
  for (const t of times) if (t > EDGE && t < length - EDGE && (!cuts.length || t - cuts[cuts.length - 1] > MERGE)) cuts.push(t);
  return cuts;
}

/** 장면 색 단계 */
async function tones({ item, signal, progress }: StageJob): Promise<StageResult> {
  const edit = item.edit!;
  const [from, to] = edit.range ?? [0, item.duration];
  const source = store.sourceOf(item.id);
  const probed = await probeVideo(source, signal);
  const small = fitShort(probed.width * edit.crop.w, probed.height * edit.crop.h, DETECT_SHORT);
  const times: number[] = [];
  const graph = `${sourceFilter(probed, edit.crop, { from, to })},scale=${small.width}:${small.height}:flags=bilinear,select='gt(scene,${THRESHOLD})',showinfo`;
  const run = await ffmpeg(["-v", "info", ...PROGRESS_ARGS, ...seekArgs(probed, { from, to }), ...READ_ARGS, "-i", source, "-filter_complex", graph, "-an", "-f", "null", "-"], {
    signal,
    discardStdout: true,
    ...longJob(to - from),
    onStderrLine: (line) => {
      const at = /\[Parsed_showinfo[^\]]*\].*?pts_time:\s*([\d.]+)/.exec(line);
      if (at) times.push(Number(at[1]));
    },
  });
  if (run.aborted) throw codedError("aborted", "그만뒀습니다");
  if (run.code !== 0) throw codedError("background-failed", `장면 바뀜을 찾지 못했습니다: ${run.stderr.split("\n").filter(Boolean).at(-1) ?? ""}`);
  const length = to - from;
  const starts = [0, ...cutsOf(times, length)];
  const scenes: LoginBackgroundScene[] = [];
  const square = squareCrop(probed.width, probed.height, edit.crop);
  for (const [i, at] of starts.entries()) {
    const pixels = await frameAt({ source, probed, at: from + Math.min(at + SETTLE, length - 0.1), crop: square, size: { width: SEED_SIDE, height: SEED_SIDE }, channels: 4 }, signal);
    scenes.push({ at: Math.round(at * 1000) / 1000, color: hexOfSeed(seedOfPixels(pixels)) });
    progress((i + 1) / starts.length);
  }
  return { media: { ...item.media, scenes } };
}

export { tones, cutsOf };
