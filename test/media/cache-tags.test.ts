// 캐시 파일의 태그: 다시 구운 그림(sources/cover) · FLAC 그림 블록(rules/flac-picture) · 캐시 변환이 적는 태그(media/convert).
// 받은 파일의 태그는 버리고 우리가 읽은 제목 · 가수 · 앨범과 그림만 적는다. 다시 읽으면(sources/file-tags) 같은 것이 나와야 한다

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { pictureBlock } from "../../src/rules/flac-picture.ts";
import { bakeCover, SIDE } from "../../src/sources/cover.ts";
import * as audioConvert from "../../src/media/convert.ts";
import { fromFile } from "../../src/sources/file-tags.ts";
import { spawnFfmpeg } from "../../src/media/ffmpeg/process.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-cache-tags-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));
const at = (name: string) => path.join(DIR, name);

function ffmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFfmpeg(["-hide_banner", "-loglevel", "error", ...args], "probe", { killOnStdoutClose: false });
    } catch {
      return resolve(false);
    }
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

const noise = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 40 } } });

test("그림 블록: 앞 표지 · MIME · 가로 · 세로 · 깊이 · 그림 길이가 빅 엔디언 32비트로", () => {
  const block = pictureBlock({ mime: "image/jpeg", width: 640, height: 480, data: new Uint8Array([1, 2, 3]) });
  const view = new DataView(block.buffer);
  assert.equal(view.getUint32(0), 3, "앞 표지");
  assert.equal(view.getUint32(4), 10);
  assert.equal(new TextDecoder().decode(block.subarray(8, 18)), "image/jpeg");
  assert.deepEqual([view.getUint32(18), view.getUint32(22), view.getUint32(26), view.getUint32(30), view.getUint32(34), view.getUint32(38)], [0, 640, 480, 24, 0, 3]);
  assert.deepEqual([...block.subarray(42)], [1, 2, 3]);
});

test("굽기: 큰 그림은 긴 변 1000px JPEG, 작은 그림은 키우지 않는다. 깨진 그림 · 선언된 화소가 거대한 그림은 null", async () => {
  const big = await bakeCover(await noise(3000, 2000).png().toBuffer());
  assert.deepEqual([big?.width, big?.height], [SIDE, 667]);
  assert.equal((await sharp(big!.jpeg).metadata()).format, "jpeg");

  const small = await bakeCover(await noise(300, 300).webp().toBuffer());
  assert.deepEqual([small?.width, small?.height], [300, 300]);

  assert.equal(await bakeCover(Buffer.from("not an image")), null);
  assert.equal(await bakeCover(new Uint8Array()), null);
  // PNG 머리만 거대한 크기를 적은 것(읽기 전에 막는다)
  const ihdr = Buffer.from("89504e470d0a1a0a0000000d49484452000186a0000186a00806000000", "hex");
  assert.equal(await bakeCover(Buffer.concat([ihdr, Buffer.alloc(64)])), null);
});

test("굽기: CMYK JPEG 도 sRGB JPEG 으로", async () => {
  const cmyk = await noise(200, 200).toColourspace("cmyk").jpeg().toBuffer();
  assert.equal((await sharp(cmyk).metadata()).space, "cmyk");
  const baked = await bakeCover(cmyk);
  assert.equal((await sharp(baked!.jpeg).metadata()).space, "srgb");
});

let ready = false;
before(async () => {
  ready = [
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=600x600:d=1", "-frames:v", "1", "-y", at("src.jpg")]),
    await ffmpeg(["-f", "lavfi", "-i", "sine=duration=3", "-i", at("src.jpg"), "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-c:v", "copy", "-disposition:v", "attached_pic", "-metadata", "title=원본 제목", "-metadata", "comment=버릴 것", "-y", at("a.mp3")]),
    await ffmpeg(["-f", "lavfi", "-i", "sine=duration=3", "-c:a", "libvorbis", "-metadata", "title=원본", "-y", at("a.ogg")]),
    await ffmpeg(["-f", "lavfi", "-i", "sine=duration=3", "-c:a", "libopus", "-b:a", "96k", "-metadata", "title=원본", "-f", "opus", "-y", at("a.opus")]),
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=40x80:d=1:r=4", "-y", at("moving.gif")]),
  ].every(Boolean);
});

test("굽기: 움직이는 GIF 는 첫 장", async (t) => {
  if (!ready) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const gif = fs.readFileSync(at("moving.gif"));
  assert.ok(((await sharp(gif, { animated: true }).metadata()).pages ?? 1) > 1, "시료가 여러 장");
  const frame = await bakeCover(gif);
  assert.deepEqual([frame?.width, frame?.height], [40, 80]);
});

test("실물: 캐시 변환이 우리 태그와 그림만 적는다(MP3 · Ogg Vorbis · 이미 Opus 라 옮기기). 다시 읽으면 같고, 임시 그림 파일은 남지 않는다", { timeout: 60_000 }, async (t) => {
  if (!ready) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const cover = await bakeCover(fs.readFileSync(at("src.jpg")));
  assert.ok(cover);
  const tags = { title: "제목 = ; # \\ 끝", artist: "가수", album: "앨범" };
  for (const name of ["a.mp3", "a.ogg", "a.opus"]) {
    const out = at(`${name}.cache.opus`);
    const made = await audioConvert.toCacheOpus(at(name), out, { tags, cover });
    if (name === "a.opus") assert.equal(made.action, "copy", "옮기기 길");
    const read = await fromFile(out);
    assert.deepEqual([read?.title, read?.artist, read?.album], [tags.title, "가수", "앨범"], name);
    assert.equal(Buffer.compare(Buffer.from(read?.picture?.data ?? []), cover.jpeg), 0, `${name} 그림`);
    assert.deepEqual(
      fs.readdirSync(DIR).filter((file) => file.endsWith(".meta")),
      [],
      "임시 그림 파일",
    );
  }

  const bare = at("bare.cache.opus");
  await audioConvert.toCacheOpus(at("a.mp3"), bare, { tags: { title: null, artist: null, album: null }, cover: null });
  const read = await fromFile(bare);
  assert.deepEqual([read?.title, read?.picture], [null, null], "받은 파일의 태그 · 그림은 버린다");
});
