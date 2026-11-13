// src/media/loudness-measure.ts: 캐시 파일의 음량 측정과 측정 큐
//
// 지키는 것: 진행 줄이 섞여도 ebur128 의 100ms 줄과 요약을 읽고, 피크 상위 1% 는 게이트(-70 LUFS)를 넘은 프레임에서만 구한다.
// 실패 분류: 진행 멈춤, 0 이 아닌 종료 코드, 줄이나 요약을 못 읽은 것은 환경 탓(기록하지 않는다), 줄 수가 길이와 안 맞거나 너무 조용하거나 게이트를 넘은 프레임이 없는 것은 파일 탓(file-failed).
// 큐: 캐시 파일이 있고 맞는 값도 file-failed 도 없을 때만 넣고, 같은 키를 두 번 넣지 않는다. 지금 곡은 미리 받는 곡의 측정을 밀어내고(밀린 것은 다시 잰다),
// 다른 지금 곡은 밀어내지 않는다. 재는 동안 파일 삭제를 막는다. 서버 문맥 밖에서 돈다. 자체 테스트가 실패하면 측정만 끈다. 종료 중에는 ffmpeg 를 실행하지 않는다.
// 이 PC 의 ffmpeg 로 자체 테스트를 통과하고 실제 측정값이 맞다(ffmpeg 가 없으면 건너뛴다).

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openTempStore } from "../helpers/temp-store.ts";
import type { FfmpegJob, FfmpegResult } from "../../src/media/ffmpeg/job.ts";

const store = openTempStore("loudness-measure-");
after(() => store.close());
const { MeasureQueue, readingOf, verdictOf } = await import("../../src/media/loudness-measure.ts");
const audioCache = await import("../../src/store/audio-cache.ts");
const loudness = await import("../../src/store/loudness.ts");
const { inGuild, currentGuild } = await import("../../src/infra/guild-context.ts");
const shutdown = await import("../../src/infra/shutdown-state.ts");
const { ffmpegPath } = await import("../../src/media/ffmpeg/path.ts");

// 이 PC 의 ffmpeg 출력(1kHz 사인파 0.6초)에 진행 줄을 섞은 표본
const SAMPLE = [
  "[Parsed_ebur128_2 @ 00000225904c9880] t: 0.0999792  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -41.1 -41.1 dBFS  TPK: -41.1 -41.1 dBFS",
  "out_time_us=100000",
  "[Parsed_ebur128_2 @ 00000225904c9880] t: 0.199979   TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -inf -inf dBFS  TPK: -41.1 -41.1 dBFS",
  "[Parsed_ebur128_2 @ 00000225904c9880] t: 0.299979   TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -41.1 -41.1 dBFS  TPK: -41.1 -41.1 dBFS",
  "[Parsed_ebur128_2 @ 00000225904c9880] t: 0.399979   TARGET:-23 LUFS    M: -41.1 S:-120.7     I: -41.1 LUFS       LRA:   0.0 LU  FTPK: -41.1 -42.0 dBFS  TPK: -41.1 -41.1 dBFS",
  "out_time_us=400000",
  "[Parsed_ebur128_2 @ 00000225904c9880] t: 0.499979   TARGET:-23 LUFS    M: -41.1 S:-120.7     I: -41.1 LUFS       LRA:   0.0 LU  FTPK: -40.5 -41.1 dBFS  TPK: -41.1 -41.1 dBFS",
  "[Parsed_ebur128_2 @ 00000225904c9880] t: 0.599979   TARGET:-23 LUFS    M: -41.1 S:-120.7     I: -41.1 LUFS       LRA:   0.0 LU  FTPK: -41.1 -41.1 dBFS  TPK: -41.1 -41.1 dBFS",
  "[Parsed_ebur128_2 @ 00000225904c9880] Summary:",
  "  Integrated loudness:",
  "    I:         -41.1 LUFS",
  "    Threshold: -51.1 LUFS",
  "  Loudness range:",
  "    LRA:         0.0 LU",
  "  True peak:",
  "    Peak:      -40.5 dBFS",
  "progress=end",
];

const readAll = (lines: string[]) => {
  const reading = readingOf();
  for (const line of lines) reading.feed(line);
  return reading.result();
};

test("진행 줄이 섞여도 100ms 줄과 요약을 읽고, 피크 상위 1% 는 게이트를 넘은 프레임에서만 구한다", () => {
  assert.deepEqual(readAll(SAMPLE), { lines: 6, loudFrames: 3, integrated: -41.1, truePeak: -40.5, peakP99: -40.5 });
});

test("실패 분류: 환경 탓과 파일 탓", () => {
  const ok = readAll(SAMPLE);
  const done = { code: 0, timedOut: false };
  assert.deepEqual(verdictOf(done, { ...ok, integrated: -9 }, 0.6), { kind: "ok", value: { integrated: -9, truePeak: -40.5, peakP99: -40.5 } });
  assert.equal(verdictOf({ code: null, timedOut: true }, ok, 0.6).kind, "env", "진행 멈춤");
  assert.equal(verdictOf({ code: 1, timedOut: false }, ok, 0.6).kind, "env", "0 이 아닌 종료 코드");
  assert.equal(verdictOf(done, { ...ok, lines: 0 }, 0.6).kind, "env", "줄 형식이 다른 빌드");
  assert.equal(verdictOf(done, { ...ok, integrated: null }, 0.6).kind, "env", "요약 없음");
  assert.equal(verdictOf(done, { ...ok, integrated: -9 }, 0.7).kind, "ok", "한 줄 차이는 허용한다");
  assert.equal(verdictOf(done, { ...ok, integrated: -9 }, 61).kind, "file", "앞부분만 남은 파일");
  assert.equal(verdictOf(done, { ...ok, integrated: -9 }, null).kind, "ok", "길이를 모르면 대조하지 않는다");
  assert.equal(verdictOf(done, ok, 0.6).kind, "ok");
  assert.equal(verdictOf(done, { ...ok, integrated: -55 }, 0.6).kind, "file", "너무 조용함");
  assert.equal(verdictOf(done, { ...ok, peakP99: null, loudFrames: 0 }, 0.6).kind, "file", "게이트를 넘은 프레임 없음");
});

// ── 측정 큐 ──

type Call = { args: string[]; options: FfmpegJob; finish(lines: string[], result?: Partial<FfmpegResult>): void; guild: string | null };
const RESULT: FfmpegResult = { code: 0, signal: null, stdout: "", output: Buffer.alloc(0), stderr: "", aborted: false, timedOut: false };
const GOOD = (integrated = -9.5) => SAMPLE.map((line) => line.replace("I:         -41.1", `I:         ${integrated}`));
const PROBE = [...Array.from({ length: 20 }, () => SAMPLE[3] as string), "  Integrated loudness:", "    I:         -20.0 LUFS", "  True peak:", "    Peak:      -20.0 dBFS"];

// 가짜 ffmpeg. 자체 테스트(표준 입력이 있는 호출)는 맞는 출력으로 바로 끝낸다. 파일은 테스트가 finish 로 끝낸다
function fakeRun({ probe = PROBE } = {}) {
  const calls: Call[] = [];
  const run = (args: string[], options: FfmpegJob) =>
    new Promise<FfmpegResult>((resolve) => {
      const finish = (lines: string[], result: Partial<FfmpegResult> = {}) => {
        for (const line of lines) options.onStderrLine?.(line);
        resolve({ ...RESULT, ...result });
      };
      if (options.input) return finish(probe);
      options.signal?.addEventListener("abort", () => resolve({ ...RESULT, code: null, aborted: true }));
      calls.push({ args, options, finish, guild: currentGuild() });
    });
  return { calls, run };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function seed(key: string, durationSec = 0.6) {
  fs.mkdirSync(audioCache.cacheDir(), { recursive: true });
  const file = audioCache.getFilePath(key);
  fs.writeFileSync(file, "x".repeat(100));
  store.db().prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, duration_sec, downloaded_at, created_at) VALUES (?, 'cached', ?, 100, ?, 1, 0)").run(key, file, durationSec);
}

beforeEach(() => {
  store.db().prepare("DELETE FROM loudness").run();
  store.db().prepare("DELETE FROM audio_cache").run();
  shutdown._resetShutdown();
});

test("캐시 파일이 있고 맞는 값도 file-failed 도 없을 때만 큐에 넣고, 같은 키를 두 번 넣지 않는다", async () => {
  const { calls, run } = fakeRun();
  const queue = new MeasureQueue({ run });
  seed("yt:a");
  seed("yt:b");
  loudness.recordFile("yt:b", { integrated: -9, truePeak: -1, peakP99: -3 }, { sizeBytes: 100, durationSec: 0.6, audioVersion: null });
  queue.request("yt:none");
  queue.request("yt:b");
  queue.request("yt:a");
  queue.request("yt:a");
  await settle();
  assert.deepEqual(
    calls.map((c) => c.args.at(-6)),
    [audioCache.getFilePath("yt:a")],
  );
  calls[0]?.finish(GOOD());
  await settle();
  assert.equal(loudness.rowsOf("yt:a").file?.integrated, -9.5);
  queue.request("yt:a");
  await settle();
  assert.equal(calls.length, 1, "잰 파일은 다시 재지 않는다");
});

test("지금 곡은 미리 받는 곡의 측정을 밀어내고, 밀린 것은 뒤에 다시 잰다. 다른 지금 곡은 밀어내지 않는다", async () => {
  const { calls, run } = fakeRun();
  const queue = new MeasureQueue({ run });
  for (const key of ["yt:pre", "yt:now", "yt:now2"]) seed(key);
  queue.request("yt:pre");
  await settle();
  queue.request("yt:now", { current: true });
  await settle();
  assert.deepEqual(
    calls.map((c) => c.options.signal?.aborted),
    [true, false],
  );
  queue.request("yt:now2", { current: true });
  await settle();
  assert.equal(calls.length, 2, "지금 곡을 재는 중이면 밀어내지 않는다");
  calls[1]?.finish(GOOD(-8));
  await settle();
  calls[2]?.finish(GOOD(-7));
  await settle();
  calls[3]?.finish(GOOD(-6));
  await settle();
  assert.deepEqual(
    ["yt:now", "yt:now2", "yt:pre"].map((key) => loudness.rowsOf(key).file?.integrated),
    [-8, -7, -6],
    "지금 곡 둘 다음에 밀린 곡을 처음부터 다시 잰다",
  );
});

test("파일 탓이면 file-failed 로 기록해 다시 재지 않고, 환경 탓이면 기록하지 않는다", async () => {
  const { calls, run } = fakeRun();
  const queue = new MeasureQueue({ run });
  seed("yt:short", 61);
  seed("yt:env");
  queue.request("yt:short");
  queue.request("yt:env");
  await settle();
  calls[0]?.finish(GOOD());
  await settle();
  calls[1]?.finish([], { code: 1 });
  await settle();
  assert.ok(loudness.rowsOf("yt:short")["file-failed"]);
  assert.deepEqual(loudness.rowsOf("yt:env"), {});
  queue.request("yt:short");
  queue.request("yt:env");
  await settle();
  assert.equal(calls.length, 3, "환경 탓만 다시 잰다");
});

test("재는 동안 파일 삭제를 막고 서버 문맥 밖에서 돈다. 다 재면 값을 알린다", async () => {
  const { calls, run } = fakeRun();
  const queue = new MeasureQueue({ run });
  const measured: string[] = [];
  queue.onMeasured((key) => measured.push(key));
  seed("yt:held");
  inGuild("g1", () => queue.request("yt:held", { current: true }));
  await settle();
  assert.equal(calls[0]?.guild, null);
  assert.deepEqual(await audioCache.removeCached("yt:held", 1), { ok: false, code: "in-use", where: "measuring" });
  calls[0]?.finish(GOOD());
  await settle();
  assert.deepEqual(measured, ["yt:held"]);
  assert.equal((await audioCache.removeCached("yt:held", 1)).ok, true);
});

test("자체 테스트가 실패하면 측정만 끄고, 종료 중에는 ffmpeg 를 실행하지 않는다", async () => {
  const wrong = fakeRun({ probe: SAMPLE });
  const off = new MeasureQueue({ run: wrong.run });
  seed("yt:x");
  off.request("yt:x");
  await settle();
  await settle();
  assert.equal(wrong.calls.length, 0);

  const { calls, run } = fakeRun();
  const queue = new MeasureQueue({ run });
  shutdown.beginShutdown();
  queue.request("yt:x");
  await settle();
  assert.equal(calls.length, 0);
});

// ── 이 PC 의 ffmpeg ──

const hasFfmpeg = () => spawnSync(ffmpegPath(), ["-version"]).status === 0;

test("실제 ffmpeg: 자체 테스트를 통과하고, 테스트용 사인파 파일(-20 dBFS, 3초)을 잰다", async (t) => {
  if (!hasFfmpeg()) return t.skip("ffmpeg 없음");
  const key = "yt:real";
  fs.mkdirSync(audioCache.cacheDir(), { recursive: true });
  const file = audioCache.getFilePath(key);
  const made = spawnSync(ffmpegPath(), ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=f=1000:d=3:sample_rate=48000,volume=0.8,pan=stereo|c0=c0|c1=c0", "-c:a", "libopus", "-b:a", "128k", "-f", "ogg", file]);
  if (made.status !== 0) return t.skip("ffmpeg 로 Opus 를 만들 수 없음");
  store.db().prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, duration_sec, downloaded_at, created_at) VALUES (?, 'cached', ?, ?, 3, 1, 0)").run(key, file, fs.statSync(file).size);
  const queue = new MeasureQueue();
  const done = new Promise<string>((resolve) => queue.onMeasured(resolve));
  queue.request(key);
  assert.equal(await done, key);
  const value = loudness.rowsOf(key).file;
  assert.ok(value && Math.abs(value.integrated - -20) < 1, `통합 음량 ${value?.integrated}`);
  assert.ok(value && value.truePeak < 0 && value.peakP99 <= value.truePeak + 0.1, JSON.stringify(value));
  assert.equal(path.basename(file), path.basename(audioCache.getFilePath(key)));
});
