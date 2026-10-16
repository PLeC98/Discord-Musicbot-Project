// src/dashboard/login-background/source.ts — 로그인 배경 원본을 읽어 보고(정지 그림은 sharp, 움직이는 것은 ffmpeg), 링크에서 받는다.
// 표본은 실제 ffmpeg 로 만든다(없으면 건너뛴다). 다른 파일을 읽는 형식(HLS 목록)은 막히고, 터무니없는 크기는 거절한다

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { ffmpegPath } from "../../src/media/ffmpeg/path.ts";
import { runFfmpeg } from "../../src/media/ffmpeg/job.ts";
import { codeOf } from "../../src/rules/error-kind.ts";
import { download, inspectSource, parseInput } from "../../src/dashboard/login-background/source.ts";
import type { RequestDeps } from "../../src/infra/safe-url.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "login-bg-source-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }));
const at = (name: string) => path.join(DIR, name);
const signal = new AbortController().signal;

const BIN = (() => {
  try {
    return ffmpegPath();
  } catch {
    return null;
  }
})();
const opts = { skip: BIN ? false : "ffmpeg 바이너리 없음" };
/** 움직이는 WebP 를 만들 수 있는 빌드인가(libwebp_anim) */
let animatedWebp = false;

before(async () => {
  if (!BIN) return;
  const make = (args: string[]) => runFfmpeg(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "2", ...args]);
  await make(["-c:v", "mpeg4", at("clip.mp4")]);
  await make(["-c:v", "gif", at("anim.gif")]);
  await make(["-f", "apng", "-plays", "0", at("anim.png")]);
  animatedWebp = (await make(["-c:v", "libwebp_anim", "-loop", "0", at("anim.webp")])).code === 0;
  await sharp({ create: { width: 640, height: 360, channels: 3, background: "#336699" } })
    .png()
    .toFile(at("still.png"));
  // EXIF 방향 6(90도 돌림): 보이는 크기는 가로세로가 바뀐다
  await sharp({ create: { width: 400, height: 200, channels: 3, background: "#993366" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toFile(at("rotated.jpg"));
  await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } })
    .png()
    .toFile(at("tiny.png"));
  fs.writeFileSync(at("evil.m3u8"), "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nfile:///etc/hosts\n#EXT-X-ENDLIST\n");
  fs.writeFileSync(at("text.mp4"), "그냥 글");
});

const inspect = (name: string) => inspectSource(at(name), signal);
const reject = async (name: string) => {
  const error = await inspect(name).then(
    () => null,
    (caught: unknown) => caught,
  );
  return codeOf(error);
};

test("정지 그림은 sharp 로, EXIF 방향을 따른 크기", opts, async () => {
  assert.deepEqual(await inspect("still.png"), { kind: "image", width: 640, height: 360, duration: 0, fps: 0 });
  assert.deepEqual(await inspect("rotated.jpg"), { kind: "image", width: 200, height: 400, duration: 0, fps: 0 });
});

test("영상 · 움짤(GIF · APNG · 움직이는 WebP)은 ffmpeg 로, 길이를 적지 않은 것은 패킷을 세어", opts, async () => {
  for (const name of ["clip.mp4", "anim.gif", "anim.png", ...(animatedWebp ? ["anim.webp"] : [])]) {
    const got = await inspect(name);
    assert.deepEqual([got.kind, got.width, got.height], ["video", 320, 180], name);
    assert.ok(Math.abs(got.duration - 2) < 0.2, `${name} 길이 ${got.duration}`);
    assert.ok(got.fps > 0, name);
  }
});

test("다른 파일을 읽는 형식 · 그림이 아닌 것 · 너무 작은 그림은 거절한다", opts, async () => {
  assert.equal(await reject("evil.m3u8"), "background-bad-source");
  assert.equal(await reject("text.mp4"), "background-bad-source");
  assert.equal(await reject("tiny.png"), "background-bad-source");
});

test("ffmpeg 머리 읽기: 형식 · 길이 · 크기 · 초당 장면 수", () => {
  const stderr = ["Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':", "  Duration: 00:01:02.50, start: 0.000000, bitrate: 2892 kb/s", "  Stream #0:0[0x1](eng): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 3840x2160 [SAR 1:1 DAR 16:9], 40000 kb/s, 59.94 fps, 59.94 tbr, 15360 tbn (default)"].join("\n");
  assert.deepEqual(parseInput(stderr), { format: "mov,mp4,m4a,3gp,3g2,mj2", duration: 62.5, width: 3840, height: 2160, fps: 59.94 });
  assert.equal(parseInput("Input #0, mp3, from 'a.mp3':\n  Stream #0:0: Audio: mp3"), null);
});

/** 바깥 경계를 가짜로: 공인 주소로 풀리고, 요청마다 주어진 응답 */
const fakeDeps = (headers: Record<string, string>, body: Buffer): RequestDeps => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  request: async () => ({ status: 200, headers, body: Readable.from([body]) }),
});

test("링크 받기: 그림을 받아 쓰고, 남은 공간을 넘거나 그림 · 영상이 아니면 거절한다", async () => {
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#fff" } })
    .png()
    .toBuffer();
  const file = at("linked");
  await download("https://example.com/a.png", file, 1024 * 1024, signal, fakeDeps({ "content-type": "image/png" }, png));
  assert.deepEqual(fs.readFileSync(file), png);
  const fail = (deps: RequestDeps, room = 1024 * 1024) =>
    download("https://example.com/b", at("other"), room, signal, deps).then(
      () => null,
      (error: unknown) => codeOf(error),
    );
  assert.equal(await fail(fakeDeps({ "content-type": "image/png" }, png), 10), "background-no-space");
  assert.equal(await fail(fakeDeps({ "content-type": "text/html" }, Buffer.from("<html>"))), "background-link-failed");
  assert.equal(fs.existsSync(at("other.part")), false);
});
