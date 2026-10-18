// 로그인 배경의 유튜브: 다운로드 대행. 음원과 같은 yt-dlp 길(클라이언트 바꿔 묻기 · POToken · 연령 제한 쿠키)로 영상만 다운로드하고, 그 뒤는 올린 파일과 같다.
// 다운로드 단계는 편집 창용 480p 를, 고해상도 다운로드 단계(편집을 적용한 뒤)는 짧은 변 2160 이하에서 가장 좋은 것을 다운로드해 원본을 바꾼다.
// 영상 전체를 다운로드한다: yt-dlp 의 구간 다운로드는 키프레임에서 잘려 시작이 어긋나고, 정확히 자르려면 다시 인코딩하는데 번들 ffmpeg(LGPL)에는 x264 가 없다.
// 구간은 인코딩이 원본에서 정확히 자른다. 다운로드하는 크기의 상한은 남은 저장 공간

import fs from "node:fs";
import path from "node:path";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { codedError, messageOf } from "../../rules/error-kind.ts";
import * as youtube from "../../sources/youtube/index.ts";
import ytdlp, { type YtDlpFlags } from "../../sources/ytdlp-spawn.ts";
import type { StageJob, StageResult } from "./runner.ts";
import * as store from "./store.ts";
import { UHD } from "./ladder.ts";
import { inspectSource } from "./source.ts";

/** 편집 창용 미리보기의 짧은 변(그 아래에서 가장 좋은 것) */
const PREVIEW_RES = 480;

type Info = { width?: number; height?: number; vcodec?: string; duration?: number; formats?: Array<{ width?: number | null; height?: number | null; vcodec?: string | null }> };

/** 다운로드한 파일(이름.확장자, 정보 · 다운로드 중인 파일은 빼고) */
const downloaded = (folder: string, base: string) => fs.readdirSync(folder).find((name) => name.startsWith(`${base}.`) && !name.endsWith(".info.json") && !name.endsWith(".part") && !name.endsWith(".ytdl"));

/** 영상만, 짧은 변 res 이하에서 가장 좋은 것을 folder/base.확장자 로 다운로드한다. 다운로드한 파일과 yt-dlp 가 적은 정보 */
async function fetchVideo(url: string, folder: string, base: string, res: number, signal: AbortSignal): Promise<{ file: string; info: Info }> {
  for (const name of fs.readdirSync(folder)) if (name.startsWith(`${base}.`)) fs.rmSync(path.join(folder, name), { force: true });
  const room = store.room();
  if (room <= 0) throw codedError("background-no-space", "남은 공간이 없습니다");
  // 짧은 변 res 이하에서 가장 좋은 것(-S res:N). 타입 정의에는 한도를 붙인 형식이 없어 맞춰 넘긴다
  const formatSort = [`res:${res}`] as unknown as YtDlpFlags["formatSort"];
  const flags: YtDlpFlags = { output: path.join(folder, `${base}.%(ext)s`), format: "bv*", formatSort, noPlaylist: true, matchFilter: "!is_live", maxFilesize: String(room), writeInfoJson: true };
  try {
    await youtube.runYtDlp(
      url,
      (forceCookies) => youtube.getYtDlpOptions(flags, { forceCookies }),
      (target, options) => ytdlp(target, options, { signal }),
    );
  } catch (error) {
    if (signal.aborted) throw error;
    throw codedError("background-link-failed", `유튜브에서 다운로드하지 못했습니다: ${messageOf(error)}`, { cause: error });
  }
  const name = downloaded(folder, base);
  // 라이브는 건너뛰고(match-filter) 크기 상한을 넘으면 다운로드하지 않고 끝난다(둘 다 파일이 없다)
  if (!name) throw codedError("background-link-failed", "유튜브에서 다운로드한 영상이 없습니다(라이브이거나 남은 공간보다 큽니다)");
  const infoFile = path.join(folder, `${base}.info.json`);
  let info: Info = {};
  try {
    info = JSON.parse(fs.readFileSync(infoFile, "utf8")) as Info;
  } catch {
    // 정보가 없어도 다운로드한 영상은 쓴다
  }
  fs.rmSync(infoFile, { force: true });
  return { file: path.join(folder, name), info };
}

/** 고해상도로 다운로드할 크기: 영상 형식 중 짧은 변이 4K 이하로 가장 큰 것(편집 창이 원본 크기로 보이게) */
function bestSize(info: Info): { width: number; height: number } | null {
  const sizes = (info.formats ?? []).filter((one) => one.width && one.height && one.vcodec && one.vcodec !== "none").map((one) => ({ width: one.width!, height: one.height! }));
  const fit = sizes.filter((one) => Math.min(one.width, one.height) <= UHD).sort((a, b) => Math.min(b.width, b.height) - Math.min(a.width, a.height));
  return fit[0] ?? null;
}

/** 다운로드 단계(유튜브): 편집 창용 480p 를 원본 위치에 다운로드한다. 크기는 고해상도로 다운로드할 크기를 적는다 */
async function receiveYoutube({ item, folder, signal }: StageJob): Promise<StageResult> {
  const { file, info } = await fetchVideo(item.link!, folder, "download", PREVIEW_RES, signal);
  fs.renameSync(file, store.sourceOf(item.id));
  const inspected = await inspectSource(store.sourceOf(item.id), signal);
  return { ...inspected, ...(bestSize(info) ?? {}) };
}

/** 받은 고해상도가 다운로드 단계에서 본 크기(받을 크기)보다 작으면 그 차이. 그때 유튜브가 낮은 형식만 주면 정지 화면 · 영상이 그 화질로 만들어진다 */
function shortfall(expected: { width: number; height: number }, got: { width: number; height: number }): string | null {
  if (!expected.width || !expected.height || Math.min(got.width, got.height) >= Math.min(expected.width, expected.height)) return null;
  return `${got.width} × ${got.height}(다운로드 단계에서 본 크기 ${expected.width} × ${expected.height})`;
}

/** 고해상도 다운로드 단계(유튜브, 편집을 적용한 뒤): 원본을 짧은 변 2160 이하의 가장 좋은 영상으로 바꾼다 */
async function highRes({ item, folder, signal }: StageJob): Promise<StageResult> {
  const { file } = await fetchVideo(item.link!, folder, "download", UHD, signal);
  fs.renameSync(file, store.sourceOf(item.id));
  const inspected = await inspectSource(store.sourceOf(item.id), signal);
  const short = shortfall(item, inspected);
  if (short) log.warn({ sub: "admin" }, `로그인 배경 "${item.name}" 의 고해상도 다운로드가 기대보다 작습니다: ${short}`);
  return { width: inspected.width, height: inspected.height, fps: inspected.fps };
}

export { receiveYoutube, highRes, bestSize, shortfall };
