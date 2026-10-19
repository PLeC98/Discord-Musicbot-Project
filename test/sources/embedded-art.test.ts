// src/sources/embedded-art.ts — 직접 링크 곡의 파일 태그 · 그림을 찾아 기억한다.
// 원본을 여는 곳은 가짜(useOpen), 캐시 파일 · DB 는 임시 저장소. 시료는 ffmpeg 로 만든다(없으면 건너뛴다)

import path from "node:path";
import fs from "node:fs";
import { Readable } from "node:stream";
import { test, after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import * as embeddedArt from "../../src/sources/embedded-art.ts";
import * as audioCache from "../../src/store/audio-cache.ts";
import * as audioConvert from "../../src/media/convert.ts";
import { bakeCover } from "../../src/sources/cover.ts";
import { audioKeyOf } from "../../src/rules/audio-key-of.ts";
import { spawnFfmpeg } from "../../src/media/ffmpeg/process.ts";
import { openTempStore } from "../helpers/temp-store.ts";

const store = openTempStore("embedded-art-");
after(() => store.close());
const at = (name: string) => path.join(store.dir, name);

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

let mp3: Buffer | null = null;
before(async () => {
  const made = (await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=1200x1200:d=1", "-frames:v", "1", "-y", at("cover.jpg")])) && (await ffmpeg(["-f", "lavfi", "-i", "sine=duration=3", "-i", at("cover.jpg"), "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-c:v", "copy", "-disposition:v", "attached_pic", "-metadata", "title=태그 제목", "-metadata", "album=태그 앨범", "-y", at("a.mp3")]));
  if (made) mp3 = fs.readFileSync(at("a.mp3"));
});

type Opened = { url: string; from?: number };
const opened: Opened[] = [];
const found: Array<{ key: string; title: string | null; art: boolean }> = [];
/** 원본 가짜: 그 주소의 바이트를 준다. hold 면 첫 바이트를 그만큼 늦춘다 */
let reply: (url: string) => { body: Buffer | null; hold?: number } = () => ({ body: mp3 });
beforeEach(() => {
  embeddedArt.clear();
  opened.length = 0;
  found.length = 0;
  reply = () => ({ body: mp3 });
  embeddedArt.onFound((key, f) => found.push({ key, title: f.tags.title, art: Boolean(f.art) }));
  embeddedArt._internals.useOpen(async (url, opts) => {
    opened.push({ url, from: opts.from });
    const { body, hold = 0 } = reply(url);
    if (!body) throw new Error("ECONNREFUSED");
    await new Promise((resolve) => setTimeout(resolve, hold));
    return Object.assign(Readable.from([body]), { headers: { "content-type": "audio/mpeg" }, status: 200 });
  });
});

const direct = (name: string) => ({ audioUrl: `https://files.test/${name}.mp3`, thumbnail: null });
/** 찾기가 다 끝날 때까지 */
async function settled() {
  for (let i = 0; i < 200 && embeddedArt._internals.running.size > 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
}

test("원본에서 찾는다: 태그 · 그림(다시 구운 JPEG)을 기억하고 알린다. 같은 키는 한 번만, 곡 그림이 있거나 직접 링크가 아니면 그림이 없다", async (t) => {
  if (!mp3) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const track = direct("a");
  embeddedArt.want([track, track]);
  await settled();
  embeddedArt.want([track]);
  await settled();
  assert.deepEqual(opened, [{ url: track.audioUrl, from: undefined }], "한 번만 연다");
  assert.deepEqual(found, [{ key: audioKeyOf(track.audioUrl), title: "태그 제목", art: true }]);
  assert.equal(embeddedArt.tagsFor(track)?.album, "태그 앨범");

  const art = embeddedArt.artFor(track);
  assert.deepEqual([art?.width, art?.height], [1000, 1000]);
  const jpeg = await embeddedArt.imageOf(art!.fingerprint);
  assert.equal((await sharp(jpeg!).metadata()).format, "jpeg");

  assert.equal(embeddedArt.artFor({ ...track, thumbnail: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg" }), null, "곡 그림이 있으면 쓰지 않는다");
  embeddedArt.want([{ audioUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa", thumbnail: null }]);
  await settled();
  assert.equal(opened.length, 1, "직접 링크가 아니면 찾지 않는다");
  embeddedArt.want([{ ...direct("radio"), isLive: true }]);
  await settled();
  assert.equal(opened.length, 1, "라이브(인터넷 라디오)는 끝이 없어 찾지 않는다");
});

test("한 번에 둘, 지금 곡(first)이 기다리는 것보다 먼저", async (t) => {
  if (!mp3) return t.skip("ffmpeg로 시료를 만들 수 없음");
  reply = () => ({ body: mp3, hold: 50 });
  let most = 0;
  const watch = setInterval(() => (most = Math.max(most, embeddedArt._internals.running.size)), 2);
  embeddedArt.want([direct("q1"), direct("q2"), direct("q3"), direct("q4")]);
  embeddedArt.want([direct("now")], { first: true });
  await settled();
  clearInterval(watch);
  assert.equal(most, 2);
  assert.deepEqual(
    opened.map((one) => path.basename(one.url, ".mp3")),
    ["q1", "q2", "now", "q3", "q4"],
  );
});

test("통신 실패는 바로 다시 찾지 않는다(몇 분 뒤)", async (t) => {
  if (!mp3) return t.skip("ffmpeg로 시료를 만들 수 없음");
  reply = () => ({ body: null });
  embeddedArt.want([direct("down")]);
  await settled();
  embeddedArt.want([direct("down")]);
  await settled();
  assert.equal(opened.length, 1);
  assert.equal(embeddedArt.artFor(direct("down")), null);
});

test("캐시 파일이 있으면 그 태그에서 찾고 원본을 열지 않는다. 다운로드가 알린 결과도 쓰고, 밀려난 그림은 캐시 파일에서 다시 꺼낸다", async (t) => {
  if (!mp3) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const track = direct("cached");
  const key = audioKeyOf(track.audioUrl)!;
  const file = audioCache.getFilePath(key);
  const cover = await bakeCover(fs.readFileSync(at("cover.jpg")));
  await audioConvert.toCacheOpus(at("a.mp3"), file, { tags: { title: "캐시 제목", artist: null, album: "캐시 앨범" }, cover });
  audioCache.recordDownloadStart(key, { title: "캐시" });
  audioCache.recordDownloadComplete(key, file, fs.statSync(file).size, { title: "캐시" }, { durationSec: 3, audioVersion: null });

  embeddedArt.want([track]);
  await settled();
  assert.equal(opened.length, 0, "원본을 열지 않는다");
  assert.equal(embeddedArt.tagsFor(track)?.title, "캐시 제목");
  const art = embeddedArt.artFor(track)!;
  assert.equal(Buffer.compare((await embeddedArt.imageOf(art.fingerprint))!, cover!.jpeg), 0, "캐시 파일에 넣은 그림 그대로");

  // 그림이 밀려나도 캐시 파일에서 다시 꺼낸다
  embeddedArt._internals.forgetImages();
  assert.equal(Buffer.compare((await embeddedArt.imageOf(art.fingerprint))!, cover!.jpeg), 0, "밀려난 그림");
  assert.equal(await embeddedArt.imageOf("0".repeat(20)), null, "모르는 지문");

  // 다운로드가 알린 결과(그 캐시 파일에 넣은 것)로 바뀐다
  const other = await bakeCover(
    await sharp({ create: { width: 10, height: 10, channels: 3, background: "#123456" } })
      .png()
      .toBuffer(),
  );
  embeddedArt.noteFile(key, { title: "다른 제목", artist: null, album: null }, other);
  assert.deepEqual([embeddedArt.tagsFor(track)?.title, embeddedArt.artFor(track)?.width], ["다른 제목", 10], "다운로드가 알린 결과");

  embeddedArt.clear();
  assert.equal(embeddedArt.artFor(track), null, "초기화하면 잊는다");
});

test("담을 때 읽기(readFromBody)를 기억하고, 캐시 다운로드가 시작되면 끊고 다운로드가 알릴 때까지 다시 찾지 않는다", async (t) => {
  if (!mp3) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const track = direct("enqueued");
  const key = audioKeyOf(track.audioUrl)!;
  await embeddedArt.readFromBody(key, track.audioUrl, Readable.from([mp3]));
  assert.equal(embeddedArt.tagsFor(track)?.title, "태그 제목");

  const slow = direct("slow");
  const slowKey = audioKeyOf(slow.audioUrl)!;
  const body = new Readable({ read() {} });
  body.push(mp3.subarray(0, 100));
  const reading = embeddedArt.readFromBody(slowKey, slow.audioUrl, body);
  embeddedArt.cancelSource(slowKey);
  await assert.rejects(reading);
  assert.ok(body.destroyed);
  embeddedArt.want([slow]);
  await settled();
  assert.equal(opened.length, 0, "다운로드가 맡은 동안 원본을 다시 열지 않는다");
  // 다운로드가 결과를 알리면 풀린다(캐시 파일이 없으면 결과는 남지 않고 다시 찾는다)
  embeddedArt.noteFile(slowKey, null, null);
  embeddedArt.want([slow]);
  await settled();
  assert.deepEqual(
    opened.map((one) => one.url),
    [slow.audioUrl],
  );
});
