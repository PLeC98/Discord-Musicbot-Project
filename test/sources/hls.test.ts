// src/sources/hls.ts — 직접 링크 HLS 의 목록 받기 · 고르기 · 라이브 따라가기 · 조각 받기(바이트 구간 · 머리 조각 · AES-128).
// 네트워크는 가짜다(주소 → 응답)

import crypto from "node:crypto";
import { Readable } from "node:stream";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openHls, type HlsFragments } from "../../src/sources/hls.ts";
import { codeOf } from "../../src/rules/error-kind.ts";
import type { AudioStream, OpenOptions } from "../../src/sources/direct-open.ts";

type Reply = { body?: Buffer | string; status?: number; url?: string; honorsRange?: boolean };

/** 가짜 SafeUrl. routes 의 값이 함수면 부를 때마다 답을 정한다. 4xx · 5xx 는 SafeUrl 처럼 status 를 단 오류 */
function netOf(routes: Record<string, Reply | (() => Reply)>) {
  const asked: Array<{ url: string; from?: number; to?: number }> = [];
  const net = {
    getStream: async (url: string, _deps?: undefined, opts: OpenOptions = {}) => {
      asked.push({ url, from: opts.from, to: opts.to });
      const route = routes[url];
      if (!route) throw Object.assign(new Error("요청 실패: HTTP 404"), { status: 404 });
      const reply = typeof route === "function" ? route() : route;
      const status = reply.status ?? 200;
      if (status >= 400) throw Object.assign(new Error(`요청 실패: HTTP ${status}`), { status });
      let body = Buffer.from(reply.body ?? "");
      const ranged = opts.from !== undefined && reply.honorsRange !== false;
      if (ranged) body = body.subarray(opts.from, (opts.to ?? body.length - 1) + 1);
      return Object.assign(Readable.from([body]), { headers: {}, status: ranged ? 206 : status, url: reply.url ?? url }) as AudioStream;
    },
  };
  return { net, asked };
}

const instant = async () => {};

async function drain(fragments: HlsFragments) {
  const out: string[] = [];
  for (let part = await fragments.next(); part; part = await fragments.next()) out.push((await fragments.fetch(part, new AbortController().signal)).toString());
  return out;
}

const vod = (segments: string[], extra = "") => `#EXTM3U\n#EXT-X-TARGETDURATION:4\n${extra}${segments.map((s) => `#EXTINF:4,\n${s}\n`).join("")}#EXT-X-ENDLIST\n`;

test("상위 목록: 음성 따로를 골라 하위 목록을 한 번 더 받는다. 상대 주소는 리다이렉트를 거친 마지막 주소 기준", async () => {
  const master = `#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Main",DEFAULT=YES,URI="audio/index.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=900000,AUDIO="a"\nvideo/index.m3u8\n`;
  const { net, asked } = netOf({
    "https://cdn.test/live/audio/index.m3u8": { body: vod(["s1.ts", "s2.ts"]), url: "https://edge.test/x/index.m3u8" },
    "https://edge.test/x/s1.ts": { body: "one|" },
    "https://edge.test/x/s2.ts": { body: "two|" },
  });
  const hls = await openHls(master, "https://cdn.test/live/master.m3u8", { net });
  assert.deepEqual([hls.live, hls.durationMs], [false, 8000]);
  assert.deepEqual(await drain(hls.fragments()), ["one|", "two|"]);
  assert.deepEqual(
    asked.map((a) => a.url),
    ["https://cdn.test/live/audio/index.m3u8", "https://edge.test/x/s1.ts", "https://edge.test/x/s2.ts"],
  );
});

test("VOD: 위치가 든 조각부터 받고 그 조각의 시작을 알린다", async () => {
  const { net } = netOf({ "https://v.test/a.ts": { body: "a" }, "https://v.test/b.ts": { body: "b" }, "https://v.test/c.ts": { body: "c" } });
  const hls = await openHls(vod(["a.ts", "b.ts", "c.ts"]), "https://v.test/index.m3u8", { net });
  const from = hls.fragments(9_000);
  assert.equal(from.startedAtMs, 8_000);
  assert.deepEqual(await drain(from), ["c"]);
  assert.deepEqual(await drain(hls.fragments(99_000)), ["c"], "끝을 넘으면 마지막 조각");
  assert.equal(hls.fragments().startedAtMs, 0);
});

test("바이트 구간은 끝이 있는 Range 로, 구간을 무시하는 서버면 잘라 쓴다. 머리 조각은 바뀔 때만 먼저 받는다", async () => {
  const file = "INIT" + "AAAA" + "BBBB";
  const text = `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MAP:URI="main.mp4",BYTERANGE="4@0"\n#EXTINF:4,\n#EXT-X-BYTERANGE:4@4\nmain.mp4\n#EXTINF:4,\n#EXT-X-BYTERANGE:4\nmain.mp4\n#EXT-X-MAP:URI="other.mp4"\n#EXTINF:4,\nseg.m4s\n#EXT-X-ENDLIST\n`;
  for (const honorsRange of [true, false]) {
    const { net, asked } = netOf({ "https://f.test/main.mp4": { body: file, honorsRange }, "https://f.test/other.mp4": { body: "INIT2" }, "https://f.test/seg.m4s": { body: "CCCC" } });
    const hls = await openHls(text, "https://f.test/index.m3u8", { net });
    assert.deepEqual(await drain(hls.fragments()), ["INIT", "AAAA", "BBBB", "INIT2", "CCCC"], `honorsRange=${honorsRange}`);
    assert.deepEqual(
      asked.slice(0, 3).map((a) => [a.from, a.to]),
      [
        [0, 3],
        [4, 7],
        [8, 11],
      ],
    );
  }
});

test("AES-128: 키를 한 번 받아 풀고, IV 가 없으면 조각 순번", async () => {
  const key = Buffer.alloc(16, 1);
  const iv = Buffer.alloc(16, 7);
  const seal = (text: string, withIv: Buffer) => {
    const cipher = crypto.createCipheriv("aes-128-cbc", key, withIv);
    return Buffer.concat([cipher.update(text), cipher.final()]);
  };
  const seqIv = Buffer.alloc(16);
  seqIv.writeBigUInt64BE(11n, 8);
  const text = `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:10\n#EXT-X-KEY:METHOD=AES-128,URI="k",IV=0x${iv.toString("hex")}\n#EXTINF:4,\na.ts\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:4,\nb.ts\n#EXT-X-ENDLIST\n`;
  const { net, asked } = netOf({ "https://k.test/k": { body: key }, "https://k.test/a.ts": { body: seal("열림 하나", iv) }, "https://k.test/b.ts": { body: seal("열림 둘", seqIv) } });
  const hls = await openHls(text, "https://k.test/index.m3u8", { net });
  assert.deepEqual(await drain(hls.fragments()), ["열림 하나", "열림 둘"]);
  assert.equal(asked.filter((a) => a.url === "https://k.test/k").length, 1, "키는 한 번");

  const wrong = netOf({ "https://k.test/k": { body: Buffer.alloc(16, 2) }, "https://k.test/a.ts": { body: seal("x", iv) } });
  const broken = await openHls(text, "https://k.test/index.m3u8", { net: wrong.net });
  const part = (await broken.fragments().next())!;
  await assert.rejects(broken.fragments().fetch(part, new AbortController().signal), (e: unknown) => (e as { permanent?: boolean }).permanent === true);
});

test("DRM(AES-128 밖의 암호) · 목록이 아님은 열 때 unsupported-link", async () => {
  const drm = `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST\n`;
  for (const text of [drm, "[playlist]\nFile1=x"]) {
    await assert.rejects(openHls(text, "https://d.test/index.m3u8", { net: netOf({}).net }), (e: unknown) => codeOf(e) === "unsupported-link");
  }
});

test("조각: 4xx 는 다시 받아도 같은 실패, 5xx 는 아니다", async () => {
  const { net } = netOf({ "https://e.test/gone.ts": { status: 404 }, "https://e.test/busy.ts": { status: 503 } });
  const hls = await openHls(vod(["gone.ts", "busy.ts"]), "https://e.test/index.m3u8", { net });
  const fragments = hls.fragments();
  const signal = new AbortController().signal;
  await assert.rejects(fragments.fetch((await fragments.next())!, signal), (e: unknown) => (e as { permanent?: boolean }).permanent === true);
  await assert.rejects(fragments.fetch((await fragments.next())!, signal), (e: unknown) => (e as { permanent?: boolean }).permanent !== true);
});

test("라이브: 끝 가까이부터, 목록을 다시 받아 순번으로 잇고, 끝 표시가 생기면 끝난다", async () => {
  const live = (sequence: number, count: number, ended = false) => `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${sequence}\n${Array.from({ length: count }, (_, i) => `#EXTINF:2,\ns${sequence + i}.ts\n`).join("")}${ended ? "#EXT-X-ENDLIST\n" : ""}`;
  const lists = [live(1, 5), live(2, 5), live(2, 5), live(4, 5, true)];
  const routes: Record<string, Reply | (() => Reply)> = { "https://l.test/index.m3u8": () => ({ body: lists.shift() ?? live(4, 5, true) }) };
  for (let i = 1; i <= 8; i++) routes[`https://l.test/s${i}.ts`] = { body: `s${i}` };
  const { net } = netOf(routes);
  const waits: number[] = [];
  const hls = await openHls(lists.shift()!, "https://l.test/index.m3u8", {
    net,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.deepEqual([hls.live, hls.durationMs], [true, null]);
  const fragments = hls.fragments(30_000);
  assert.deepEqual(await drain(fragments), ["s3", "s4", "s5", "s6", "s7", "s8"], "위치는 보지 않고 끝에서 셋 앞부터, 순번으로 이어서");
  assert.deepEqual(waits, [2000, 2000, 1000], "바뀌지 않았으면 목표 길이의 절반 뒤");
  assert.match(fragments.describe(6), /라이브 · 조각 6개 흘림 · 마지막 순번 8 · 목록 다시 받음 3회/);
});

test("라이브: 목록을 연달아 받지 못하면 오류로 끝나고(방송이 끝남과 다르다), 닫으면 멈춘다", async () => {
  const text = `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2,\ns1.ts\n#EXTINF:2,\ns2.ts\n`;
  const { net, asked } = netOf({ "https://l.test/index.m3u8": { status: 503 }, "https://l.test/s1.ts": { body: "s1" }, "https://l.test/s2.ts": { body: "s2" } });
  const hls = await openHls(text, "https://l.test/index.m3u8", { net, sleep: instant });
  await assert.rejects(drain(hls.fragments()), /HTTP 503/);
  assert.equal(asked.filter((a) => a.url.endsWith("index.m3u8")).length, 3, "세 번까지");

  const closing = hls.fragments();
  await closing.next();
  closing.close();
  assert.equal(await closing.next(), null, "남은 조각이 있어도");
});
