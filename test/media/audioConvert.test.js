// src/media/convert.ts: 받아 온 오디오를 캐시 규격(.opus)으로 만들 때의 판단.
//
// 회귀 대상: 직접 링크 갈래가 무엇이 들어오든 무조건 재인코딩하던 것. AnimeThemes 음원이
// 이미 Opus 186~329k 인데 그걸 128k 로 다시 구워 저장했다(2026-09-21 실측).
//
// 숫자가 둘인 것이 핵심이다. 상한은 Opus 소스를 Opus 로 다시 쓸지 재는 자리에만 걸리고,
// 변환 목표는 소스 비트레이트와 무관하다. mp3 128k 와 Opus 128k 는 같은 값이 아니므로
// 코덱을 넘나들며 숫자를 비교하면 안 된다.

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { test, after } from "node:test";
import assert from "node:assert/strict";

import audioConvert from "../../src/media/convert.ts";
import { createRequire } from "node:module";

// 함수 안에서 부르는 것과 글자가 아닌 경로는 그대로 require 로
const require = createRequire(import.meta.url);

const { planFor, REMUX_MAX_KBPS, REMUX_SLACK, TRANSCODE_TARGET_KBPS } = audioConvert;
const { argsFor } = audioConvert._internals;
const { probeAudio, _internals: ffmpegInternals } = (await import("../../src/media/ffmpeg/process.ts")).default;
const { parseProbeOutput } = ffmpegInternals;

const idx = (args, flag) => args.indexOf(flag);

test("이미 Opus 면 그대로 옮긴다. 손실 세대를 쓰지 않는다", () => {
  for (const kbps of [96, 128, 186, 205, 318, 329, REMUX_MAX_KBPS]) {
    const plan = planFor({ codec: "opus", bitrateKbps: kbps });
    assert.equal(plan.action, "copy", `${kbps}k`);
  }
});

test("상한을 아슬아슬하게 넘긴 것은 굽지 않는다. 구우면 오히려 커진다", () => {
  // 실측: 323k 를 `-b:a 320k` 로 구웠더니 324k 가 나오고 파일이 4KB 늘었다(libopus VBR).
  // 손실 세대와 CPU 를 쓰고 용량도 손해라면 할 이유가 없다.
  for (const kbps of [REMUX_MAX_KBPS + 1, 329, Math.floor(REMUX_MAX_KBPS * REMUX_SLACK)]) {
    assert.equal(planFor({ codec: "opus", bitrateKbps: kbps }).action, "copy", `${kbps}k`);
  }
});

test("크게 넘는 Opus 만 상한까지 낮춰 다시 굽는다", () => {
  const plan = planFor({ codec: "opus", bitrateKbps: 510 }); // libopus 스테레오 상한
  assert.equal(plan.action, "transcode");
  assert.equal(plan.bitrateKbps, REMUX_MAX_KBPS, "상한까지만 낮춘다");

  // 상시 작동하는 값이면 상한이 아니라 그냥 재인코딩 정책이다. 실측 표본이 다 통과해야 한다.
  for (const kbps of [186, 205, 288, 310, 318, 319]) {
    assert.equal(planFor({ codec: "opus", bitrateKbps: kbps }).action, "copy", `AnimeThemes ${kbps}k`);
  }
});

test("Opus 가 아니면 소스 비트레이트와 무관하게 같은 목표로 굽는다", () => {
  // mp3 320k 를 320k opus 로 굽는 판단이 나오면 안 된다. 같은 자로 잰 값이 아니다.
  for (const [codec, kbps] of [
    ["mp3", 320],
    ["mp3", 128],
    ["aac", 160],
    ["flac", 1000],
    ["vorbis", 500],
    ["pcm_s16le", 1411],
  ]) {
    const plan = planFor({ codec, bitrateKbps: kbps });
    assert.equal(plan.action, "transcode", `${codec} ${kbps}k`);
    assert.equal(plan.bitrateKbps, TRANSCODE_TARGET_KBPS, `${codec} ${kbps}k, 목표는 소스와 무관하다`);
  }
});

test("코덱을 못 읽으면 굽는다. 모를 때 리먹싱하면 컨테이너가 어긋난다", () => {
  for (const info of [{ codec: null, bitrateKbps: 200 }, {}, null]) {
    const plan = planFor(info);
    assert.equal(plan.action, "transcode");
    assert.equal(plan.bitrateKbps, TRANSCODE_TARGET_KBPS);
  }
});

test("비트레이트를 못 읽은 Opus 는 그대로 옮긴다. 상한은 아는 값에만 건다", () => {
  const plan = planFor({ codec: "opus", bitrateKbps: null });
  assert.equal(plan.action, "copy");
});

test("코덱 이름의 대소문자는 가리지 않는다", () => {
  assert.equal(planFor({ codec: "OPUS", bitrateKbps: 200 }).action, "copy");
});

test("인자: 리먹싱은 -c:a copy, 변환은 libopus + 목표 비트레이트", () => {
  const copy = argsFor({ action: "copy", bitrateKbps: 200 }, "/in.ogg", "/out.opus");
  assert.equal(copy[idx(copy, "-c:a") + 1], "copy");
  assert.equal(idx(copy, "-b:a"), -1, "스트림 카피에 비트레이트를 주면 헷갈린다");

  const enc = argsFor({ action: "transcode", bitrateKbps: 128 }, "/in.mp3", "/out.opus");
  assert.equal(enc[idx(enc, "-c:a") + 1], "libopus");
  assert.equal(enc[idx(enc, "-b:a") + 1], "128k");
});

test("인자: 출력은 언제나 opus 컨테이너이고 -vn 이 붙는다", () => {
  // 캐시 파일명이 `.opus` 전제다. 앨범아트가 붙은 파일을 그대로 옮기면 그림까지 따라온다.
  for (const plan of [
    { action: "copy", bitrateKbps: 200 },
    { action: "transcode", bitrateKbps: 128 },
  ]) {
    const args = argsFor(plan, "/in", "/out.opus");
    assert.equal(args[idx(args, "-f") + 1], "opus", plan.action);
    assert.ok(args.includes("-vn"), plan.action);
    assert.equal(args[idx(args, "-i") + 1], "/in");
    assert.equal(args[idx(args, "-y") + 1], "/out.opus");
  }
});

test("yt-dlp 갈래도 같은 목표 비트레이트를 쓴다. 숫자가 두 군데에 적히지 않게", () => {
  assert.deepEqual(audioConvert.ytdlpPostprocessorArgs(), { ffmpeg: ["-b:a", `${TRANSCODE_TARGET_KBPS}k`] });
});

// ── probe 파싱 ────────────────────────────────────────────────────────────────

test("probe 파싱: 스트림 줄에 비트레이트가 있으면 그쪽이 이긴다", () => {
  // 컨테이너 값은 오버헤드가 섞인다. 둘 다 있으면 스트림 쪽이 실제 오디오다.
  const info = parseProbeOutput(`
  Duration: 00:04:01.00, start: 0.025057, bitrate: 322 kb/s
    Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s
`);
  assert.equal(info.codec, "mp3");
  assert.equal(info.bitrateKbps, 320);
  assert.equal(info.durationSec, 241);
});

test("probe 파싱: 스트림 줄에 없으면 컨테이너 값을 쓴다 (Opus 가 그렇다)", () => {
  const info = parseProbeOutput(`
  Duration: 00:01:30.06, start: 0.007500, bitrate: 323 kb/s
    Stream #0:0: Audio: opus, 48000 Hz, stereo, fltp, start 0.007500
`);
  assert.equal(info.codec, "opus");
  assert.equal(info.bitrateKbps, 323);
  assert.equal(info.durationSec, 90);
});

// 컨테이너 값을 오디오로 읽으면 멀쩡한 opus 를 상한까지 다시 굽는다.
test("probe 파싱: 영상이 섞여 있으면 컨테이너 값을 쓰지 않는다", () => {
  const info = parseProbeOutput(`
  Duration: 00:01:29.14, start: 0.000000, bitrate: 4662 kb/s
    Stream #0:0: Video: vp9 (Profile 0), yuv420p(tv, bt709, progressive), 1280x720, 23.98 fps
    Stream #0:1: Audio: opus, 48000 Hz, stereo, fltp (default)
`);
  assert.equal(info.codec, "opus");
  assert.equal(info.bitrateKbps, null, "4662k 는 영상까지 합친 값이다");
  assert.equal(info.durationSec, 89);
  assert.equal(planFor(info).action, "copy", "모르면 굽지 않는다");
});

test("probe 파싱: 영상이 있어도 오디오 스트림에 적혀 있으면 그 값을 쓴다", () => {
  const info = parseProbeOutput(`
  Duration: 00:02:00.00, start: 0.000000, bitrate: 2048 kb/s
    Stream #0:0: Video: h264, yuv420p, 1920x1080, 30 fps
    Stream #0:1: Audio: aac, 44100 Hz, stereo, fltp, 129 kb/s
`);
  assert.equal(info.bitrateKbps, 129);
});

test("probe 파싱: 읽을 것이 없으면 전부 null", () => {
  for (const text of ["", "Invalid data found when processing input", null]) {
    assert.deepEqual(parseProbeOutput(text), { durationSec: null, codec: null, bitrateKbps: null });
  }
});

// ── 실물 한 번 ────────────────────────────────────────────────────────────────

const TONE = path.join(os.tmpdir(), `musicbot-convert-${process.pid}.opus`);
const OUT = path.join(os.tmpdir(), `musicbot-convert-${process.pid}-out.opus`);
after(() => {
  for (const f of [TONE, OUT]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* 이미 없음 */
    }
  }
});

test("실물: 만들어 둔 opus 를 읽고, 다시 옮겨도 같은 길이가 나온다", async (t) => {
  const { spawnFfmpeg } = require("../../src/media/ffmpeg/process.ts");
  const made = await new Promise((resolve) => {
    let child;
    try {
      child = spawnFfmpeg(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "libopus", "-b:a", "96k", "-f", "opus", "-y", TONE], "probe", { killOnStdoutClose: false });
    } catch {
      return resolve(false);
    }
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
  if (!made) return t.skip("ffmpeg로 시료를 만들 수 없음");

  const info = await probeAudio(TONE);
  assert.equal(info.codec, "opus", "만든 것을 다시 읽을 수 있어야 한다");
  assert.equal(info.durationSec, 3);

  // 96k 짜리라 상한 아래다. 리먹싱으로 가야 한다
  assert.equal(planFor(info).action, "copy");

  const result = await audioConvert.toCacheOpus(TONE, OUT);
  assert.equal(result.action, "copy");
  const after2 = await probeAudio(OUT);
  assert.equal(after2.codec, "opus");
  assert.equal(after2.durationSec, 3, "옮긴 뒤에도 길이가 같아야 한다");
});

// ── SC-4 ─────────────────────────────────────────────────────────────────────

test("음원을 빌려 오는 것은 음원 주소가 없는 곡(스포티파이)뿐이다. 사운드클라우드는 제 음원을 준다", () => {
  // 상류가 둘을 DRM 으로 묶어 둬서 `sc:` 키 안에 유튜브 음원이 들어갔다. 같은 곡이 처음 틀 때와
  // 캐시로 틀 때 서로 다른 녹음이 됐고, 유튜브 검색이 헛짚으면 그 키에 다른 곡이 박힌 채 남았다.
  const { needsBorrowedAudio } = require("../../src/media/cacheDownload.ts")._internals;

  assert.equal(needsBorrowedAudio({ platform: "spotify" }), true);
  assert.equal(needsBorrowedAudio({ platform: "soundcloud", audioUrl: "https://soundcloud.com/a/b" }), false, "SC-4");
  assert.equal(needsBorrowedAudio({ platform: "youtube", audioUrl: "https://www.youtube.com/watch?v=x" }), false);
  assert.equal(needsBorrowedAudio({ platform: "direct", audioUrl: "https://f.test/a.mp3" }), false);
  // 이미 찾아 둔 영상이 있으면 다시 찾지 않는다(자동재생 출처 트랙)
  assert.equal(needsBorrowedAudio({ platform: "spotify", audioUrl: "https://www.youtube.com/watch?v=x" }), false);
  assert.equal(needsBorrowedAudio(null), false);
});
