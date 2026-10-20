// src/media/convert.ts — 캐시 변환을 작업 실행기로 돌린다: 진행이 오는 동안은 오래 걸려도 두고, 실패는 표준 오류의 끝을 실어 던진다

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import * as audioConvert from "../../src/media/convert.ts";
import { ffmpegPath } from "../../src/media/ffmpeg/path.ts";
import * as registry from "../../src/infra/process-registry.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-convert-run-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));
afterEach(() => audioConvert.useConvertStall(null));
const at = (name: string) => path.join(DIR, name);

// 10분짜리 flac(굽기로 간다). 이 기기에서 굽기에 몇 초 걸린다
function longFlac(): boolean {
  const made = spawnSync(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=600", "-ac", "2", "-ar", "48000", "-y", at("long.flac")], { windowsHide: true });
  return made.status === 0;
}

test("진행이 오는 동안은 멈춤 한도보다 오래 걸려도 끊지 않는다", { timeout: 120_000 }, async (t) => {
  if (!longFlac()) return t.skip("ffmpeg로 시료를 만들 수 없음");
  audioConvert.useConvertStall(1000);
  const started = Date.now();
  const made = await audioConvert.toCacheOpus(at("long.flac"), at("long.opus"));
  const took = Date.now() - started;
  assert.equal(made.action, "transcode");
  assert.ok(fs.statSync(at("long.opus")).size > 0);
  if (took < 1500) t.diagnostic(`굽기가 ${took}ms 로 한도(1000ms)를 넉넉히 넘지 않아 이 기기에서는 약한 확인이다`);
});

test("실패하면 표준 오류의 끝을 실어 stream-failed 로 던진다. 자식은 레지스트리에 남지 않는다", async () => {
  fs.writeFileSync(at("junk.raw"), Buffer.alloc(4096, 7));
  const before = registry.size();
  const error = await audioConvert.toCacheOpus(at("junk.raw"), at("junk.opus")).then(
    () => null,
    (e: Error & { code?: string }) => e,
  );
  assert.equal(error?.code, "stream-failed");
  assert.match(String(error?.message), /FFmpeg 종료 \(code=\d+, signal=null\): \S/);
  assert.equal(registry.size(), before);
});
