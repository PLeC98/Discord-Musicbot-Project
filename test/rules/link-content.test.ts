// src/rules/link-content.ts — 직접 링크의 응답이 무엇인가(음원 · HLS · 단순 목록 · 웹 페이지 · 그 밖)와 단순 목록의 첫 주소

import { test } from "node:test";
import assert from "node:assert/strict";
import { contentOf, listTarget } from "../../src/rules/link-content.ts";
import { taggedMp3 } from "../helpers/tagged-audio.ts";

const text = (value: string) => new TextEncoder().encode(value);
/** MPEG1 layer III 128kbps 44.1kHz 프레임 머리 + 채움(한 프레임 417 바이트) */
const frame = () => Uint8Array.from([0xff, 0xfb, 0x90, 0x64, ...new Array(413).fill(0)]);
const frames = (n: number) => Uint8Array.from(Array.from({ length: n }, frame).flatMap((one) => [...one]));

test("글로 아는 것: #EXTM3U 에 #EXT-X- 가 있으면 HLS, 없으면 단순 목록, [playlist] 는 PLS, 맨 앞 '<' 는 웹 페이지. 헤더보다 앞선다", async () => {
  assert.equal(await contentOf("application/vnd.apple.mpegurl", text("#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:10,\na.ts\n")), "hls");
  assert.equal(await contentOf("text/plain", text("﻿#EXTM3U\n#EXT-X-TARGETDURATION:6\n")), "hls", "BOM · text/plain");
  assert.equal(await contentOf("audio/x-mpegurl", text("#EXTM3U\n#EXTINF:-1,라디오\nhttp://r.test/stream\n")), "list");
  assert.equal(await contentOf("audio/x-scpls", text("[playlist]\nFile1=http://r.test/stream\n")), "list");
  assert.equal(await contentOf("audio/mpeg", text("  <!DOCTYPE html><html>오류</html>")), "page", "거짓 Content-Type: 200 으로 온 오류 페이지");
  assert.equal(await contentOf("text/html; charset=utf-8", text("<html></html>")), "page");
});

test("형식 판별: 실제 MP3(ID3) · 프레임만 있는 MPEG 는 음원, 그림은 그 밖, 헤더 없이 모르는 바이트는 그 밖", async (t) => {
  const mp3 = await taggedMp3();
  if (!mp3) return t.skip("ffmpeg로 시료를 만들 수 없음");
  assert.equal(await contentOf("application/octet-stream", mp3.subarray(0, 4100)), "audio", "octet-stream 의 MP3");
  assert.equal(await contentOf(null, frames(4)), "audio", "헤더 없이 MPEG 프레임 넷");
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  assert.equal(await contentOf("image/png", png), "other");
  assert.equal(await contentOf("audio/mpeg", png), "other", "음원이라 해도 그림이면 그 밖");
  assert.equal(
    await contentOf(
      "application/octet-stream",
      Uint8Array.from({ length: 4100 }, (_, i) => (i * 7) % 251),
    ),
    "other",
  );
});

test("우연히 맞은 MPEG 동기 바이트는 프레임 둘이 잇달지 않으면 믿지 않는다(헤더가 음원이면 헤더대로)", async () => {
  const lone = Uint8Array.from([...frame().subarray(0, 4), ...new Array(4096).fill(0x41)]);
  assert.equal(await contentOf("application/octet-stream", lone), "other");
  assert.equal(await contentOf("audio/mpeg", lone), "audio", "라디오가 프레임 중간부터 흘리는 등 헤더를 믿는다");
});

test("헤더만으로: 음원 · 영상 형식이면 음원, 재생목록 형식인데 글이 주소 줄이면 목록, HTML 은 웹 페이지, 비면 그 밖", async () => {
  assert.equal(await contentOf("audio/aacp", new Uint8Array(0)), "audio");
  assert.equal(await contentOf("application/x-mpegurl", text("http://r.test/a\n")), "list");
  assert.equal(await contentOf("application/x-mpegurl", text("not a list")), "other");
  assert.equal(await contentOf("text/html", new Uint8Array(0)), "page");
  assert.equal(await contentOf(undefined, new Uint8Array(0)), "other");
});

test("단순 목록의 첫 주소: PLS 는 File1=, M3U 는 # 이 아닌 줄. 상대 주소는 목록 기준, http(s) 만", () => {
  assert.equal(listTarget("[playlist]\nNumberOfEntries=2\nFile1=http://r.test/a\nFile2=http://r.test/b\n", "https://site.test/listen.pls"), "http://r.test/a");
  assert.equal(listTarget("#EXTM3U\n#EXTINF:-1,라디오\nstream/128\n", "https://site.test/radio/listen.m3u"), "https://site.test/radio/stream/128");
  assert.equal(listTarget("file:///etc/passwd\nftp://x/y\nhttps://ok.test/s\n", "https://site.test/a.m3u"), "https://ok.test/s", "http(s) 가 아닌 줄은 건너뛴다");
  assert.equal(listTarget("[playlist]\nTitle1=x\n", "https://site.test/a.pls"), null);
});
