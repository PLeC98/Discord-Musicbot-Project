"use strict";

// src/ffmpegProcess.js probeDurationSec — 받아둔 파일에서 실제 재생 길이를 읽는다.
//
// 회귀 대상: 직접 링크는 Content-Length로 길이를 추정하는데 VBR에서 양방향으로 크게 어긋난다.
// 실측(2026-09-08): 4분 1초(241초) 파일이 268kbps에서 509초, 72kbps에서 137초로 잡혔다.
// 표시·진행바뿐 아니라 캐시의 duration_sec까지 그 값으로 굳었다.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { ffmpegPath } = require("../src/ffmpegPath");
const { probeDurationSec } = require("../src/ffmpegProcess");

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
  if (opts.skip) return done();
  // 길이를 아는 톤을 만든다. -q:a 0 = VBR 최고품질 — 추정식이 가장 크게 빗나가는 조건
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
  assert.equal(typeof sec, "number");
  // 인코더가 프레임 경계로 반올림하므로 1초 오차는 허용
  assert.ok(Math.abs(sec - SECONDS) <= 1, `${sec}초 (기대 ${SECONDS}초)`);
});

test("Content-Length 추정보다 정확하다", opts, async () => {
  const DirectLink = require("../src/DirectLink");
  const size = String(fs.statSync(TONE).size);

  const estimated = DirectLink.estimateDuration(size, "audio/mpeg");
  const probed = await probeDurationSec(TONE);

  assert.ok(Math.abs(probed - SECONDS) < Math.abs(estimated - SECONDS), `프로브 ${probed}초가 추정 ${estimated}초보다 정확해야 한다 (실제 ${SECONDS}초)`);
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
