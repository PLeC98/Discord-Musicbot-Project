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

// raw: 그대로 돌려줄 상태 코드와 헤더(구간을 어긋나게 주는 서버). 없으면 구간을 따르는 서버는 206과 Content-Range를 붙인다
type Reply = { body?: Buffer | string; status?: number; url?: string; honorsRange?: boolean; raw?: { status: number; headers: Record<string, string> } };

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
      const full = Buffer.from(reply.body ?? "");
      if (reply.raw) return Object.assign(Readable.from([full]), { ...reply.raw, url: reply.url ?? url }) as AudioStream;
      const ranged = opts.from !== undefined && reply.honorsRange !== false;
      const body = ranged ? full.subarray(opts.from, (opts.to ?? full.length - 1) + 1) : full;
      const headers = ranged ? { "content-range": `bytes ${opts.from}-${opts.from! + body.length - 1}/${full.length}` } : {};
      return Object.assign(Readable.from([body]), { headers, status: ranged ? 206 : status, url: reply.url ?? url }) as AudioStream;
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

test("구간 응답(206)은 시작 위치를 확인한다: 구간 뒤에서 시작했으면 재시도하지 않는 실패로 처리하고, 앞에서 시작했으면 건너뛰고, 시작 위치 0에서 Content-Range가 없으면 그대로 받고, 더 보내면 구간만큼만 자르고, 파일 끝에서 잘렸으면 받은 만큼만 쓴다", async () => {
  const one = (range: string) => `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\n#EXT-X-BYTERANGE:${range}\nmain.mp4\n#EXT-X-ENDLIST\n`;
  const served = async (range: string, reply: Reply) => {
    const { net } = netOf({ "https://v.test/main.mp4": reply });
    const hls = await openHls(one(range), "https://v.test/index.m3u8", { net });
    const fragments = hls.fragments();
    const part = await fragments.next();
    return fragments.fetch(part!, new AbortController().signal) as Promise<Buffer>;
  };
  const failed = (got: Promise<unknown>) =>
    got.then(
      () => null,
      (e: unknown) => e as { permanent?: boolean },
    );
  const file = "INIT" + "AAAA" + "BBBB";
  assert.equal((await failed(served("4@4", { body: "BBBB", raw: { status: 206, headers: { "content-range": "bytes 8-11/12" } } })))?.permanent, true, "구간 뒤의 바이트를 ffmpeg에 주지 않는다");
  assert.equal((await served("4@4", { body: file, raw: { status: 206, headers: { "content-range": "bytes 0-11/12" } } })).toString(), "AAAA", "앞부분부터 보냈으면 건너뛴다(구간을 무시한 200과 같다)");
  assert.equal((await failed(served("4@4", { body: "AAAA", raw: { status: 206, headers: {} } })))?.permanent, true, "시작 위치가 0이 아니면 Content-Range 없이는 위치를 알 수 없다");
  assert.equal((await served("4@0", { body: file, raw: { status: 206, headers: {} } })).toString(), "INIT", "한 파일 HLS의 첫 구간");
  assert.equal((await served("4@4", { body: "AAAABBBB", raw: { status: 206, headers: { "content-range": "bytes 4-11/12" } } })).toString(), "AAAA");
  assert.equal((await served("8@8", { body: "BBBB", raw: { status: 206, headers: { "content-range": "bytes 8-11/12" } } })).toString(), "BBBB", "목록의 끝 구간이 파일 끝을 넘었다");
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

test("세그먼트, 키: 4xx 와 가드가 막은 주소는 재시도해도 같은 실패, 5xx 는 아니다", async () => {
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
  assert.match(fragments.describe(6), /라이브 · 세그먼트 6개 내보냄 · 마지막 순번 8 · 목록 다시 받음 3회/);
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

test("라이브: 갱신한 목록을 처리할 수 없으면(큰 순번) 재시도하지 않고 끝난다. 목록이 아닌 응답은 다시 받는다", async () => {
  const text = `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2,\ns1.ts\n`;
  const { net, asked } = netOf({ "https://l.test/index.m3u8": { body: "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:9007199254740992\n#EXTINF:2,\ns2.ts\n" }, "https://l.test/s1.ts": { body: "s1" } });
  const hls = await openHls(text, "https://l.test/index.m3u8", { net, sleep: instant });
  await assert.rejects(drain(hls.fragments()), { code: "unsupported-link" });
  assert.equal(asked.filter((a) => a.url.endsWith("index.m3u8")).length, 1, "한 번에");

  const lists = ["<html>잠시 오류</html>", `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:2\n#EXTINF:2,\ns2.ts\n#EXT-X-ENDLIST\n`];
  const flaky = netOf({ "https://l.test/index.m3u8": () => ({ body: lists.shift() ?? "" }), "https://l.test/s1.ts": { body: "s1" }, "https://l.test/s2.ts": { body: "s2" } });
  const again = await openHls(text, "https://l.test/index.m3u8", { net: flaky.net, sleep: instant });
  assert.deepEqual(await drain(again.fragments()), ["s1", "s2"]);
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

test("세그먼트 상한: 구간을 무시한 200의 구간 끝이 상한을 넘으면 받지 않고, 받는 중 상한을 초과하면 재시도하지 않는 실패로 끝난다", async () => {
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

test("세그먼트 상한: 구간 요청은 파일 상한으로 연다(구간을 무시한 200은 파일 전체 크기를 알린다). 구간 자체가 상한을 넘으면 요청하지 않는다", async () => {
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

test("세그먼트 취소: 신호를 가드에 넘기고, 헤더를 기다리는 사이에 취소되어도 본문을 읽지 않고 그 사유로 끝난다", async () => {
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

test("라이브 목록의 비정상 값: 목표 길이가 아주 커도 목록 갱신 대기 시간은 상한을 넘지 않는다", async () => {
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
  assert.deepEqual(waits, [500], "Infinity는 0(가장 짧은 대기)");
  const big = await openHls(live("9999999"), "https://l.test/index.m3u8", { net, sleep: async (ms) => void waits.push(ms) });
  await drain(big.fragments());
  assert.equal(waits.at(-1), 60_000, "목표 길이는 60초까지");
});

// ── 모으지 않고 넘기는 세그먼트 ──

const MB = 1024 * 1024;
const pattern = (size: number) => Buffer.from(Array.from({ length: size }, (_, i) => (i * 31 + (i >> 10)) & 0xff));
const vodOf = (names: string[]) => `#EXTM3U\n#EXT-X-TARGETDURATION:4\n${names.map((name) => `#EXTINF:4,\n${name}\n`).join("")}#EXT-X-ENDLIST\n`;

// 세그먼트를 청크로 나눠 보내는 가짜 네트워크다. length면 content-length를 달고, gapMs마다 한 청크씩 보낸다
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

test("넘기기: 알린 크기가 1MB를 넘으면 모으지 않고 곧바로 넘긴다(본문은 처음부터 남아 있고 이어 받을 주소, 헤더, 무응답 한도를 함께 넘긴다)", async () => {
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

test("넘기기: 크기를 모르면 1MB를 넘는 시점에 넘긴다. 앞부분과 나머지를 이으면 원본과 같다", async () => {
  const big = pattern(3 * MB + 123);
  const { net } = pourNet({ "https://p.test/big.ts": { body: big, chunk: 100_000 } });
  const fragments = (await openHls(vodOf(["big.ts"]), "https://p.test/index.m3u8", { net })).fragments();
  const got = await fragments.fetch((await fragments.next())!, new AbortController().signal);
  assert.ok(!Buffer.isBuffer(got) && got.head && got.totalBytes === null);
  assert.ok(got.head.length > MB && got.head.length < MB + 100_001);
  assert.deepEqual(Buffer.concat([got.head, await readRest(got.body)]), big);
});

test("모으기: 작고 빠른 세그먼트는 버퍼로 모으고, 청크마다 progress를 알린다", async () => {
  const small = pattern(300_000);
  const { net } = pourNet({ "https://p.test/s.ts": { body: small, length: true, chunk: 50_000 } });
  const fragments = (await openHls(vodOf(["s.ts"]), "https://p.test/index.m3u8", { net })).fragments();
  let progress = 0;
  const got = await fragments.fetch((await fragments.next())!, new AbortController().signal, () => progress++);
  assert.deepEqual(got, small);
  assert.ok(progress >= 6, `progress ${progress}`);
});

test("넘기기: 작아도 모으는 데 3초가 넘으면 넘긴다(그동안은 ffmpeg에 입력이 없다)", async () => {
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

test("모으기: 문자열 청크도 바이트로 받고, Buffer도 문자열도 아닌 청크는 그 세그먼트의 실패로 처리한다(처리되지 않은 예외가 되지 않는다)", async () => {
  const bodyOf = (chunks: unknown[]) => ({
    getStream: async (url: string) => Object.assign(Readable.from(chunks, { objectMode: true }), { headers: {}, status: 200, url }) as AudioStream,
  });
  const words = (await openHls(vodOf(["s.ts"]), "https://p.test/index.m3u8", { net: bodyOf(["가나", "다"]) })).fragments();
  assert.deepEqual(await words.fetch((await words.next())!, new AbortController().signal), Buffer.from("가나다"));
  const odd = (await openHls(vodOf(["s.ts"]), "https://p.test/index.m3u8", { net: bodyOf([{ x: 1 }]) })).fragments();
  await assert.rejects(odd.fetch((await odd.next())!, new AbortController().signal), /청크/);
});

test("모으기: 본문이 오류 없이 닫히면 그 자리에서 다시 받을 수 있는 실패로 처리한다(넘길 때까지 기다리지 않는다)", async () => {
  const net = {
    getStream: async (url: string) => {
      const body = new Readable({ read() {} });
      body.push(Buffer.from("앞"));
      setTimeout(() => body.destroy(), 20);
      return Object.assign(body, { headers: {}, status: 200, url }) as AudioStream;
    },
  };
  const fragments = (await openHls(vodOf(["s.ts"]), "https://p.test/index.m3u8", { net })).fragments();
  const started = Date.now();
  await assert.rejects(fragments.fetch((await fragments.next())!, new AbortController().signal), (e: Error & { permanent?: boolean; code?: string }) => e.code === "ERR_STREAM_PREMATURE_CLOSE" && !e.permanent);
  assert.ok(Date.now() - started < 1000, "3초를 기다리지 않았다");
});

test("키: 세그먼트를 열기 전에 받고, 기다리는 사이 취소 신호가 오면 그 사유로 끝난다(세그먼트는 열지 않는다)", async () => {
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

test("합계: 모은 세그먼트는 받은 바이트로 세고, 넘긴 세그먼트는 받는 쪽이 count로 센다(상한을 넘으면 재시도하지 않는 실패)", async () => {
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

test("라이브: 읽을 수 없는 바이트 구간은 그 세그먼트를 받을 차례에만 실패한다(이미 지나간 세그먼트는 상관없다). VOD 는 열지 않는다", async () => {
  const bad = (name: string) => `#EXTINF:2,\n#EXT-X-BYTERANGE:0@0\n${name}\n`;
  const good = (name: string) => `#EXTINF:2,\n${name}\n`;
  const lists = [
    // 지나간 s1 의 구간을 읽을 수 없다. 새 세그먼트 s3 은 읽는다
    `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:1\n${bad("s1.ts")}${good("s2.ts")}${good("s3.ts")}`,
    // 새 세그먼트 s4 는 받고, s5 에 이르면 실패한다
    `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:3\n${good("s3.ts")}${good("s4.ts")}${bad("s5.ts")}${good("s6.ts")}`,
  ];
  const routes: Record<string, Reply | (() => Reply)> = { "https://l.test/index.m3u8": () => ({ body: lists.shift() ?? "" }) };
  for (let i = 1; i <= 6; i++) routes[`https://l.test/s${i}.ts`] = { body: `s${i}` };
  const { net } = netOf(routes);
  const first = `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:1\n${good("s1.ts")}${good("s2.ts")}`;
  const hls = await openHls(first, "https://l.test/index.m3u8", { net, sleep: instant });
  const fragments = hls.fragments();
  const got: string[] = [];
  await assert.rejects(
    (async () => {
      for (let part = await fragments.next(); part; part = await fragments.next()) got.push((await fragments.fetch(part, new AbortController().signal)).toString());
    })(),
    (e: Error & { permanent?: boolean }) => codeOf(e) === "unsupported-link" && e.permanent === true,
  );
  assert.deepEqual(got, ["s1", "s2", "s3", "s4"]);

  const vod = `#EXTM3U\n#EXT-X-TARGETDURATION:2\n${good("a.ts")}${bad("b.ts")}#EXT-X-ENDLIST\n`;
  await assert.rejects(openHls(vod, "https://v.test/index.m3u8", { net, sleep: instant }), { code: "unsupported-link" });
});
