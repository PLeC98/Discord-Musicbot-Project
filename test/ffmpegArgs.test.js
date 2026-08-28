"use strict";

// MusicPlayer.buildFfmpegArgs — ffmpeg 인자 구성의 불변식.
//
// 회귀 대상(2026-08-28, 우분투 전용 무음 버그):
// 오프셋 재생(스폰서블록 인트로 스킵/seek/재시도 재개) 시 ffmpeg에 유튜브 URL을 직접 입력했다.
// 그러면 ffmpeg가 스스로 DNS·TLS·HTTP를 수행하는데, ffmpeg-static의 리눅스 빌드는 이 경로에서
// SIGSEGV로 죽는다(6.0.1·7.0.2 공통, 유튜브가 아닌 서버에서도 재현). 재생은 3회 재시도 후 무음.
//
// 더해서 URL 직접 입력은 빌드와 무관하게도 결함이었다 — yt-dlp가 준 httpHeaders가 빠지고,
// 스트리밍 실패 시 진행 중인 다운로드로 전환하는 폴백도 건너뛴다.
//
// 상세: notes/ffmpeg-url-input-crash-2026-08-28.md

const { test } = require("node:test");
const assert = require("node:assert/strict");

const MusicPlayer = require("../src/MusicPlayer");

const build = (opts) => MusicPlayer.buildFfmpegArgs(opts);
const idx = (args, flag) => args.indexOf(flag);

test("스트리밍: 입력은 언제나 pipe:0 — URL을 ffmpeg에 넘기지 않는다", () => {
  for (const seekMs of [0, 1, 5000, 180000]) {
    const args = build({ seekMs });
    assert.equal(args[idx(args, "-i") + 1], "pipe:0", `seekMs=${seekMs}`);
    for (const a of args) {
      assert.doesNotMatch(String(a), /^https?:\/\//i, `URL이 인자에 들어가면 안 됨: ${a}`);
    }
  }
});

test("스트리밍 + 오프셋: -ss는 -i 뒤(출력측) — pipe에서 입력측은 출력이 잘린다", () => {
  const args = build({ seekMs: 30000 });
  assert.ok(idx(args, "-ss") > idx(args, "-i"), `-ss가 -i보다 뒤여야 함: ${args.join(" ")}`);
  assert.equal(args[idx(args, "-ss") + 1], "30.000");
});

test("파일 + 오프셋: -ss는 -i 앞(입력측) — 파일은 seek 가능해 이쪽이 빠르다", () => {
  const args = build({ file: "/cache/track_abc.opus", seekMs: 30000 });
  assert.ok(idx(args, "-ss") < idx(args, "-i"), `-ss가 -i보다 앞이어야 함: ${args.join(" ")}`);
  assert.equal(args[idx(args, "-i") + 1], "/cache/track_abc.opus");
});

test("오프셋 0이면 -ss를 넣지 않는다 (양쪽 모드)", () => {
  assert.equal(idx(build({ seekMs: 0 }), "-ss"), -1);
  assert.equal(idx(build({ file: "/cache/x.opus", seekMs: 0 }), "-ss"), -1);
  assert.equal(idx(build(), "-ss"), -1);
});

test("출력 포맷은 두 모드가 동일 (StreamType.Raw 계약)", () => {
  const expected = ["-f", "s16le", "-ar", "48000", "-ac", "2"];
  for (const args of [build({ seekMs: 5000 }), build({ file: "/cache/x.opus", seekMs: 5000 })]) {
    assert.deepEqual(args.slice(-6), expected, args.join(" "));
  }
});

test("-loglevel은 error — 0(무음)이면 SIGSEGV가 단서 없이 묻힌다", () => {
  for (const args of [build(), build({ file: "/cache/x.opus" })]) {
    assert.equal(args[idx(args, "-loglevel") + 1], "error", args.join(" "));
  }
});

test("크래시 시그널 집합: 정상 종료용 SIGKILL/SIGTERM은 크래시로 치지 않는다", () => {
  // prism의 _cleanup()이 스킵·정지에서 SIGKILL을 정상적으로 보낸다 — 이걸 크래시로 찍으면 오탐이 쏟아진다.
  assert.ok(MusicPlayer.FFMPEG_CRASH_SIGNALS.has("SIGSEGV"));
  assert.ok(MusicPlayer.FFMPEG_CRASH_SIGNALS.has("SIGABRT"));
  assert.ok(!MusicPlayer.FFMPEG_CRASH_SIGNALS.has("SIGKILL"));
  assert.ok(!MusicPlayer.FFMPEG_CRASH_SIGNALS.has("SIGTERM"));
});
