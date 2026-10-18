// 로그인 배경의 장면 띠 단계(영상만): 편집 창 시간 막대에 깔 작은 장면들. 미리보기 영상에서 0.5초 간격(최대 160장)으로 높이 128px 장면을 떠
// 10열 격자 한 장으로 만든다(한 줄로 붙이면 WebP 폭 상한 16383 을 넘는다). ffmpeg 는 PNG 를 내고 WebP 는 sharp 가 만든다(ffmpeg 빌드에 WebP 인코더가 없어도 된다)

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { codedError } from "../../rules/error-kind.ts";
import { ffmpeg } from "./ffmpeg.ts";
import type { LoginBackgroundStrip } from "../contract/login-background.ts";
import type { StageJob, StageResult } from "./runner.ts";
import * as store from "./store.ts";
import { previewOf } from "./preview.ts";
import { probeVideo, READ_ARGS } from "./source.ts";

/** 장면 간격의 하한(초) · 장면 수 상한 · 격자 열 수 · 한 셀 높이(화면 띠 64px 의 두 배) */
const EVERY_MIN = 0.5;
const MAX_COUNT = 160;
const COLUMNS = 10;
const HEIGHT = 128;

/** 장면 띠 파일(없으면 null) */
const stripOf = (id: string) => {
  const file = path.join(store.folderOf(id), "strip.webp");
  return fs.existsSync(file) ? file : null;
};

/** 장면 수 · 간격 · 셀 크기 */
function layoutOf(duration: number, width: number, height: number): LoginBackgroundStrip {
  const count = Math.min(MAX_COUNT, Math.max(2, Math.ceil(duration / EVERY_MIN)));
  return { count, every: duration / count, columns: COLUMNS, width: Math.max(2, Math.round((HEIGHT * width) / height / 2) * 2), height: HEIGHT };
}

/** 장면 띠 단계 */
async function strip({ item, signal }: StageJob): Promise<StageResult> {
  const preview = previewOf(item.id);
  if (!preview?.endsWith(".mp4")) throw codedError("background-failed", "미리보기 영상이 없습니다");
  const probed = await probeVideo(preview, signal);
  const layout = layoutOf(item.duration, probed.width, probed.height);
  const rows = Math.ceil(layout.count / COLUMNS);
  const filter = `fps=${layout.count}/${item.duration},scale=${layout.width}:${layout.height}:flags=lanczos,tile=${COLUMNS}x${rows}`;
  const run = await ffmpeg(["-v", "error", ...READ_ARGS, "-i", preview, "-vf", filter, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"], { signal, timeoutMs: item.duration * 20_000 + 600_000 });
  if (run.aborted) throw codedError("aborted", "그만뒀습니다");
  const png = run.output;
  if (run.code !== 0 || !png.length) throw codedError("background-failed", `장면 띠를 만들지 못했습니다: ${run.stderr.split("\n").filter(Boolean).at(-1) ?? ""}`);
  const file = path.join(store.folderOf(item.id), "strip.webp");
  await sharp(png).webp({ quality: 60 }).toFile(`${file}.part`);
  fs.renameSync(`${file}.part`, file);
  return { strip: layout };
}

export { strip, stripOf, layoutOf };
