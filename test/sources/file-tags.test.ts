// src/sources/file-tags.ts — 음원 파일의 태그(제목 · 가수 · 앨범 · 그림). 파일은 그대로, 스트림은 머리까지만 받고 끊는다.
// 시료는 ffmpeg 로 만든다(그림이 붙은 MP3 · FLAC · M4A(moov 앞 · 끝) · Ogg Vorbis). ffmpeg 가 없으면 건너뛴다

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { Readable } from "node:stream";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";

import { fromFile, fromStream, type StreamLimits } from "../../src/sources/file-tags.ts";
import { spawnFfmpeg } from "../../src/media/ffmpeg/process.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-tags-"));
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

const META = ["-metadata", "title=노래 제목", "-metadata", "artist=가수", "-metadata", "album=앨범"];
const TONE = ["-f", "lavfi", "-i", "sine=frequency=440:duration=20"];
let ready = false;
let cover: Buffer;

before(async () => {
  const made = [
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=800x800:d=1", "-frames:v", "1", "-y", at("cover.jpg")]),
    await ffmpeg([...TONE, "-i", at("cover.jpg"), "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-c:v", "copy", "-disposition:v", "attached_pic", ...META, "-y", at("a.mp3")]),
    await ffmpeg([...TONE, "-i", at("cover.jpg"), "-map", "0:a", "-map", "1:v", "-c:a", "flac", "-c:v", "copy", "-disposition:v", "attached_pic", ...META, "-y", at("a.flac")]),
    await ffmpeg([...TONE, "-i", at("cover.jpg"), "-map", "0:a", "-map", "1:v", "-c:a", "aac", "-c:v", "copy", "-disposition:v", "attached_pic", ...META, "-y", at("end.m4a")]),
    await ffmpeg(["-i", at("end.m4a"), "-map", "0", "-c", "copy", "-movflags", "+faststart", "-y", at("front.m4a")]),
    await ffmpeg([...TONE, "-c:a", "libvorbis", ...META, "-y", at("a.ogg")]),
    await ffmpeg([...TONE, "-c:a", "libmp3lame", "-y", at("bare.mp3")]),
  ];
  ready = made.every(Boolean);
  if (ready) cover = fs.readFileSync(at("cover.jpg"));
});

/** 파일을 조금씩(16KB) 흘리는 스트림. end 가 false 면 다 보낸 뒤에도 닫지 않는다(끝이 없는 응답 흉내). 보낸 양을 센다 */
function trickle(bytes: Buffer, { end = true, from = 0 } = {}) {
  let at = from;
  const sent = { bytes: 0, destroyed: false };
  const stream = new Readable({
    read() {
      setTimeout(() => {
        if (at >= bytes.length) {
          if (end) this.push(null);
          return;
        }
        const chunk = bytes.subarray(at, at + 16384);
        at += chunk.length;
        sent.bytes += chunk.length;
        this.push(chunk);
      }, 1);
    },
    destroy(error, callback) {
      sent.destroyed = true;
      callback(error);
    },
  });
  return { stream, sent };
}

const LIMITS: StreamLimits = { maxBytes: 8 * 1024 * 1024, timeoutMs: 10_000 };
const sameCover = (data: Uint8Array | undefined) => Buffer.compare(Buffer.from(data ?? []), cover) === 0;

test("파일: 형식마다 제목 · 가수 · 앨범과 그림(원본과 같은 바이트). MP4 는 moov 가 끝이어도", async (t) => {
  if (!ready) return t.skip("ffmpeg로 시료를 만들 수 없음");
  for (const name of ["a.mp3", "a.flac", "end.m4a", "front.m4a"]) {
    const tags = await fromFile(at(name));
    assert.deepEqual([tags?.title, tags?.artist, tags?.album], ["노래 제목", "가수", "앨범"], name);
    assert.ok(sameCover(tags?.picture?.data), `${name} 그림`);
    assert.equal(tags?.picture?.format, "image/jpeg");
  }
  const ogg = await fromFile(at("a.ogg"));
  assert.deepEqual([ogg?.title, ogg?.picture], ["노래 제목", null], "그림이 없으면 null");
  assert.equal(await fromFile(at("없음.mp3")), null, "파일이 없으면 null");
});

test("스트림: 머리까지만 받고 끊는다. 끝이 없는 응답이어도 기다리지 않는다", { timeout: 30_000 }, async (t) => {
  if (!ready) return t.skip("ffmpeg로 시료를 만들 수 없음");
  for (const name of ["a.mp3", "a.flac", "a.ogg", "front.m4a"]) {
    const bytes = fs.readFileSync(at(name));
    const { stream, sent } = trickle(bytes, { end: false });
    const tags = await fromStream(stream, LIMITS);
    assert.equal(tags?.title, "노래 제목", name);
    assert.ok(sent.bytes < bytes.length, `${name}: ${sent.bytes} / ${bytes.length} 만 받는다`);
    assert.ok(sent.destroyed, `${name}: 다 읽으면 스트림을 부순다`);
  }
  const mp3 = await fromStream(trickle(fs.readFileSync(at("a.mp3"))).stream, LIMITS);
  assert.ok(sameCover(mp3?.picture?.data), "그림");
  const bare = await fromStream(trickle(fs.readFileSync(at("bare.mp3"))).stream, LIMITS);
  assert.deepEqual(bare, { title: null, artist: null, album: null, picture: null }, "태그가 없으면 빈 태그");
});

test("스트림 MP4: moov 가 mdat 뒤면 그 자리를 따로 받고, 받을 길이 없으면 null", { timeout: 30_000 }, async (t) => {
  if (!ready) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const bytes = fs.readFileSync(at("end.m4a"));
  const asked: number[] = [];
  const main = trickle(bytes, { end: false });
  const rangeFrom = async (start: number) => {
    asked.push(start);
    return trickle(bytes, { from: start }).stream;
  };
  const tags = await fromStream(main.stream, { ...LIMITS, rangeFrom });
  assert.equal(tags?.album, "앨범");
  assert.ok(sameCover(tags?.picture?.data), "그림");
  assert.equal(asked.length, 1, "moov 자리를 한 번 받는다");
  assert.ok(main.sent.bytes < bytes.length / 2, `mdat 을 다 받지 않는다(${main.sent.bytes} / ${bytes.length})`);

  assert.equal(await fromStream(trickle(bytes).stream, LIMITS), null, "rangeFrom 이 없으면 읽지 않는다");
  assert.equal(await fromStream(trickle(bytes).stream, { ...LIMITS, rangeFrom: async () => null }), null, "서버가 이어 받기를 따르지 않으면 읽지 않는다");
});

test("스트림 상한: 바이트를 넘으면 null(없음), 시간을 넘으면 던진다, 스트림 오류도 던진다", { timeout: 30_000 }, async (t) => {
  if (!ready) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const mp3 = fs.readFileSync(at("a.mp3"));
  assert.ok(cover.length > 25_000, `그림 ${cover.length}B`);
  assert.equal(await fromStream(trickle(mp3).stream, { ...LIMITS, maxBytes: 4096 }), null, "첫 조각부터 넘는다");
  assert.equal(await fromStream(trickle(mp3).stream, { ...LIMITS, maxBytes: 20_000 }), null, "그림이 든 머리가 20KB 를 넘는다(이어 받는 동안)");

  const stalled = new Readable({ read() {} });
  stalled.push(mp3.subarray(0, 100));
  await assert.rejects(fromStream(stalled, { ...LIMITS, timeoutMs: 200 }), /200ms/);

  const broken = new Readable({
    read() {
      this.destroy(new Error("ECONNRESET"));
    },
  });
  await assert.rejects(fromStream(broken, LIMITS), /ECONNRESET/);

  assert.equal(await fromStream(Readable.from([Buffer.from("<html>not audio</html>")]), LIMITS), null, "음원이 아니면 null");
});
