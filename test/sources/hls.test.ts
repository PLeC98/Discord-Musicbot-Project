// src/sources/hls.ts: 직접 링크 HLS 의 목록 받기, 선택, 라이브 따라가기, 세그먼트 받기(바이트 구간, 초기화 세그먼트, AES-128).
// 네트워크는 가짜다(주소 → 응답)

import crypto from "node:crypto";
import { Readable } from "node:stream";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openHls, type HlsFragments } from "../../src/sources/hls.ts";
import { codeOf, messageOf } from "../../src/rules/error-kind.ts";
import * as DirectLink from "../../src/sources/direct.ts";
import type { AudioStream, OpenOptions } from "../../src/sources/direct-open.ts";
import * as SafeUrl from "../../src/infra/safe-url.ts";

type Reply = { body?: Buffer | string; status?: number; url?: string; honorsRange?: boolean };

/** 가짜 SafeUrl. routes 의 값이 함수면 부를 때마다 답을 정한다. 4xx, 5xx 는 SafeUrl 처럼 status 를 단 오류 */
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

test("VOD: 위치가 든 세그먼트부터 받고 그 세그먼트의 시작을 알린다", async () => {
  const { net } = netOf({ "https://v.test/a.ts": { body: "a" }, "https://v.test/b.ts": { body: "b" }, "https://v.test/c.ts": { body: "c" } });
  const hls = await openHls(vod(["a.ts", "b.ts", "c.ts"]), "https://v.test/index.m3u8", { net });
  const from = hls.fragments(9_000);
  assert.equal(from.startedAtMs, 8_000);
  assert.deepEqual(await drain(from), ["c"]);
  assert.deepEqual(await drain(hls.fragments(99_000)), ["c"], "끝을 넘으면 마지막 세그먼트");
  assert.equal(hls.fragments().startedAtMs, 0);
});

test("바이트 구간은 끝이 있는 Range 로, 구간을 무시하는 서버면 잘라 쓴다. 초기화 세그먼트는 바뀔 때만 먼저 받는다", async () => {
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

test("AES-128: 키를 한 번 받아 풀고, IV 가 없으면 세그먼트 순번", async () => {
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

test("DRM(AES-128 밖의 암호), 목록이 아님은 열 때 unsupported-link", async () => {
  const drm = `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST\n`;
  for (const text of [drm, "[playlist]\nFile1=x"]) {
    await assert.rejects(openHls(text, "https://d.test/index.m3u8", { net: netOf({}).net }), (e: unknown) => codeOf(e) === "unsupported-link");
  }
});

test("세그먼트, 키: 4xx 와 가드가 막은 주소는 다시 받아도 같은 실패, 5xx 는 아니다", async () => {
  const { net } = netOf({ "https://e.test/gone.ts": { status: 404 }, "https://e.test/busy.ts": { status: 503 } });
  const blocked = {
    getStream: async (url: string, deps?: undefined, opts?: OpenOptions) => {
      if (url.includes("10.0.0.1")) throw new SafeUrl.SsrfError("내부 주소로 가는 요청은 막힙니다");
      return net.getStream(url, deps, opts);
    },
  };
  const text = `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\ngone.ts\n#EXTINF:4,\nbusy.ts\n#EXTINF:4,\nhttp://10.0.0.1/seg.ts\n#EXT-X-KEY:METHOD=AES-128,URI="http://10.0.0.1/key"\n#EXTINF:4,\nbusy.ts\n#EXT-X-ENDLIST\n`;
  const hls = await openHls(text, "https://e.test/index.m3u8", { net: blocked });
  const fragments = hls.fragments();
  const signal = new AbortController().signal;
  const permanentOf = (e: unknown) => (e as { permanent?: boolean }).permanent === true;
  await assert.rejects(fragments.fetch((await fragments.next())!, signal), permanentOf);
  await assert.rejects(fragments.fetch((await fragments.next())!, signal), (e: unknown) => !permanentOf(e));
  await assert.rejects(fragments.fetch((await fragments.next())!, signal), permanentOf, "막힌 세그먼트");
  const keyed = netOf({ "https://e.test/busy.ts": { body: Buffer.alloc(16) } });
  const withKey = await openHls(text, "https://e.test/index.m3u8", { net: { getStream: (url, deps, opts) => (url.includes("10.0.0.1") ? blocked.getStream(url, deps, opts) : keyed.net.getStream(url, deps, opts)) } });
  const parts = withKey.fragments();
  for (let i = 0; i < 3; i++) await parts.next();
  await assert.rejects(parts.fetch((await parts.next())!, signal), permanentOf, "막힌 키");
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
  assert.match(fragments.describe(6), /라이브 · 세그먼트 6개 흘림 · 마지막 순번 8 · 목록 다시 받음 3회/);
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
  assert.equal(await closing.next(), null, "남은 세그먼트가 있어도");
});

test("직접 링크로 담기, 열기: VOD 는 목록의 길이, 라이브는 라이브. DRM 은 알리고, 하위 목록이 막히면 사유를 숨긴다", async () => {
  const live = `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\ns1.ts\n`;
  const drm = `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST\n`;
  const master = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttp://10.0.0.1/inner.m3u8\n`;
  const { net } = netOf({
    "https://h.test/vod.m3u8": { body: vod(["a.ts", "b.ts", "c.ts"]) },
    "https://h.test/live.m3u8": { body: live },
    "https://h.test/drm.m3u8": { body: drm },
    "https://h.test/master.m3u8": { body: master },
  });
  const [v] = await DirectLink.getInfo("https://h.test/vod.m3u8", { net });
  assert.deepEqual([v.title, v.duration, v.durationSource, v.isLive], ["h.test", 12, "provided", undefined]);
  const [l] = await DirectLink.getInfo("https://h.test/live.m3u8", { net });
  assert.deepEqual([l.isLive, l.liveStatus, l.duration], [true, "is_live", 0]);
  const opened = await DirectLink.open("https://h.test/live.m3u8", net);
  assert.ok(opened.kind === "hls" && opened.hls.live);

  await assert.rejects(DirectLink.getInfo("https://h.test/drm.m3u8", { net }), (e: unknown) => codeOf(e) === "unsupported-link");
  await assert.rejects(DirectLink.open("https://h.test/drm.m3u8", net), (e: unknown) => codeOf(e) === "unsupported-link");
  // 가짜 네트워크가 SafeUrl 처럼 막힌 주소를 거절한다(여기서는 없는 주소의 404)
  await assert.rejects(DirectLink.open("https://h.test/master.m3u8", net), (e: unknown) => codeOf(e) === "direct-unavailable" && !messageOf(e).includes("10.0.0.1"));
});

test("세그먼트 상한: 구간을 무시한 200 의 구간 끝이 상한을 넘으면 받지 않고, 받는 중 상한 초과는 다시 받지 않는 실패", async () => {
  const permanentOf = (e: unknown) => (e as { permanent?: boolean }).permanent === true;
  let read = false;
  const net = {
    getStream: async (url: string) => {
      if (url.endsWith("far.mp4")) {
        const body = new Readable({ read: () => (read = true) });
        return Object.assign(body, { headers: {}, status: 200, url }) as AudioStream;
      }
      const body = new Readable({ read() {} });
      setImmediate(() => body.destroy(Object.assign(new Error("다운로드한 파일이 최대 크기를 초과했습니다"), { permanent: true })));
      return Object.assign(body, { headers: {}, status: 200, url }) as AudioStream;
    },
  };
  const text = `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-BYTERANGE:1000@${200 * 1024 * 1024}\n#EXTINF:4,\nfar.mp4\n#EXTINF:4,\nbig.ts\n#EXT-X-ENDLIST\n`;
  const fragments = (await openHls(text, "https://c.test/index.m3u8", { net })).fragments();
  const signal = new AbortController().signal;
  await assert.rejects(fragments.fetch((await fragments.next())!, signal), (e: unknown) => permanentOf(e) && /구간을 무시/.test(messageOf(e)));
  assert.equal(read, false, "본문을 읽지 않았다");
  await assert.rejects(fragments.fetch((await fragments.next())!, signal), permanentOf);
});

test("세그먼트 상한: 구간 요청은 파일 상한으로 연다(구간을 무시한 200 은 파일 전체 크기를 알린다). 구간 자체가 상한을 넘으면 요청하지 않는다", async () => {
  const accepts: Array<[string, number | undefined]> = [];
  const net = {
    getStream: async (url: string, _deps?: undefined, opts: OpenOptions = {}) => {
      accepts.push([url.slice(-6), opts.accept?.maxBytes]);
      return Object.assign(Readable.from([Buffer.alloc(2000)]), { headers: { "content-length": String(128 * 1024 * 1024) }, status: 200, url }) as AudioStream;
    },
  };
  const text = `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-BYTERANGE:1000@0\n#EXTINF:4,\nall.mp4\n#EXTINF:4,\nplain.ts\n#EXT-X-BYTERANGE:${65 * 1024 * 1024}@0\n#EXTINF:4,\nhuge.mp4\n#EXT-X-ENDLIST\n`;
  const fragments = (await openHls(text, "https://c.test/index.m3u8", { net })).fragments();
  const signal = new AbortController().signal;
  assert.equal(((await fragments.fetch((await fragments.next())!, signal)) as Buffer).length, 1000, "구간만 잘라 쓴다");
  const plain = await fragments.fetch((await fragments.next())!, signal);
  assert.ok(!Buffer.isBuffer(plain) && plain.kind === "pour" && plain.totalBytes === 128 * 1024 * 1024, "알린 크기가 커서 모으지 않고 넘긴다");
  if (!Buffer.isBuffer(plain)) plain.body.destroy();
  await assert.rejects(fragments.fetch((await fragments.next())!, signal), /구간이 최대 크기/);
  assert.deepEqual(accepts, [
    ["ll.mp4", SafeUrl.MAX_BYTES],
    ["ain.ts", SafeUrl.MAX_BYTES],
  ]);
});

test("세그먼트 취소: 신호를 가드에 넘기고, 헤더를 기다리는 사이 끝난 취소도 본문을 읽지 않고 그 사유로 끝난다", async () => {
  const controller = new AbortController();
  const signals: Array<AbortSignal | undefined> = [];
  const body = Object.assign(new Readable({ read() {} }), { headers: {}, status: 200, url: "https://c.test/a.ts" }) as AudioStream;
  const net = {
    getStream: async (_url: string, _deps?: undefined, opts: OpenOptions = {}) => {
      signals.push(opts.signal);
      controller.abort(new Error("곡을 넘김"));
      return body;
    },
  };
  const fragments = (await openHls(vod(["a.ts"]), "https://c.test/index.m3u8", { net })).fragments();
  await assert.rejects(fragments.fetch((await fragments.next())!, controller.signal), /곡을 넘김/);
  assert.deepEqual([signals[0] === controller.signal, body.destroyed], [true, true]);
});

test("라이브 목록의 비정상 수: 아주 큰 목표 길이도 다시 받기 대기는 상한 안이다", async () => {
  const live = (target: string) => `#EXTM3U\n#EXT-X-TARGETDURATION:${target}\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2,\ns1.ts\n`;
  const { net } = netOf({ "https://l.test/index.m3u8": () => ({ body: `${live("1e300")}#EXTINF:2,\ns2.ts\n#EXT-X-ENDLIST\n` }), "https://l.test/s1.ts": { body: "s1" }, "https://l.test/s2.ts": { body: "s2" } });
  const waits: number[] = [];
  const hls = await openHls(live("Infinity"), "https://l.test/index.m3u8", {
    net,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.deepEqual(await drain(hls.fragments()), ["s1", "s2"]);
  assert.deepEqual(waits, [500], "Infinity 는 0(가장 짧은 대기)");
  const big = await openHls(live("9999999"), "https://l.test/index.m3u8", { net, sleep: async (ms) => void waits.push(ms) });
  await drain(big.fragments());
  assert.equal(waits.at(-1), 60_000, "목표 길이는 60초까지");
});

// ── 모으지 않고 넘기는 세그먼트 ──

const MB = 1024 * 1024;
const pattern = (size: number) => Buffer.from(Array.from({ length: size }, (_, i) => (i * 31 + (i >> 10)) & 0xff));
const vodOf = (names: string[]) => `#EXTM3U\n#EXT-X-TARGETDURATION:4\n${names.map((name) => `#EXTINF:4,\n${name}\n`).join("")}#EXT-X-ENDLIST\n`;

// 세그먼트를 덩이로 흘리는 가짜. length 면 content-length 를 단다. gapMs 마다 한 덩이
function pourNet(segments: Record<string, { body: Buffer; length?: boolean; chunk?: number; gapMs?: number }>) {
  const asked: Array<{ url: string } & OpenOptions> = [];
  const net = {
    getStream: async (url: string, _deps?: undefined, opts: OpenOptions = {}) => {
      asked.push({ url, ...opts });
      const one = segments[url];
      if (!one) throw Object.assign(new Error("요청 실패: HTTP 404"), { status: 404 });
      const { body, length = false, chunk = 64 * 1024, gapMs = 0 } = one;
      let off = 0;
      const stream = new Readable({
        read() {
          if (off >= body.length) return void this.push(null);
          const piece = body.subarray(off, off + chunk);
          off += piece.length;
          if (gapMs) setTimeout(() => this.push(piece), gapMs);
          else this.push(piece);
        },
      });
      return Object.assign(stream, { headers: length ? { "content-length": String(body.length) } : {}, status: 200, url }) as AudioStream;
    },
  };
  return { net, asked };
}

const readRest = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

test("넘기기: 알린 크기가 1MB 를 넘으면 모으지 않고 곧바로 넘긴다(본문은 처음부터 남아 있고 이어 받을 주소, 헤더, 무응답 한도를 함께)", async () => {
  const big = pattern(3 * MB);
  const { net, asked } = pourNet({ "https://p.test/big.ts": { body: big, length: true } });
  const hls = await openHls(vodOf(["big.ts"]), "https://p.test/index.m3u8", { net, bodyIdleMs: 6000 });
  assert.equal(hls.idleMs, 6000);
  const fragments = hls.fragments();
  const got = await fragments.fetch((await fragments.next())!, new AbortController().signal);
  assert.ok(!Buffer.isBuffer(got));
  assert.deepEqual([got.kind, got.url, got.totalBytes, got.head, got.key, got.idleMs], ["pour", "https://p.test/big.ts", 3 * MB, null, null, 6000]);
  assert.equal(asked[0].bodyIdleMs, 6000, "세그먼트 요청에 무응답 한도");
  assert.deepEqual(await readRest(got.body), big);
});

test("넘기기: 크기를 모르면 1MB 를 넘는 데서 넘긴다. 앞부분과 나머지를 이으면 원본과 같다", async () => {
  const big = pattern(3 * MB + 123);
  const { net } = pourNet({ "https://p.test/big.ts": { body: big, chunk: 100_000 } });
  const fragments = (await openHls(vodOf(["big.ts"]), "https://p.test/index.m3u8", { net })).fragments();
  const got = await fragments.fetch((await fragments.next())!, new AbortController().signal);
  assert.ok(!Buffer.isBuffer(got) && got.head && got.totalBytes === null);
  assert.ok(got.head.length > MB && got.head.length < MB + 100_001);
  assert.deepEqual(Buffer.concat([got.head, await readRest(got.body)]), big);
});

test("모으기: 작고 빠른 세그먼트는 버퍼로, 덩이마다 progress 를 알린다", async () => {
  const small = pattern(300_000);
  const { net } = pourNet({ "https://p.test/s.ts": { body: small, length: true, chunk: 50_000 } });
  const fragments = (await openHls(vodOf(["s.ts"]), "https://p.test/index.m3u8", { net })).fragments();
  let progress = 0;
  const got = await fragments.fetch((await fragments.next())!, new AbortController().signal, () => progress++);
  assert.deepEqual(got, small);
  assert.ok(progress >= 6, `progress ${progress}`);
});

test("넘기기: 작아도 모으는 데 3초가 넘으면 넘긴다(그동안은 ffmpeg 에 입력이 없다)", async () => {
  const slow = pattern(400_000);
  const { net } = pourNet({ "https://p.test/slow.ts": { body: slow, length: true, chunk: 40_000, gapMs: 400 } });
  const fragments = (await openHls(vodOf(["slow.ts"]), "https://p.test/index.m3u8", { net })).fragments();
  const started = Date.now();
  const got = await fragments.fetch((await fragments.next())!, new AbortController().signal);
  const waited = Date.now() - started;
  assert.ok(!Buffer.isBuffer(got) && got.head && got.totalBytes === null, "모으다 넘긴 것은 이어 받지 않는다");
  assert.ok(waited >= 2900 && waited < 4500, `${waited}ms`);
  assert.deepEqual(Buffer.concat([got.head, await readRest(got.body)]), slow);
});

test("모으기: 문자열 덩이도 바이트로 받고, Buffer 도 문자열도 아닌 덩이는 그 세그먼트의 실패로(처리되지 않은 예외가 되지 않는다)", async () => {
  const bodyOf = (chunks: unknown[]) => ({
    getStream: async (url: string) => Object.assign(Readable.from(chunks, { objectMode: true }), { headers: {}, status: 200, url }) as AudioStream,
  });
  const words = (await openHls(vodOf(["s.ts"]), "https://p.test/index.m3u8", { net: bodyOf(["가나", "다"]) })).fragments();
  assert.deepEqual(await words.fetch((await words.next())!, new AbortController().signal), Buffer.from("가나다"));
  const odd = (await openHls(vodOf(["s.ts"]), "https://p.test/index.m3u8", { net: bodyOf([{ x: 1 }]) })).fragments();
  await assert.rejects(odd.fetch((await odd.next())!, new AbortController().signal), /덩이/);
});

test("키: 세그먼트를 열기 전에 받고, 기다리는 사이 신호가 끊으면 그 사유로 끝난다(세그먼트는 열지 않는다)", async () => {
  const asked: string[] = [];
  const net = {
    getStream: async (url: string) => {
      asked.push(url);
      return new Promise<AudioStream>(() => {});
    },
  };
  const text = `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST\n`;
  const fragments = (await openHls(text, "https://k.test/index.m3u8", { net })).fragments();
  const controller = new AbortController();
  const fetching = fragments.fetch((await fragments.next())!, controller.signal);
  await new Promise((done) => setTimeout(done, 10));
  controller.abort(new Error("곡을 넘김"));
  await assert.rejects(fetching, /곡을 넘김/);
  assert.deepEqual(asked, ["https://k.test/k"]);
});

test("합계: 모은 세그먼트는 받은 바이트로 세고, 넘긴 세그먼트는 받는 쪽이 count 로 센다(넘으면 다시 받지 않는 실패)", async () => {
  const { net } = pourNet({ "https://p.test/big.ts": { body: pattern(2 * MB), length: true } });
  const fragments = (await openHls(vodOf(["big.ts"]), "https://p.test/index.m3u8", { net })).fragments();
  const got = await fragments.fetch((await fragments.next())!, new AbortController().signal);
  assert.ok(!Buffer.isBuffer(got));
  got.body.destroy();
  got.count(SafeUrl.MAX_BYTES);
  assert.throws(
    () => got.count(1),
    (e: unknown) => (e as { permanent?: boolean }).permanent === true,
  );
});
