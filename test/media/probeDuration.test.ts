// src/media/ffmpeg/process.ts probeDurationSec — 받아둔 파일에서 실제 재생 길이를 읽는다.
// 직접 링크는 받기 전에 길이를 모르고, 이 값이 표시 · 진행바 · 캐시의 duration_sec 을 채운다.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { ffmpegPath } from "../../src/media/ffmpeg/path.ts";

import { probeDurationSec } from "../../src/media/ffmpeg/process.ts";

const BIN = (() => {
  try {
    return ffmpegPath();
  } catch {
    return null;
  }
})();
const opts = { skip: BIN && fs.existsSync(BIN) ? false : "ffmpeg 바이너리 없음" };

const TONE = path.join(os.tmpdir(), `musicbot-probe-${process.pid}.mp3`);
const SECONDS = 7;

before((t, done) => {
  if (opts.skip || !BIN) return done();
  // 길이를 아는 톤을 만든다. -q:a 0 = VBR 최고품질(크기로는 길이를 가를 수 없는 조건)
  const p = spawn(BIN, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=440:duration=${SECONDS}`, "-c:a", "libmp3lame", "-q:a", "0", "-y", TONE], { windowsHide: true });
  p.on("exit", () => done());
  p.on("error", () => done());
});

after(() => {
  try {
    fs.unlinkSync(TONE);
  } catch {
    /* 없으면 그만 */
  }
});

test("실제 길이를 초 단위로 돌려준다", opts, async () => {
  const sec = await probeDurationSec(TONE);
  assert.ok(typeof sec === "number", `숫자가 아니다: ${sec}`);
  // 인코더가 프레임 경계로 반올림하므로 1초 오차는 허용
  assert.ok(Math.abs(sec - SECONDS) <= 1, `${sec}초 (기대 ${SECONDS}초)`);
});

test("파일이 없거나 오디오가 아니면 null (호출부가 기존 값을 유지한다)", opts, async () => {
  assert.equal(await probeDurationSec(path.join(os.tmpdir(), "musicbot-nope.mp3")), null);

  const junk = path.join(os.tmpdir(), `musicbot-junk-${process.pid}.mp3`);
  fs.writeFileSync(junk, "not audio at all");
  try {
    assert.equal(await probeDurationSec(junk), null);
  } finally {
    fs.unlinkSync(junk);
  }
});
