// src/media/ffmpeg/trial.ts · dashboard/login-background/encoders.ts — 작은 시험 인코딩으로 쓸 수 있는 인코더를 고른다.
// 실제 ffmpeg 를 돌린다(없으면 건너뛴다). 어느 인코더가 있는지는 빌드마다 달라 "고른 것은 후보 안, 못 고르면 까닭"만 본다

import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ffmpegPath, ffmpegVersion } from "../../src/media/ffmpeg/path.ts";
import { reasonOf, readsAnimatedWebp, tryEncoder } from "../../src/media/ffmpeg/trial.ts";
import * as encoders from "../../src/dashboard/login-background/encoders.ts";
import { LOGIN_BG_CODECS } from "../../src/dashboard/contract/login-background.ts";

const BIN = (() => {
  try {
    return ffmpegPath();
  } catch {
    return null;
  }
})();
const opts = { skip: BIN && (BIN === "ffmpeg" || fs.existsSync(BIN)) ? false : "ffmpeg 바이너리 없음" };

test("까닭: 그 인코더의 줄만 앞의 [이름 @ 주소] 를 떼고 잇는다. 없으면 마지막 줄", () => {
  const stderr = "[h264_nvenc @ 0000021] Driver does not support the required nvenc API version. Required: 13.1 Found: 13.0\n[h264_nvenc @ 0000021] The minimum required Nvidia driver for nvenc is 610.00 or newer\n[vost#0:0/h264_nvenc @ 01] Error while opening encoder\n";
  assert.equal(reasonOf(stderr, "h264_nvenc"), "Driver does not support the required nvenc API version. Required: 13.1 Found: 13.0 The minimum required Nvidia driver for nvenc is 610.00 or newer");
  assert.equal(reasonOf("first\nUnknown encoder 'nope'\n", "nope"), "Unknown encoder 'nope'");
});

test("시험 인코딩: 되는 인코더 · 없는 인코더", opts, async () => {
  assert.deepEqual(await tryEncoder("rawvideo", []), { ok: true });
  const bad = await tryEncoder("no-such-encoder", []);
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? "" : bad.reason, /encoder not found/i);
});

test("움직이는 WebP 는 ffmpeg 9.0 이상에서 읽힌다", opts, async () => {
  const major = Number(/(\d+)\./.exec(ffmpegVersion() ?? "")?.[1]);
  const reads = await readsAnimatedWebp();
  if (major >= 9) assert.equal(reads, true);
  else assert.equal(typeof reads, "boolean");
});

test("코덱마다 후보 중 되는 첫 인코더를 고르고, 못 고르면 까닭을 적는다", opts, async () => {
  encoders._reset();
  encoders.startEncoderCheck();
  assert.equal(encoders.isChecking(), true);
  await encoders.encodersReady();
  assert.equal(encoders.isChecking(), false);
  const list = encoders.encoderList();
  assert.deepEqual(
    list.map((one) => one.codec),
    [...LOGIN_BG_CODECS],
  );
  for (const one of list) {
    const candidates = encoders.CANDIDATES[one.codec].map((candidate) => candidate.encoder);
    if (one.encoder === null) assert.ok(one.why, `${one.codec} 를 못 고르면 까닭이 있다`);
    else assert.ok(candidates.includes(one.encoder), `${one.codec}: ${one.encoder}`);
  }
});
