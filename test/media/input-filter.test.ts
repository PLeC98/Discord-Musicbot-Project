// src/media/ffmpeg/input-filter.ts — 남이 준 바이트를 읽는 ffmpeg 의 입력 필터(형식 · 프로토콜).
//
// 막는 것: 직접 링크가 음원 대신 이어 붙이기 목록(concat)을 주면 캐시 변환이 같은 폴더(캐시 폴더)의 다른 파일을 읽어 캐시로 만들었다.
// HLS 목록도 같은 부류다. 붙이는 곳은 캐시 변환 · probeAudio · 표준 입력 재생 · 캐시 파일 재생이고, 주소 입력(HLS)에는 붙이지 않는다.

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { test, after } from "node:test";
import assert from "node:assert/strict";

import * as audioConvert from "../../src/media/convert.ts";
import { buildFfmpegArgs } from "../../src/media/ffmpeg/args.ts";
import { probeAudio, spawnFfmpeg } from "../../src/media/ffmpeg/process.ts";
import { AUDIO_FORMATS, CACHE_FORMATS } from "../../src/media/ffmpeg/input-filter.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-input-filter-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));
const at = (name: string) => path.join(DIR, name);
const idx = (args: string[], flag: string) => args.indexOf(flag);

/** ffmpeg 를 돌려 표준 출력 바이트 수와 종료 코드. input 이 있으면 표준 입력으로 */
function run(args: string[], input?: Buffer): Promise<{ code: number | null; bytes: number }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFfmpeg(args, "probe", { killOnStdoutClose: false });
    } catch {
      return resolve({ code: -1, bytes: 0 });
    }
    let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => (bytes += chunk.length));
    child.stdin.on("error", () => {});
    child.on("error", () => resolve({ code: -1, bytes }));
    child.on("exit", (code) => resolve({ code, bytes }));
    child.stdin.end(input ?? undefined);
  });
}

/** 시료: 음원 둘(mp3 · 캐시 opus)과 그 mp3 를 상대 경로로 가리키는 목록 둘(concat · HLS) */
async function samples() {
  const mp3 = await run(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "libmp3lame", "-y", at("song.mp3")]);
  const opus = await run(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "libopus", "-f", "opus", "-y", at("cache.opus")]);
  if (mp3.code !== 0 || opus.code !== 0) return null;
  fs.writeFileSync(at("concat.raw"), "ffconcat version 1.0\nfile 'song.mp3'\n");
  fs.writeFileSync(at("hls.raw"), "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nsong.mp3\n#EXT-X-ENDLIST\n");
  return true;
}

test("인자: 파일(캐시)은 ogg 만 · 표준 입력은 음원 형식만, 둘 다 -i 앞. 주소 입력(HLS)에는 붙이지 않는다", () => {
  const file = buildFfmpegArgs({ file: "/cache/a.opus", seekMs: 5000 });
  assert.equal(file[idx(file, "-format_whitelist") + 1], CACHE_FORMATS.join(","));
  assert.equal(file[idx(file, "-protocol_whitelist") + 1], "file");
  assert.ok(idx(file, "-format_whitelist") < idx(file, "-i"));

  const pipe = buildFfmpegArgs({ seekMs: 5000 });
  assert.equal(pipe[idx(pipe, "-format_whitelist") + 1], AUDIO_FORMATS.join(","));
  assert.equal(pipe[idx(pipe, "-protocol_whitelist") + 1], "pipe");
  assert.ok(idx(pipe, "-format_whitelist") < idx(pipe, "-i"));

  const url = buildFfmpegArgs({ url: "https://x/a.m3u8", caps: { segMaxRetry: true } });
  assert.equal(idx(url, "-format_whitelist"), -1, "HLS 목록이 막힌다");
  assert.equal(idx(url, "-protocol_whitelist"), -1);

  const convert = audioConvert._internals.argsFor({ action: "transcode", bitrateKbps: 128 }, "/in.raw", "/out.opus");
  assert.equal(convert[idx(convert, "-format_whitelist") + 1], AUDIO_FORMATS.join(","));
  assert.equal(convert[idx(convert, "-protocol_whitelist") + 1], "file");
  assert.ok(idx(convert, "-format_whitelist") < idx(convert, "-i"));
});

test("실물: 목록(concat · HLS)은 캐시 변환 · probeAudio · 표준 입력 재생 · 캐시 파일 재생 모두에서 열리지 않고, 음원은 열린다", async (t) => {
  if (!(await samples())) return t.skip("ffmpeg로 시료를 만들 수 없음");

  for (const list of ["concat.raw", "hls.raw"]) {
    await assert.rejects(audioConvert.toCacheOpus(at(list), at(`${list}.opus`)), `캐시 변환: ${list}`);
    assert.equal((await probeAudio(at(list))).durationSec, null, `probeAudio: ${list}`);
    assert.equal((await run(buildFfmpegArgs({}), fs.readFileSync(at(list)))).bytes, 0, `표준 입력 재생: ${list}`);
    assert.equal((await run(buildFfmpegArgs({ file: at(list) }))).bytes, 0, `캐시 파일 재생: ${list}`);
  }

  await audioConvert.toCacheOpus(at("song.mp3"), at("song.opus"));
  assert.equal((await probeAudio(at("song.opus"))).codec, "opus", "mp3 는 캐시로 바뀐다");
  assert.ok((await run(buildFfmpegArgs({}), fs.readFileSync(at("song.mp3")))).bytes > 0, "mp3 를 표준 입력으로 튼다");
  assert.ok((await run(buildFfmpegArgs({ file: at("cache.opus"), seekMs: 500 }))).bytes > 0, "캐시 opus 를 튼다");
});
