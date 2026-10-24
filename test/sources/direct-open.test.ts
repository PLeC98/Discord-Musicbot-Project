// src/sources/direct-open.ts — 직접 링크를 GET 하나로 열어 판정하고, 읽은 앞부분은 되돌려 넣는다

import { Readable } from "node:stream";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openLink, type AudioStream, type OpenOptions } from "../../src/sources/direct-open.ts";
import { taggedMp3 } from "../helpers/tagged-audio.ts";

/** 가짜 SafeUrl: 그 응답(헤더 · 본문 · 마지막 주소). endless 면 다 보낸 뒤에도 닫지 않고 같은 조각을 흘린다 */
function netOf(body: Buffer, headers: Record<string, unknown>, { url = "https://final.test/x", endless = false } = {}) {
  const asked: OpenOptions[] = [];
  const net = {
    getStream: async (_url: string, _deps?: undefined, opts: OpenOptions = {}) => {
      asked.push(opts);
      let at = 0;
      const stream = new Readable({
        read() {
          if (at >= body.length && !endless) return void this.push(null);
          const piece = body.subarray(at % body.length, (at % body.length) + 1000);
          at += piece.length;
          this.push(piece);
        },
      });
      return Object.assign(stream, { headers, status: 200, url }) as AudioStream;
    },
  };
  return { net, asked };
}

const read = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
};

test("음원: 앞부분을 읽어 판정하고 되돌려 넣는다(본문이 원본과 같다). 크기 · 라디오가 아님", async (t) => {
  const mp3 = await taggedMp3();
  if (!mp3) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const { net } = netOf(mp3, { "content-type": "application/octet-stream", "content-length": String(mp3.length) });
  const opened = await openLink("https://files.test/a", { net });
  assert.equal(opened.kind, "file");
  if (opened.kind !== "file") return;
  assert.deepEqual([opened.length, opened.radio], [mp3.length, false]);
  assert.equal(Buffer.compare(await read(opened.body), mp3), 0);
});

test("웹 페이지 · 그림은 음원이 아니다(확장자가 거짓이어도)", async () => {
  assert.deepEqual(await openLink("https://files.test/a.mp3", { net: netOf(Buffer.from("<!doctype html><p>없음</p>"), { "content-type": "text/html" }).net }), { kind: "page" });
  const png = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000000", "hex");
  assert.deepEqual(await openLink("https://files.test/a.mp3", { net: netOf(png, { "content-type": "image/png" }).net }), { kind: "other" });
});

test("HLS · 단순 목록: 다 읽고, 상대 주소의 기준은 리다이렉트를 거친 마지막 주소", async () => {
  const hls = await openLink("https://short.test/live", { net: netOf(Buffer.from("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg1.ts\n"), { "content-type": "text/plain" }, { url: "https://cdn.test/radio/index.m3u8" }).net });
  assert.equal(hls.kind, "hls");
  if (hls.kind === "hls") assert.deepEqual([hls.url, hls.text.includes("seg1.ts")], ["https://cdn.test/radio/index.m3u8", true]);
  const pls = await openLink("https://site.test/listen.pls", { net: netOf(Buffer.from("[playlist]\nFile1=stream/128\n"), { "content-type": "audio/x-scpls" }, { url: "https://radio.test/x/listen.pls" }).net });
  assert.deepEqual(pls, { kind: "list", target: "https://radio.test/x/stream/128" });
  const huge = await openLink("https://site.test/big.m3u8", { net: netOf(Buffer.from(`#EXTM3U\n#EXT-X-VERSION:3\n${"#EXTINF:1,\nseg.ts\n".repeat(80_000)}`), { "content-type": "application/x-mpegurl" }).net });
  assert.deepEqual(huge, { kind: "other" }, "1MB 넘는 목록은 읽지 않는다");
});

test("인터넷 라디오(끝이 없는 응답): 앞부분만 읽고 바로 답하고, 본문은 이어 흐른다", { timeout: 10_000 }, async (t) => {
  const mp3 = await taggedMp3();
  if (!mp3) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const { net } = netOf(mp3.subarray(0, 8000), { "content-type": "audio/mpeg", "icy-name": "라디오" }, { endless: true });
  const opened = await openLink("https://radio.test/stream", { net });
  assert.equal(opened.kind, "file");
  if (opened.kind !== "file") return;
  assert.deepEqual([opened.radio, opened.length], [true, null]);
  let got = 0;
  for await (const chunk of opened.body as AsyncIterable<Buffer>) {
    got += chunk.length;
    if (got > 20_000) break;
  }
  assert.ok(got > 20_000);
});

test("구간으로 열면(이어받기) 판정 없이 그 응답을 그대로. 받는 형식은 모두(판정이 거절한다)", async () => {
  const { net, asked } = netOf(Buffer.from("anything"), { "content-type": "audio/mpeg" });
  const opened = await openLink("https://files.test/a.mp3", { net, from: 4096, ifRange: '"e1"' });
  assert.equal(opened.kind, "file");
  assert.deepEqual([asked[0].from, asked[0].ifRange, asked[0].accept?.contentType.test("text/html")], [4096, '"e1"', true]);
  if (opened.kind === "file") opened.body.destroy();
});

test("열리지 않으면 SafeUrl 의 오류를 그대로 던진다(부르는 쪽이 숨긴다)", async () => {
  const net = {
    getStream: async () => {
      throw new Error("SSRF 차단: 10.0.0.1");
    },
  };
  await assert.rejects(openLink("https://files.test/a", { net }), /10\.0\.0\.1/);
});
