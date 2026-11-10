// src/media/ffmpeg/job.ts: 긴 작업의 시간 상한이 setTimeout 의 32비트 한계를 넘어도 곧바로 끊지 않는다(4시간 영상의 로그인 배경 상한이 약 51일이다)

import { test } from "node:test";
import assert from "node:assert/strict";
import { runFfmpeg, MAX_TIMER_MS } from "../../src/media/ffmpeg/job.ts";
import { withFfmpeg } from "../helpers/login-background-ffmpeg.ts";

test("상한이 32비트를 넘으면 한계로 깎아 건다: 경고 없이 끝까지 돈다", withFfmpeg, async () => {
  const warnings: string[] = [];
  const onWarning = (warning: Error) => warnings.push(warning.name);
  process.on("warning", onWarning);
  try {
    const run = await runFfmpeg(["-f", "lavfi", "-i", "anullsrc=d=0.5", "-f", "null", "-"], { timeoutMs: MAX_TIMER_MS * 2 });
    assert.deepEqual([run.code, run.timedOut], [0, false], run.stderr);
    await new Promise((done) => setImmediate(done));
    assert.ok(!warnings.includes("TimeoutOverflowWarning"), warnings.join(", "));
  } finally {
    process.off("warning", onWarning);
  }
});
