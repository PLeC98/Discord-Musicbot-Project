// src/dashboard/login-background/encode.ts — H.264 · AV1 · VP9 를 HLS(fMP4)로 굽고 코덱마다 목록을 쓴다. 실제 ffmpeg 로 작은 영상을 굽는다(없으면 건너뛴다)
// 단계 크기 셈(4K · 세로 · 작은 원본) · 구간과 크롭 · 이어 하기(끝난 단계는 건너뛰고 임시 폴더는 치운다) · 마무리(원본 삭제) · 코어 셈

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpegPath } from "../../src/media/ffmpeg/path.ts";
import { runFfmpeg } from "../../src/media/ffmpeg/job.ts";
import { encodeCores } from "../../src/infra/cpu-affinity.ts";
import * as store from "../../src/dashboard/login-background/store.ts";
import * as encoders from "../../src/dashboard/login-background/encoders.ts";
import { inspectSource } from "../../src/dashboard/login-background/source.ts";
import { bakeNow, drop, encode, h264, plansFor } from "../../src/dashboard/login-background/encode.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "login-bg-encode-"));
const SAMPLE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "login-bg-encode-sample-")), "clip.mp4");
/** 움직이는 WebP: 같은 색 2초가 장면 하나로 적힌 세 장면(투명 채널이 있다) */
const ANIMATED = path.join(path.dirname(SAMPLE), "cuts.webp");
after(() => {
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
  fs.rmSync(path.dirname(SAMPLE), { recursive: true, force: true, maxRetries: 5 });
});
const BIN = (() => {
  try {
    return ffmpegPath();
  } catch {
    return null;
  }
})();
const opts = { skip: BIN ? false : "ffmpeg 바이너리 없음" };
const signal = new AbortController().signal;

before(async () => {
  store._useDir(DIR);
  if (!BIN) return;
  encoders.startEncoderCheck();
  await encoders.encodersReady();
  await runFfmpeg(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=60", "-t", "3", "-c:v", "mpeg4", "-q:v", "4", SAMPLE]);
  const cuts = ["d02020", "081860", "40e060"].flatMap((color) => ["-f", "lavfi", "-i", `color=c=0x${color}:s=320x180:r=10:d=2`]);
  await runFfmpeg(["-v", "error", "-y", ...cuts, "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1[v]", "-map", "[v]", "-c:v", "libwebp_anim", "-loop", "0", ANIMATED]);
});

async function applied(edit: store.Stored["edit"], sample = SAMPLE) {
  const one = store.create({ kind: "video", from: "upload", name: path.basename(sample) });
  fs.copyFileSync(sample, store.sourceOf(one.id));
  Object.assign(one, await inspectSource(store.sourceOf(one.id), signal), { edit });
  return one;
}
const job = (one: store.Stored, progress: (value: number) => void = () => {}) => ({ item: one, folder: store.folderOf(one.id), signal, progress });
const at = (one: store.Stored, ...parts: string[]) => path.join(store.folderOf(one.id), ...parts);
const seconds = (playlist: string) => [...fs.readFileSync(playlist, "utf8").matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
const FULL = { x: 0, y: 0, w: 1, h: 1 };

test("단계 크기: AV1 · VP9 는 짧은 변 1080 · 2160(원본이 2160 이상일 때만), 작으면 원본 크기 하나, H.264 는 720", opts, () => {
  const shorts = (width: number, height: number) => plansFor(["av1", "vp9", "h264"], { width, height }, 30).map((plan) => `${plan.codec} ${plan.width}x${plan.height}`);
  assert.deepEqual(shorts(3840, 2160), ["av1 1920x1080", "av1 3840x2160", "vp9 1920x1080", "vp9 3840x2160", "h264 1280x720"]);
  assert.deepEqual(shorts(2160, 3840), ["av1 1080x1920", "av1 2160x3840", "vp9 1080x1920", "vp9 2160x3840", "h264 720x1280"]);
  assert.deepEqual(shorts(2560, 1440), ["av1 1920x1080", "vp9 1920x1080", "h264 1280x720"]);
  assert.deepEqual(shorts(640, 360), ["av1 640x360", "vp9 640x360", "h264 640x360"]);
  // 키프레임 2초: 30fps 이하는 그 두 배, 넘으면 30fps 로 줄여 60
  assert.ok(plansFor(["vp9"], { width: 640, height: 360 }, 24)[0].options.join(" ").includes("-g 48"));
  assert.ok(plansFor(["vp9"], { width: 640, height: 360 }, 60)[0].options.join(" ").includes("-g 60"));
});

test("H.264 단계: 720p 이하 HLS 와 코덱 목록(코덱 문자열 · 2초 최대), 구간 · 크롭을 따른다", opts, async () => {
  const one = await applied({ crop: { x: 0, y: 0, w: 0.5, h: 1 }, range: [0.5, 2.5], thumbAt: null });
  const progress: number[] = [];
  const result = await h264(job(one, (value) => progress.push(value)));
  const [rung] = result.media!.rungs.h264!;
  assert.deepEqual([rung.width, rung.height, rung.frameRate], [320, 360, 30]);
  assert.match(rung.codecs, /^avc1\.[0-9a-f]{6}$/);
  assert.ok(rung.bandwidth > 0);
  const master = fs.readFileSync(at(one, "h264", "index.m3u8"), "utf8");
  assert.match(master, /#EXT-X-STREAM-INF:BANDWIDTH=\d+,AVERAGE-BANDWIDTH=\d+,CODECS="avc1\.[0-9a-f]{6}",RESOLUTION=320x360,FRAME-RATE=30\.000\n320\/index\.m3u8/);
  assert.ok(Math.abs(seconds(at(one, "h264", "320", "index.m3u8")) - 2) < 0.1);
  assert.ok(fs.existsSync(at(one, "h264", "320", "init.mp4")));
  assert.ok(progress.length > 0);
});

test("굽기 단계: AV1(10비트) · VP9 를 굽고 목록을 쓴다. 끝난 단계는 건너뛰고 남은 임시 폴더는 치운다", opts, async () => {
  if (!encoders.encoderFor("av1") || !encoders.encoderFor("vp9")) return;
  const one = await applied({ crop: FULL, range: null, thumbAt: null });
  // 굽는 동안 운영자 패널에 보이는 것: 함께 굽는 단계 · AV1 병렬 단계 · 코어
  const seen: NonNullable<ReturnType<typeof bakeNow>>[] = [];
  const watch = setInterval(() => {
    const now = bakeNow();
    if (now) seen.push(now);
  }, 20);
  const first = await encode(job(one)).finally(() => clearInterval(watch));
  assert.equal(bakeNow(), null, "끝나면 비운다");
  assert.ok(seen.length > 0);
  assert.equal(seen[0].id, one.id);
  assert.ok(seen.every((bake) => bake.rungs.every((rung) => rung.short === 360) && (bake.lp ?? 5) >= 1 && bake.cores.total === os.cpus().length));
  assert.ok(seen.some((bake) => bake.rungs.some((rung) => rung.codec === "av1") && bake.lp !== null));
  assert.match(first.media!.rungs.av1![0].codecs, /^av01\.0\.\d{2}M\.10$/);
  assert.match(first.media!.rungs.vp9![0].codecs, /^vp09\.00\.\d{2}\.08$/);
  for (const codec of ["av1", "vp9"]) assert.match(fs.readFileSync(at(one, codec, "index.m3u8"), "utf8"), /360\/index\.m3u8/);
  // 이어 하기: VP9 를 삭제하고 끊긴 임시 폴더를 둔 채 다시
  const av1Mtime = fs.statSync(at(one, "av1", "360", "index.m3u8")).mtimeMs;
  fs.rmSync(at(one, "vp9", "360"), { recursive: true });
  fs.mkdirSync(at(one, "vp9", "360.tmp"), { recursive: true });
  fs.writeFileSync(at(one, "vp9", "360.tmp", "seg-000.m4s"), "끊긴 조각");
  one.media = first.media!;
  const again = await encode(job(one));
  assert.equal(fs.statSync(at(one, "av1", "360", "index.m3u8")).mtimeMs, av1Mtime);
  assert.equal(fs.existsSync(at(one, "vp9", "360.tmp")), false);
  assert.ok(fs.existsSync(at(one, "vp9", "360", "index.m3u8")));
  assert.deepEqual(Object.keys(again.media!.rungs).sort(), ["av1", "vp9"]);
});

test("움직이는 그림: 30fps 로 고르게 펴 구간대로 굽는다(입력 앞 -ss 로 찾아가지 않는다)", opts, async () => {
  const one = await applied({ crop: FULL, range: [1, 5], thumbAt: null }, ANIMATED);
  assert.equal(one.fps, 30);
  const [rung] = (await h264(job(one))).media!.rungs.h264!;
  assert.equal(rung.frameRate, 30);
  assert.ok(Math.abs(seconds(at(one, "h264", "180", "index.m3u8")) - 4) < 0.1);
  if (!encoders.encoderFor("vp9")) return;
  await encode(job(one));
  assert.ok(Math.abs(seconds(at(one, "vp9", "180", "index.m3u8")) - 4) < 0.1);
});

test("인코더가 없는 코덱은 만들지 않고 단계는 끝난다(로그인 화면은 남은 코덱 · 정지 그림으로)", opts, async () => {
  const one = await applied({ crop: FULL, range: [0, 2], thumbAt: null });
  encoders._reset();
  try {
    const result = await h264(job(one));
    assert.equal(result.media!.rungs.h264, undefined);
    assert.equal(fs.existsSync(at(one, "h264")), false);
  } finally {
    encoders.startEncoderCheck();
    await encoders.encodersReady();
  }
});

test("마무리: 원본 · 미리보기 · 장면 띠는 삭제하고 구운 것 · 정지 그림은 남긴다", opts, async () => {
  const one = await applied({ crop: FULL, range: null, thumbAt: null });
  for (const name of ["preview.mp4", "strip.webp", "still-640.webp", "download.info.json"]) fs.writeFileSync(at(one, name), "x");
  await h264(job(one));
  await drop(job(one));
  assert.deepEqual(fs.readdirSync(store.folderOf(one.id)).sort(), ["h264", "still-640.webp"]);
});

test("굽기 코어: 논리 코어의 80%, 최소 2개는 비운다(위쪽 코어부터)", () => {
  const { first, count, total } = encodeCores();
  assert.equal(first + count, total);
  assert.ok(count >= 1 && (total <= 2 || total - count >= 2));
  assert.ok(count <= Math.max(1, Math.floor(total * 0.8)));
});

test("메모리 관문: 넉넉하면 바로 지나고, 멈추면 기다리지 않는다", async () => {
  const { enoughMemory } = await import("../../src/dashboard/login-background/memory.ts");
  const started = Date.now();
  await enoughMemory(0, "시험", signal);
  const stopped = new AbortController();
  stopped.abort();
  await enoughMemory(Number.MAX_SAFE_INTEGER, "시험", stopped.signal);
  assert.ok(Date.now() - started < 1000);
});

test("AV1 병렬 단계: 남은 메모리에 드는 가장 높은 것(5 까지), 나눠 굽기는 3 · 2 만(들지 않으면 따로)", async () => {
  const { av1Lp, splitLp, needOf } = await import("../../src/dashboard/login-background/memory.ts");
  const GB = 1024 ** 3;
  assert.deepEqual(
    [64, 8, 7, 5, 4.2, 3].map((free) => av1Lp(true, free * GB)),
    [5, 4, 4, 2, 1, null],
  );
  assert.deepEqual(
    [64, 2.6, 2, 1.5, 1].map((free) => av1Lp(false, free * GB)),
    [5, 4, 3, 1, null],
  );
  assert.deepEqual(
    [64, 8.5, 7, 6].map((free) => splitLp(true, free * GB)),
    [3, 3, 2, null],
  );
  assert.deepEqual(
    [64, 2.9, 2.6, 2].map((free) => splitLp(false, free * GB)),
    [3, 3, 2, null],
  );
  // VP9 · H.264 는 가볍다(AV1 4K 의 몇 분의 일)
  assert.ok(needOf({ codec: "vp9", uhd: true }) < needOf({ codec: "av1", uhd: true, lp: 1 }));
  assert.ok(needOf({ codec: "h264" }) < 2 * GB);
});

test("진행 감시: out_time_us 가 늘면 다시 재고, 멈추면 알린다", async () => {
  const { progressWatch } = await import("../../src/media/ffmpeg/job.ts");
  let stalled = 0;
  const watch = progressWatch(80, () => stalled++);
  for (let i = 1; i <= 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    watch.feed(`out_time_us=${i * 1000}`);
    // 늘지 않은 값 · 다른 줄은 다시 재지 않는다
    watch.feed("progress=continue");
  }
  assert.equal(stalled, 0);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(stalled, 1);
  watch.stop();
});
