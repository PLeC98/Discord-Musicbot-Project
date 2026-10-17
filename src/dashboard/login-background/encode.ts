// 로그인 배경의 굽기: H.264 단계(720p 하나, 먼저 따로) · 굽기 단계(AV1 · VP9 의 1080p · 4K) · 마무리 단계(원본 지우기). 굽는 값은 research §11.6(B8, 2026-10-15 사용자).
// 모두 30fps 이하 · 키프레임 2초 · lanczos, HLS(fMP4, 2초 조각)로 코덱 · 단계마다 폴더(<코덱>/<짧은 변>/index.m3u8)에 굽고, 코덱마다 목록(<코덱>/index.m3u8)을 둔다.
// 구간은 원본에서 정확히 자른다(입력 앞 -ss · -to, 다시 굽기라 정확하다). 코어는 80% 로 묶는다(infra/cpu-affinity).
// 굽기 단계는 남은 메모리가 넉넉하면 원본을 한 번 풀어 나눠(split) 함께 굽고, 아니면 단계마다 따로 굽는다(research §11.7 B4 · B4s).
// AV1 의 병렬 단계(SVT-AV1 lp)는 남은 메모리에 맞춰 고른다(memory.ts, research §11.10).
// 나눠 굽다 인코더 하나가 실패하면 ffmpeg 전체가 멈추므로, 인코더를 다시 시험하고 남은 단계를 따로 굽는다.
// 단계는 임시 폴더(.tmp)에 굽고 끝나면 이름을 바꾼다: 봇이 다시 켜져 이어 할 때는 끝난 단계를 두고 남은 단계만 굽는다

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { codedError } from "../../rules/error-kind.ts";
import { LOGIN_BG_CODECS, type LoginBackgroundCodec, type LoginBackgroundRung } from "../contract/login-background.ts";
import type { StageJob, StageResult } from "./runner.ts";
import * as store from "./store.ts";
import { ffmpeg, longJob, PROGRESS_ARGS } from "./ffmpeg.ts";
import { cropped, FHD, FPS_CAP, fitShort, scaleTo, sourceFilter, UHD } from "./ladder.ts";
import { probeVideo, READ_ARGS, type Probed } from "./source.ts";
import { encoderFor, encodersReady, recheck } from "./encoders.ts";
import { AV1_LP_MAX, av1LpFor, enoughMemory, needOf, splitLp } from "./memory.ts";
import { josa } from "../../rules/josa.ts";

/** H.264 단계의 짧은 변 */
const H264_SHORT = 720;

/** 단계 하나: 코덱 · 짧은 변(폴더 이름) · 크기 · 인코더 옵션 */
type Plan = { codec: LoginBackgroundCodec; short: number; width: number; height: number; options: string[] };

/** 인코더 옵션(키프레임 간격 g 는 출력 초당 장면 수의 2배) */
function optionsFor(codec: LoginBackgroundCodec, encoder: string, short: number, g: number): string[] {
  const gop = ["-g", String(g)];
  if (codec === "av1") return ["-c:v", "libsvtav1", "-preset", "6", "-crf", short >= UHD ? "32" : "30", "-maxrate", short >= UHD ? "25000k" : "10000k", "-pix_fmt", "yuv420p10le", ...gop];
  if (codec === "vp9") return ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-tile-columns", short >= UHD ? "3" : "2", "-auto-alt-ref", "1", "-lag-in-frames", "25", "-pix_fmt", "yuv420p", ...gop];
  // H.264: NVENC 는 VBR 2.2M(research §11.7), 없으면 OpenH264 2.5M. B 프레임은 두지 않는다(hls.js 가 반복으로 되감을 때 bufferSeekOverHole 을 냈다, /gallery/seam)
  if (encoder === "h264_nvenc") return ["-c:v", "h264_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-b:v", "2200k", "-maxrate", "2200k", "-bufsize", "2200k", "-bf", "0", "-pix_fmt", "yuv420p", ...gop];
  return ["-c:v", "libopenh264", "-profile:v", "high", "-coder", "cabac", "-rc_mode", "bitrate", "-b:v", "2500k", "-qmin", "1", "-qmax", "51", "-pix_fmt", "yuv420p", ...gop];
}

/** 원본(자른 크기)에서 이 코덱의 단계들. AV1 · VP9 는 1080p 와 4K(원본 짧은 변이 2160 이상일 때만, 1080p 보다 작으면 원본 크기 하나), H.264 는 720p */
function plansFor(codecs: LoginBackgroundCodec[], size: { width: number; height: number }, fps: number): Plan[] {
  const g = Math.round(Math.min(fps, FPS_CAP) * 2);
  return codecs.flatMap((codec) => {
    const encoder = encoderFor(codec);
    if (!encoder) return [];
    const shorts = codec === "h264" ? [H264_SHORT] : Math.min(size.width, size.height) >= UHD ? [FHD, UHD] : [FHD];
    return shorts.map((target) => {
      const out = fitShort(size.width, size.height, target);
      const short = Math.min(out.width, out.height);
      return { codec, short, ...out, options: optionsFor(codec, encoder, short, g) };
    });
  });
}

/** AV1 단계에 병렬 단계를 붙인다 */
const withLp = (plan: Plan, lp: number) => (plan.codec === "av1" ? { ...plan, options: [...plan.options, "-svtav1-params", `lp=${lp}`] } : plan);

const codecDir = (id: string, codec: LoginBackgroundCodec) => path.join(store.folderOf(id), codec);
const rungDir = (id: string, plan: Plan) => path.join(codecDir(id, plan.codec), String(plan.short));

/**
 * HLS 출력 하나(임시 폴더에). 경로는 / 로 넘긴다: ffmpeg 의 HLS 는 목록 경로에서 / 로만 폴더를 가려, Windows 의 \ 경로면 init 조각을 작업 폴더에 쓴다
 */
const hlsOutput = (dir: string) => {
  const at = (name: string) => path.join(dir, name).replaceAll("\\", "/");
  return ["-f", "hls", "-hls_time", "2", "-hls_playlist_type", "vod", "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4", "-hls_segment_filename", at("seg-%03d.m4s"), at("index.m3u8")];
};

/** 단계들을 한 번 풀어 함께 굽는다(하나면 따로 굽기와 같다). lp 는 AV1 의 병렬 단계. 실패면 ffmpeg 의 까닭 */
async function encodeTogether(item: Readonly<store.Stored>, probed: Probed, batch: { plans: Plan[]; lp: number }, signal: AbortSignal, progress: (value: number) => void): Promise<string | null> {
  const plans = batch.plans.map((plan) => withLp(plan, batch.lp));
  const edit = item.edit!;
  const [from, to] = edit.range ?? [0, item.duration];
  const tmp = plans.map((plan) => `${rungDir(item.id, plan)}.tmp`);
  for (const dir of tmp) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  const labels = plans.map((_, i) => `o${i}`);
  // AV1 은 10비트로 줄인다(8비트는 어두운 면에 얼룩이 생겼다, research §11.6)
  const format = (plan: Plan) => (plan.codec === "av1" ? "yuv420p10le" : "yuv420p");
  const split = plans.length > 1 ? `,split=${plans.length}${labels.map((label) => `[s${label}]`).join("")};${plans.map((plan, i) => `[s${labels[i]}]${scaleTo(plan, format(plan))}[${labels[i]}]`).join(";")}` : `,${scaleTo(plans[0], format(plans[0]))}[${labels[0]}]`;
  const graph = `${sourceFilter(probed, edit.crop)}${split}`;
  const outputs = plans.flatMap((plan, i) => ["-map", `[${labels[i]}]`, ...plan.options, ...hlsOutput(tmp[i])]);
  const run = await ffmpeg(["-v", "error", ...PROGRESS_ARGS, "-ss", String(from), "-to", String(to), ...READ_ARGS, "-i", store.sourceOf(item.id), "-filter_complex", graph, "-an", "-sn", "-dn", ...outputs], {
    signal,
    discardStdout: true,
    bindCores: true,
    ...longJob(to - from),
    onStderrLine: (line) => {
      const time = /^out_time_us=(\d+)/.exec(line);
      if (time) progress(Math.min(1, Number(time[1]) / 1e6 / (to - from)));
    },
  });
  if (run.aborted) throw codedError("aborted", "그만뒀습니다");
  if (run.code !== 0) {
    for (const dir of tmp) fs.rmSync(dir, { recursive: true, force: true });
    return run.timedOut ? "시간 초과" : run.stderr.split("\n").filter(Boolean).slice(-3).join(" ");
  }
  plans.forEach((plan, i) => {
    fs.rmSync(rungDir(item.id, plan), { recursive: true, force: true });
    fs.renameSync(tmp[i], rungDir(item.id, plan));
  });
  return null;
}

/** init 조각의 설정 상자에서 코덱 문자열(RFC 6381) */
function codecString(init: Buffer): string {
  const box = (name: string) => {
    const at = init.indexOf(Buffer.from(name, "latin1"));
    return at < 0 ? null : init.subarray(at + 4);
  };
  const hex2 = (n: number) => n.toString(16).padStart(2, "0");
  const avcC = box("avcC");
  if (avcC) return `avc1.${hex2(avcC[1])}${hex2(avcC[2])}${hex2(avcC[3])}`;
  const av1C = box("av1C");
  if (av1C) {
    const bits = av1C[2] & 0x40 ? (av1C[2] & 0x20 ? 12 : 10) : 8;
    return `av01.${av1C[1] >> 5}.${String(av1C[1] & 31).padStart(2, "0")}${av1C[2] >> 7 ? "H" : "M"}.${String(bits).padStart(2, "0")}`;
  }
  const vpcC = box("vpcC");
  if (vpcC) return `vp09.${String(vpcC[4]).padStart(2, "0")}.${String(vpcC[5]).padStart(2, "0")}.${String(vpcC[6] >> 4).padStart(2, "0")}`;
  throw codedError("background-failed", "init 조각에서 코덱을 읽지 못했습니다");
}

/** 구운 단계의 목록 값: 2초 최대(조각마다 크기 ÷ 길이의 최대, HLS 의 BANDWIDTH) · 평균 · 코덱 문자열 */
function rungOf(dir: string, plan: Plan, fps: number): LoginBackgroundRung & { average: number } {
  const playlist = fs.readFileSync(path.join(dir, "index.m3u8"), "utf8");
  const segments = [...playlist.matchAll(/#EXTINF:([\d.]+),\s*\n([^\n#]+)/g)].map((m) => ({ seconds: Number(m[1]), bytes: fs.statSync(path.join(dir, m[2].trim())).size }));
  const full = segments.filter((one) => one.seconds >= 1);
  const rates = (full.length ? full : segments).map((one) => (one.bytes * 8) / one.seconds);
  const seconds = segments.reduce((sum, one) => sum + one.seconds, 0);
  const bytes = segments.reduce((sum, one) => sum + one.bytes, 0);
  return { width: plan.width, height: plan.height, codecs: codecString(fs.readFileSync(path.join(dir, "init.mp4"))), bandwidth: Math.round(Math.max(...rates)), frameRate: Math.min(fps, FPS_CAP), average: Math.round((bytes * 8) / Math.max(seconds, 0.001)) };
}

/** 코덱마다의 목록을 다시 쓴다(있는 단계만, 낮은 것부터). 단계 값은 media.rungs 에 */
function writeMasters(item: Readonly<store.Stored>, plans: Plan[], fps: number): store.Media["rungs"] {
  const rungs: store.Media["rungs"] = {};
  for (const codec of LOGIN_BG_CODECS) {
    const made = plans.filter((plan) => plan.codec === codec && fs.existsSync(path.join(rungDir(item.id, plan), "index.m3u8"))).sort((a, b) => a.short - b.short);
    if (!made.length) continue;
    const values = made.map((plan) => ({ plan, rung: rungOf(rungDir(item.id, plan), plan, fps) }));
    const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS", ...values.flatMap(({ plan, rung }) => [`#EXT-X-STREAM-INF:BANDWIDTH=${rung.bandwidth},AVERAGE-BANDWIDTH=${rung.average},CODECS="${rung.codecs}",RESOLUTION=${rung.width}x${rung.height},FRAME-RATE=${rung.frameRate.toFixed(3)}`, `${plan.short}/index.m3u8`])];
    const file = path.join(codecDir(item.id, codec), "index.m3u8");
    fs.writeFileSync(`${file}.tmp`, `${lines.join("\n")}\n`);
    fs.renameSync(`${file}.tmp`, file);
    rungs[codec] = values.map(({ rung }) => ({ width: rung.width, height: rung.height, codecs: rung.codecs, bandwidth: rung.bandwidth, frameRate: rung.frameRate }));
  }
  return rungs;
}

/** 이 단계들을 굽는다(끝난 것은 건너뛴다). 나눠 굽기가 실패하면 인코더를 다시 시험하고 남은 것을 따로 */
async function encodePlans({ item, signal, progress }: StageJob, codecs: LoginBackgroundCodec[]): Promise<StageResult> {
  await encodersReady();
  const probed = await probeVideo(store.sourceOf(item.id), signal);
  const size = cropped(probed.width, probed.height, item.edit!.crop);
  const fps = probed.fps ?? FPS_CAP;
  const plans = plansFor(codecs, size, fps);
  if (!plans.length) throw codedError("background-failed", `굽는 인코더가 없습니다(${codecs.join(" · ")})`);
  const left = plans.filter((plan) => !fs.existsSync(path.join(rungDir(item.id, plan), "index.m3u8")));
  // 나눠 굽기는 남은 메모리가 지금 넉넉할 때만(기다리지 않고 따로 굽는다)
  const together = left.length > 1 ? splitLp(left.some((plan) => plan.short >= UHD)) : null;
  if (together !== null) {
    const failure = await encodeTogether(item, probed, { plans: left, lp: together }, signal, progress);
    if (failure) {
      log.warn({ sub: "admin" }, `로그인 배경 "${item.name}"${josa(item.name, "을")} 나눠 굽다 실패해 인코더를 다시 시험하고 따로 굽습니다: ${failure}`);
      await recheck();
    }
  }
  const rest = plansFor(codecs, size, fps).filter((plan) => !fs.existsSync(path.join(rungDir(item.id, plan), "index.m3u8")));
  for (const [i, plan] of rest.entries()) {
    const what = `${plan.codec} ${plan.short}p 굽기`;
    const uhd = plan.short >= UHD;
    const lp = plan.codec === "av1" ? await av1LpFor(uhd, what, signal) : AV1_LP_MAX;
    if (plan.codec !== "av1") await enoughMemory(needOf({ codec: plan.codec, uhd }), what, signal);
    if (lp < AV1_LP_MAX) log.info({ sub: "admin" }, `로그인 배경 "${item.name}" 의 ${what}: 남은 메모리(${(os.freemem() / 1024 ** 3).toFixed(1)}GB)에 맞춰 AV1 병렬 단계를 ${lp} 로 낮춥니다`);
    const failure = await encodeTogether(item, probed, { plans: [plan], lp }, signal, (value) => progress((i + value) / rest.length));
    if (failure) throw codedError("background-failed", `${plan.codec} ${plan.short}p 를 굽지 못했습니다: ${failure}`);
  }
  return { media: { ...item.media, rungs: { ...item.media.rungs, ...writeMasters(item, plansFor(LOGIN_BG_CODECS.slice(), size, fps), fps) } } };
}

/** H.264 단계(720p 하나, 먼저 따로: 로그인 화면이 저화질 영상으로 바뀐다) */
const h264 = (job: StageJob) => encodePlans(job, ["h264"]);
/** 굽기 단계(AV1 · VP9) */
const encode = (job: StageJob) => encodePlans(job, ["av1", "vp9"]);

/** 마무리 단계: 원본 · 편집 창의 미리보기 · 장면 띠 · 받다 남은 것을 지운다(구운 것과 정지 그림만 남는다) */
async function drop({ item }: StageJob): Promise<StageResult> {
  const folder = store.folderOf(item.id);
  for (const name of fs.readdirSync(folder)) {
    if (name === "source" || name.startsWith("source.") || name.startsWith("preview.") || name.startsWith("strip.") || name.startsWith("download.") || name.endsWith(".part")) fs.rmSync(path.join(folder, name), { recursive: true, force: true });
  }
  return {};
}

export { h264, encode, drop, plansFor, codecString, rungOf };
