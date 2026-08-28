"use strict";

// MusicPlayer.buildFfmpegArgs — ffmpeg 인자 구성의 불변식.
//
// 회귀 대상: 오프셋 재생 시 ffmpeg에 URL을 직접 입력하던 것. httpHeaders가 빠지고,
// 스트리밍 실패 폴백을 건너뛰며, 정적 링크 빌드에서는 SIGSEGV로 죽어 무음이 됐다.
// pipe 입력에서 `-ss`를 `-i` 앞에 두면 출력이 잘리는 것도 함께 고정한다.

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

test("출력 포맷은 두 모드가 동일하고 pipe:1로 끝난다 (StreamType.Raw 계약)", () => {
  // 출력 대상까지 여기서 붙인다 — spawnFfmpeg는 인자를 그대로 실행하므로,
  // 출력이 파일인 캐시 변환 경로(-y <file>)와 섞이지 않으려면 호출부가 온전한 인자를 가져야 한다.
  const expected = ["-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"];
  for (const args of [build({ seekMs: 5000 }), build({ file: "/cache/x.opus", seekMs: 5000 })]) {
    assert.deepEqual(args.slice(-expected.length), expected, args.join(" "));
  }
});

test("-loglevel은 error — 0(무음)이면 SIGSEGV가 단서 없이 묻힌다", () => {
  for (const args of [build(), build({ file: "/cache/x.opus" })]) {
    assert.equal(args[idx(args, "-loglevel") + 1], "error", args.join(" "));
  }
});

test("크래시 시그널 집합: 정상 종료용 SIGKILL/SIGTERM은 크래시로 치지 않는다", () => {
  // 스킵·정지·종료에서 우리가 SIGKILL을 보낸다 — 이걸 크래시로 찍으면 오탐이 쏟아진다.
  const { CRASH_SIGNALS } = require("../src/ffmpegProcess")._internals;
  assert.ok(CRASH_SIGNALS.has("SIGSEGV"));
  assert.ok(CRASH_SIGNALS.has("SIGABRT"));
  assert.ok(!CRASH_SIGNALS.has("SIGKILL"));
  assert.ok(!CRASH_SIGNALS.has("SIGTERM"));
});
