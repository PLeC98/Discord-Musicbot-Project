// 로그인 배경의 인코딩: H.264 단계(720p 하나, 먼저 따로) · 인코딩 단계(AV1 · VP9 의 1080p · 4K) · 마무리 단계(원본 삭제).
// 모두 30fps 이하 · 키프레임 2초 · lanczos, HLS(fMP4, 2초 조각)로 코덱 · 단계마다 폴더(<코덱>/<짧은 변>/index.m3u8)에 인코딩하고, 코덱마다 목록(<코덱>/index.m3u8)을 둔다.
// 구간은 원본에서 정확히 자른다(영상은 입력 앞 -ss · -to, 움직이는 그림은 필터에서. ladder 의 seekArgs · sourceFilter, 다시 인코딩이라 정확하다). 코어는 80% 로 묶는다(infra/cpu-affinity).
// 인코딩 단계는 남은 메모리가 넉넉하면 원본을 한 번 풀어 나눠(split) 함께 인코딩하고, 아니면 단계마다 따로 인코딩한다(나누면 빠르지만 메모리가 더 든다).
// AV1 의 병렬 단계(SVT-AV1 lp)는 남은 메모리에 맞춰 선택한다(memory.ts).
// 나눠 인코딩하다 인코더 하나가 실패하면 ffmpeg 전체가 멈추므로, 인코더를 다시 테스트하고 남은 단계를 따로 인코딩한다.
// 단계는 임시 폴더(.tmp)에 인코딩하고 끝나면 이름을 바꾼다: 봇이 다시 시작해 이어 할 때는 끝난 단계를 두고 남은 단계만 인코딩한다

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { codedError } from "../../rules/error-kind.ts";
import { LOGIN_BG_CODECS, type LoginBackgroundBake, type LoginBackgroundCodec, type LoginBackgroundRung } from "../contract/login-background.ts";
import { boundCores } from "../../infra/cpu-affinity.ts";
import type { StageJob, StageResult } from "./runner.ts";
import * as store from "./store.ts";
import { ffmpeg, longJob, PROGRESS_ARGS } from "./ffmpeg.ts";
import { cropped, FHD, FPS_CAP, fitShort, frameRate, scaleTo, seekArgs, sourceFilter, UHD } from "./ladder.ts";
import { probeVideo, READ_ARGS, type Probed } from "./source.ts";
import { encoderFor, encodersReady, recheck } from "./encoders.ts";
import { AV1_LP_MAX, av1LpFor, enoughMemory, needOf, splitLp } from "./memory.ts";
import { josa } from "../../rules/josa.ts";

/** H.264 단계의 짧은 변 */
const H264_SHORT = 720;

/** 단계 하나: 코덱 · 짧은 변(폴더 이름) · 크기 · 인코더와 그 옵션 */
type Shape = { codec: LoginBackgroundCodec; short: number; width: number; height: number };
type Plan = Shape & { encoder: string; options: string[] };

/** 인코더 옵션(키프레임 간격 g 는 출력 초당 프레임 수의 2배) */
function optionsFor(codec: LoginBackgroundCodec, encoder: string, short: number, g: number): string[] {
  const gop = ["-g", String(g)];
  if (codec === "av1") return ["-c:v", "libsvtav1", "-preset", "6", "-crf", short >= UHD ? "32" : "30", "-maxrate", short >= UHD ? "25000k" : "10000k", "-pix_fmt", "yuv420p10le", ...gop];
  if (codec === "vp9") return ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-tile-columns", short >= UHD ? "3" : "2", "-auto-alt-ref", "1", "-lag-in-frames", "25", "-pix_fmt", "yuv420p", ...gop];
  // H.264: NVENC 는 VBR 2.2M(OpenH264 2.5M 과 크기가 같고 화질이 높다), 없으면 OpenH264 2.5M. B 프레임은 두지 않는다(hls.js 가 반복으로 되감을 때 bufferSeekOverHole 을 냈다)
  if (encoder === "h264_nvenc") return ["-c:v", "h264_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-b:v", "2200k", "-maxrate", "2200k", "-bufsize", "2200k", "-bf", "0", "-pix_fmt", "yuv420p", ...gop];
  // x264: OpenH264 와 같은 2.5M 규격(2초 최대가 3M 안에 들게 VBV 를 그만큼으로)
  if (encoder === "libx264") return ["-c:v", "libx264", "-preset", "medium", "-profile:v", "high", "-b:v", "2500k", "-maxrate", "2500k", "-bufsize", "2500k", "-bf", "0", "-pix_fmt", "yuv420p", ...gop];
  return ["-c:v", "libopenh264", "-profile:v", "high", "-coder", "cabac", "-rc_mode", "bitrate", "-b:v", "2500k", "-qmin", "1", "-qmax", "51", "-pix_fmt", "yuv420p", ...gop];
}

/** 원본(자른 크기)에서 이 코덱의 단계 크기들. AV1 · VP9 는 1080p 와 4K(원본 짧은 변이 2160 이상일 때만, 1080p 보다 작으면 원본 크기 하나), H.264 는 720p */
function shapesFor(codecs: readonly LoginBackgroundCodec[], size: { width: number; height: number }): Shape[] {
  return codecs.flatMap((codec) => {
    const shorts = codec === "h264" ? [H264_SHORT] : Math.min(size.width, size.height) >= UHD ? [FHD, UHD] : [FHD];
    return shorts.map((target) => {
      const out = fitShort(size.width, size.height, target);
      return { codec, short: Math.min(out.width, out.height), ...out };
    });
  });
}

/** 지금 쓸 수 있는 인코더로 인코딩할 단계들(인코더가 없는 코덱은 빠진다) */
function plansFor(codecs: readonly LoginBackgroundCodec[], size: { width: number; height: number }, fps: number): Plan[] {
  const g = Math.round(Math.min(fps, FPS_CAP) * 2);
  return shapesFor(codecs, size).flatMap((shape) => {
    const encoder = encoderFor(shape.codec);
    return encoder ? [{ ...shape, encoder, options: optionsFor(shape.codec, encoder, shape.short, g) }] : [];
  });
}

/** 지금 도는 인코딩(봇 전체에서 하나): 시작한 때 · 인코딩한 영상 초 */
let baking: (Omit<LoginBackgroundBake, "cores" | "speed"> & { startedAt: number; done: number }) | null = null;
/** 속도를 내기 전에 기다리는 시간(ffmpeg 를 실행하고 원본을 여는 몫) */
const SPEED_AFTER_MS = 3_000;

/** 지금 도는 인코딩(운영자 패널의 상태) */
function bakeNow(): LoginBackgroundBake | null {
  if (!baking) return null;
  const elapsed = Date.now() - baking.startedAt;
  const { id, rungs, lp } = baking;
  return { id, rungs, lp, cores: { bound: boundCores(), total: os.cpus().length }, speed: elapsed >= SPEED_AFTER_MS && baking.done > 0 ? baking.done / (elapsed / 1000) : null };
}

/** AV1 단계에 병렬 단계를 붙인다 */
const withLp = (plan: Plan, lp: number) => (plan.codec === "av1" ? { ...plan, options: [...plan.options, "-svtav1-params", `lp=${lp}`] } : plan);

const codecDir = (id: string, codec: LoginBackgroundCodec) => path.join(store.folderOf(id), codec);
const rungDir = (id: string, plan: Shape) => path.join(codecDir(id, plan.codec), String(plan.short));
/** 다 인코딩한 단계인가(목록이 있다) */
const made = (id: string, plan: Shape) => fs.existsSync(path.join(rungDir(id, plan), "index.m3u8"));

/**
 * HLS 출력 하나(임시 폴더에). 경로는 / 로 넘긴다: ffmpeg 의 HLS 는 목록 경로에서 / 로만 폴더를 구분해, Windows 의 \ 경로면 초기화 조각을 작업 폴더에 쓴다
 */
const hlsOutput = (dir: string) => {
  const at = (name: string) => path.join(dir, name).replaceAll("\\", "/");
  return ["-f", "hls", "-hls_time", "2", "-hls_playlist_type", "vod", "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4", "-hls_segment_filename", at("seg-%03d.m4s"), at("index.m3u8")];
};

/** 단계들을 한 번 풀어 함께 인코딩한다(하나면 따로 인코딩하는 것과 같다). lp 는 AV1 의 병렬 단계. 실패면 ffmpeg 의 까닭 */
async function encodeTogether(item: Readonly<store.Stored>, probed: Probed, batch: { plans: Plan[]; lp: number }, signal: AbortSignal, progress: (value: number) => void): Promise<string | null> {
  const plans = batch.plans.map((plan) => withLp(plan, batch.lp));
  const [from, to] = item.edit!.range ?? [0, item.duration];
  const mine = { id: item.id, rungs: plans.map((plan) => ({ codec: plan.codec, short: plan.short })), lp: plans.some((plan) => plan.codec === "av1") ? batch.lp : null, startedAt: Date.now(), done: 0 };
  baking = mine;
  try {
    return await bake(item, probed, plans, signal, (seconds) => {
      mine.done = seconds;
      progress(Math.min(1, seconds / (to - from)));
    });
  } finally {
    if (baking === mine) baking = null;
  }
}

/** ffmpeg 한 번으로 인코딩한다. onSeconds 는 인코딩한 영상 초 */
async function bake(item: Readonly<store.Stored>, probed: Probed, plans: Plan[], signal: AbortSignal, onSeconds: (seconds: number) => void): Promise<string | null> {
  const edit = item.edit!;
  const [from, to] = edit.range ?? [0, item.duration];
  const tmp = plans.map((plan) => `${rungDir(item.id, plan)}.tmp`);
  for (const dir of tmp) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  const labels = plans.map((_, i) => `o${i}`);
  // AV1 은 10비트로 줄인다(8비트는 어두운 면에 얼룩이 진다)
  const format = (plan: Plan) => (plan.codec === "av1" ? "yuv420p10le" : "yuv420p");
  const split = plans.length > 1 ? `,split=${plans.length}${labels.map((label) => `[s${label}]`).join("")};${plans.map((plan, i) => `[s${labels[i]}]${scaleTo(plan, format(plan))}[${labels[i]}]`).join(";")}` : `,${scaleTo(plans[0], format(plans[0]))}[${labels[0]}]`;
  const graph = `${sourceFilter(probed, edit.crop, { from, to })}${split}`;
  const outputs = plans.flatMap((plan, i) => ["-map", `[${labels[i]}]`, ...plan.options, ...hlsOutput(tmp[i])]);
  const run = await ffmpeg(["-v", "error", ...PROGRESS_ARGS, ...seekArgs(probed, { from, to }), ...READ_ARGS, "-i", store.sourceOf(item.id), "-filter_complex", graph, "-an", "-sn", "-dn", ...outputs], {
    signal,
    discardStdout: true,
    bindCores: true,
    ...longJob(to - from),
    onStderrLine: (line) => {
      const time = /^out_time_us=(\d+)/.exec(line);
      if (time) onSeconds(Number(time[1]) / 1e6);
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

/** 초기화 조각의 설정 박스에서 코덱 문자열(RFC 6381) */
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
  throw codedError("background-failed", "초기화 조각에서 코덱을 읽지 못했습니다");
}

/** 인코딩한 단계의 목록 값: 2초 최대(조각마다 크기 ÷ 길이의 최대, HLS 의 BANDWIDTH) · 평균 · 코덱 문자열 */
function rungOf(dir: string, plan: Shape, fps: number): LoginBackgroundRung & { average: number } {
  const playlist = fs.readFileSync(path.join(dir, "index.m3u8"), "utf8");
  const segments = [...playlist.matchAll(/#EXTINF:([\d.]+),\s*\n([^\n#]+)/g)].map((m) => ({ seconds: Number(m[1]), bytes: fs.statSync(path.join(dir, m[2].trim())).size }));
  const full = segments.filter((one) => one.seconds >= 1);
  const rates = (full.length ? full : segments).map((one) => (one.bytes * 8) / one.seconds);
  const seconds = segments.reduce((sum, one) => sum + one.seconds, 0);
  const bytes = segments.reduce((sum, one) => sum + one.bytes, 0);
  return { width: plan.width, height: plan.height, codecs: codecString(fs.readFileSync(path.join(dir, "init.mp4"))), bandwidth: Math.round(Math.max(...rates)), frameRate: Math.min(fps, FPS_CAP), average: Math.round((bytes * 8) / Math.max(seconds, 0.001)) };
}

/** 코덱마다의 목록을 다시 쓴다(인코딩해 둔 단계만, 낮은 것부터. 그 뒤 인코더가 빠졌어도 만든 것은 쓴다). 단계 값은 media.rungs 에 */
function writeMasters(item: Readonly<store.Stored>, shapes: Shape[], fps: number): store.Media["rungs"] {
  const rungs: store.Media["rungs"] = {};
  for (const codec of LOGIN_BG_CODECS) {
    const done = shapes.filter((plan) => plan.codec === codec && made(item.id, plan)).sort((a, b) => a.short - b.short);
    if (!done.length) continue;
    const values = done.map((plan) => ({ plan, rung: rungOf(rungDir(item.id, plan), plan, fps) }));
    const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS", ...values.flatMap(({ plan, rung }) => [`#EXT-X-STREAM-INF:BANDWIDTH=${rung.bandwidth},AVERAGE-BANDWIDTH=${rung.average},CODECS="${rung.codecs}",RESOLUTION=${rung.width}x${rung.height},FRAME-RATE=${rung.frameRate.toFixed(3)}`, `${plan.short}/index.m3u8`])];
    const file = path.join(codecDir(item.id, codec), "index.m3u8");
    fs.writeFileSync(`${file}.tmp`, `${lines.join("\n")}\n`);
    fs.renameSync(`${file}.tmp`, file);
    rungs[codec] = values.map(({ rung }) => ({ width: rung.width, height: rung.height, codecs: rung.codecs, bandwidth: rung.bandwidth, frameRate: rung.frameRate }));
  }
  return rungs;
}

/**
 * 이 단계들을 인코딩한다(끝난 것은 건너뛴다). 안 되는 것만 끄고 나머지는 이어 간다:
 * 나눠 인코딩하기가 실패하면 인코더를 다시 테스트하고 남은 것을 따로. 따로 인코딩하다 실패해도 다시 테스트해서, 다른 인코더가 선택되면 그것으로,
 * 쓸 인코더가 없어졌으면 그 코덱은 빼고 이어 간다. 같은 인코더가 다시 선택되면 인코더 탓이 아니라(원본 등) 실패로 둔다.
 * 인코더가 하나도 없으면 이 단계는 아무것도 만들지 않고 끝난다(로그인 화면은 남은 코덱 · 정지 그림으로)
 */
async function encodePlans({ item, signal, progress }: StageJob, codecs: LoginBackgroundCodec[]): Promise<StageResult> {
  await encodersReady();
  const probed = await probeVideo(store.sourceOf(item.id), signal);
  const size = cropped(probed.width, probed.height, item.edit!.crop);
  const fps = frameRate(probed);
  const missing = codecs.filter((codec) => !encoderFor(codec));
  if (missing.length) log.warn({ sub: "admin" }, `로그인 배경 "${item.name}": ${missing.join(" · ")} 인코더가 없어 그 코덱은 만들지 않습니다`);
  const left = plansFor(codecs, size, fps).filter((plan) => !made(item.id, plan));
  // 나눠 인코딩하기는 남은 메모리가 지금 넉넉할 때만(기다리지 않고 따로 인코딩한다)
  const together = left.length > 1 ? splitLp(left.some((plan) => plan.short >= UHD)) : null;
  if (together !== null) {
    const failure = await encodeTogether(item, probed, { plans: left, lp: together }, signal, progress);
    if (failure) {
      log.warn({ sub: "admin" }, `로그인 배경 "${item.name}"${josa(item.name, "을")} 나눠 인코딩하다 실패해 인코더를 다시 테스트하고 따로 인코딩합니다: ${failure}`);
      await recheck();
    }
  }
  const total = Math.max(1, plansFor(codecs, size, fps).filter((plan) => !made(item.id, plan)).length);
  let finished = 0;
  // 이번에 실패한 인코더(다시 테스트에서 오락가락해도 같은 것으로 되돌아가지 않게)
  const failedNow = new Set<string>();
  for (;;) {
    const plan = plansFor(codecs, size, fps).find((one) => !made(item.id, one));
    if (!plan) break;
    const what = `${plan.codec} ${plan.short}p 인코딩`;
    const uhd = plan.short >= UHD;
    const lp = plan.codec === "av1" ? await av1LpFor(uhd, what, signal) : AV1_LP_MAX;
    if (plan.codec !== "av1") await enoughMemory(needOf({ codec: plan.codec, uhd }), what, signal);
    if (lp < AV1_LP_MAX) log.info({ sub: "admin" }, `로그인 배경 "${item.name}" 의 ${what}: 남은 메모리(${(os.freemem() / 1024 ** 3).toFixed(1)}GB)에 맞춰 AV1 병렬 단계를 ${lp} 로 낮춥니다`);
    const failure = await encodeTogether(item, probed, { plans: [plan], lp }, signal, (value) => progress(Math.min(1, (finished + value) / total)));
    if (!failure) {
      finished++;
      continue;
    }
    // 디스크가 찼으면 인코더 탓이 아니다
    if (store.room() <= 0) throw codedError("background-no-space", `${what} 중 저장 공간이 찼습니다: ${failure}`);
    failedNow.add(plan.encoder);
    await recheck();
    const next = encoderFor(plan.codec);
    if (next !== null && failedNow.has(next)) throw codedError("background-failed", `${what}을 ${next} 로 하지 못했습니다(인코더 테스트는 지납니다): ${failure}`);
    log.warn({ sub: "admin" }, `로그인 배경 "${item.name}" 의 ${what}이 ${plan.encoder} 에서 실패해 인코더를 다시 테스트했습니다(${failure}). ${next ? `${next} 로 다시 인코딩합니다` : `${plan.codec} 는 쓸 수 있는 인코더가 없어 빼고 이어 갑니다`}`);
  }
  return { media: { ...item.media, rungs: { ...item.media.rungs, ...writeMasters(item, shapesFor(LOGIN_BG_CODECS, size), fps) } } };
}

/** H.264 단계(720p 하나, 먼저 따로: 로그인 화면이 저화질 영상으로 바뀐다) */
const h264 = (job: StageJob) => encodePlans(job, ["h264"]);
/** 인코딩 단계(AV1 · VP9) */
const encode = (job: StageJob) => encodePlans(job, ["av1", "vp9"]);

/** 마무리 단계: 원본 · 편집 창의 미리보기 · 장면 띠 · 다운로드하다 남은 것을 삭제한다(인코딩한 것과 정지 그림만 남는다) */
async function drop({ item }: StageJob): Promise<StageResult> {
  const folder = store.folderOf(item.id);
  for (const name of fs.readdirSync(folder)) {
    if (name === "source" || name.startsWith("source.") || name.startsWith("preview.") || name.startsWith("strip.") || name.startsWith("download.") || name.endsWith(".part")) fs.rmSync(path.join(folder, name), { recursive: true, force: true });
  }
  return {};
}

export { h264, encode, drop, plansFor, codecString, rungOf, bakeNow };
