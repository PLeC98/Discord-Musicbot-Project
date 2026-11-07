// src/media/direct-input.ts: 직접 링크를 재생, 다운로드 입력으로. 파일은 본문, HLS 는 세그먼트 스트림. 끝이 없는가(live), 끝과 크기를 아는가(bounded)

import crypto from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openDirectInput, guardedRanges, validatorOf, decrypting } from "../../src/media/direct-input.ts";
import * as SafeUrl from "../../src/infra/safe-url.ts";
import { codeOf } from "../../src/rules/error-kind.ts";
import type { DirectOpen } from "../../src/sources/direct.ts";
import { openHls, type Hls, type HlsPart } from "../../src/sources/hls.ts";
import type { AudioStream, OpenOptions } from "../../src/sources/direct-open.ts";
import sink from "../../src/infra/log/sink.ts";

const file =
  (radio: boolean, length: number | null, headers: Record<string, unknown> = {}) =>
  async (): Promise<DirectOpen> => ({ kind: "file", body: Object.assign(new PassThrough(), { headers }), radio, length });

function hlsOf(live: boolean, asked: number[] = []): () => Promise<DirectOpen> {
  const hls: Hls = {
    live,
    durationMs: live ? null : 8000,
    idleMs: 10_000,
    fragments(startMs = 0) {
      asked.push(startMs);
      const parts = ["a", "b"];
      return {
        next: async () => {
          const name = parts.shift();
          return name ? ({ url: name, range: null, key: null, sequence: 0 } satisfies HlsPart) : null;
        },
        fetch: async (part) => Buffer.from(part.url),
        startedAtMs: 4000,
        describe: (sent) => `흘림 ${sent}`,
        close: () => {},
      };
    },
  };
  return async () => ({ kind: "hls", hls });
}

test("파일: 크기를 알리면 bounded, 인터넷 라디오는 live(크기를 붙여도)", async () => {
  const cases = [
    [false, 4096, { live: false, bounded: true }],
    [false, null, { live: false, bounded: false }],
    [true, 54_000_000, { live: true, bounded: false }],
  ] as const;
  for (const [radio, length, want] of cases) {
    const input = await openDirectInput("https://f.test/a", {}, file(radio, length));
    assert.deepEqual({ live: input.live, bounded: input.bounded }, want, `radio=${radio} length=${length}`);
    input.destroy();
  }
});

test("HLS: VOD 는 bounded 이고 위치를 세그먼트 단위로 넘긴다, 라이브는 live", async () => {
  const asked: number[] = [];
  const vod = await openDirectInput("https://h.test/v.m3u8", { startMs: 5000 }, hlsOf(false, asked));
  assert.deepEqual([vod.live, vod.bounded, vod.startedAtMs, asked], [false, true, 4000, [5000]]);
  let text = "";
  for await (const chunk of vod) text += String(chunk);
  assert.equal(text, "ab");
  assert.equal(vod.describe?.(), "흘림 2");

  const live = await openDirectInput("https://h.test/l.m3u8", {}, hlsOf(true));
  assert.deepEqual([live.live, live.bounded], [true, false]);
  live.destroy();
});

test("끊긴 라이브를 다시 열 때(liveOnly) 목록이 끝났으면 live-ended. 라이브면 연다", async () => {
  await assert.rejects(openDirectInput("https://h.test/x.m3u8", { liveOnly: true }, hlsOf(false)), (e: unknown) => codeOf(e) === "live-ended");
  const reopened = await openDirectInput("https://h.test/x.m3u8", { liveOnly: true }, hlsOf(true));
  assert.equal(reopened.live, true);
  reopened.destroy();
});

test("이어받기: 크기를 알리고 상한 안인 파일만. 검사값은 강한 ETag, 없으면 Last-Modified", async () => {
  const resumableOf = async (radio: boolean, length: number | null, headers: Record<string, unknown> = {}) => {
    const input = await openDirectInput("https://f.test/a", {}, file(radio, length, headers));
    input.destroy();
    return input.resumable;
  };
  const got = await resumableOf(false, 4096, { etag: '"abc"' });
  assert.deepEqual([got?.totalBytes, got?.validator], [4096, '"abc"']);
  assert.equal((await resumableOf(false, 4096, { etag: 'W/"weak"', "last-modified": "Tue, 20 Oct 2026 00:00:00 GMT" }))?.validator, "Tue, 20 Oct 2026 00:00:00 GMT");
  assert.equal((await resumableOf(false, 4096))?.validator, null, "검사값이 없으면 If-Range 없이(바뀐 파일은 전체 크기 · 구간으로 가린다)");
  assert.equal(await resumableOf(false, null), undefined, "크기를 모르면 잇지 않는다");
  assert.equal(await resumableOf(true, 4096), undefined, "라디오는 잇지 않는다");
  assert.equal(await resumableOf(false, SafeUrl.DIRECT_LINK.maxBytes + 1), undefined, "상한을 넘으면 잇지 않는다");
  assert.equal(validatorOf({ etag: "" }), null);
});

test("Range 어댑터: 구간, If-Range 를 가드에 넘기고, 상태 오류는 응답으로, 가드가 막으면 재시도하지 않음, 끊으면 본문을 부순다", async () => {
  const asked: unknown[] = [];
  const body = Object.assign(PassThrough.from([Buffer.from("xyz")]), { headers: { "content-range": "bytes 3-5/9" }, status: 206 });
  const fetch = guardedRanges(async (url, _deps, opts) => {
    asked.push([url, opts.from, opts.to, opts.ifRange]);
    return body;
  });
  const controller = new AbortController();
  const res = await fetch("https://f.test/a", { headers: { Range: "bytes=3-5", "If-Range": '"e"' }, signal: controller.signal });
  assert.deepEqual(asked, [["https://f.test/a", 3, 5, '"e"']]);
  assert.deepEqual([res.status, res.headers.get?.("Content-Range")], [206, "bytes 3-5/9"]);
  body.on("error", () => {}); // 읽는 쪽(청크 스트림)이 받을 오류
  controller.abort(new Error("멈춤"));
  assert.equal(body.destroyed, true);

  const failing = (error: Error) =>
    guardedRanges(async () => {
      throw error;
    });
  const gone = await failing(Object.assign(new Error("요청 실패: HTTP 416"), { status: 416 }))("https://f.test/a", { headers: { Range: "bytes=9-" }, signal: new AbortController().signal });
  assert.deepEqual([gone.status, gone.body], [416, null]);
  await assert.rejects(failing(new SafeUrl.SsrfError("내부 주소"))("https://f.test/a", { headers: { Range: "bytes=1-" }, signal: new AbortController().signal }), (e: unknown) => (e as { permanent?: boolean }).permanent === true);
  await assert.rejects(failing(new Error("ECONNRESET"))("https://f.test/a", { headers: { Range: "bytes=1-" }, signal: new AbortController().signal }), (e: unknown) => (e as { permanent?: boolean }).permanent !== true);
});

test("Range 어댑터: 신호를 가드에 넘기고, 응답을 기다리는 사이 취소됐으면 본문을 곧바로 강제로 닫는다", async () => {
  const controller = new AbortController();
  const body = Object.assign(PassThrough.from([Buffer.from("xyz")]), { headers: {}, status: 206 });
  body.on("error", () => {});
  let passed: AbortSignal | undefined;
  const fetch = guardedRanges(async (_url, _deps, opts) => {
    passed = opts.signal;
    controller.abort(new Error("멈춤"));
    return body;
  });
  await fetch("https://f.test/a", { headers: { Range: "bytes=0-" }, signal: controller.signal });
  assert.deepEqual([passed === controller.signal, body.destroyed], [true, true]);
});

// ── HLS의 큰 세그먼트(모으지 않고 스트리밍한다, 크기를 알면 끊긴 위치부터 잇는다) ──

const MB = 1024 * 1024;
const bytesOf = (size: number) => Buffer.from(Array.from({ length: size }, (_, i) => (i * 13 + (i >> 9)) & 0xff));
// MPEG-TS 처럼 188바이트마다 동기 바이트(0x47)가 있는 평문. AES 세그먼트는 키를 확인하려고 앞부분이 HLS 컨테이너인지 본다
const tsOf = (size: number) => {
  const bytes = bytesOf(size);
  for (let i = 0; i < size; i += 188) bytes[i] = 0x47;
  return bytes;
};
const KEY = Buffer.alloc(16, 3);
const IV = Buffer.alloc(16, 9);
const seal = (plain: Buffer, key = KEY) => {
  const cipher = crypto.createCipheriv("aes-128-cbc", key, IV);
  return Buffer.concat([cipher.update(plain), cipher.final()]);
};
const HLS_URL = "https://h.test/index.m3u8";
const SEGMENT = "https://h.test/big.ts";
const playlistOf = (encrypted: boolean) => `#EXTM3U\n#EXT-X-TARGETDURATION:4\n${encrypted ? `#EXT-X-KEY:METHOD=AES-128,URI="k",IV=0x${IV.toString("hex")}\n` : ""}#EXTINF:4,\nbig.ts\n#EXT-X-ENDLIST\n`;

// 큰 세그먼트를 주는 가짜 서버. dieAt: 첫 응답이 그 바이트에서 끊긴다. probe: 끝 32바이트 요청을 받을지(ignore면 200으로 전체를 준다)
function segmentServer(body: Buffer, { length = true, dieAt, probe = "honor", key = KEY, chunk = 65_536 }: { length?: boolean; dieAt?: number; probe?: "honor" | "ignore"; key?: Buffer; chunk?: number } = {}) {
  const asked: Array<{ url: string; from?: number; to?: number; ifRange?: string; bodyIdleMs?: number }> = [];
  const streams: Readable[] = [];
  const respond = (data: Buffer, headers: Record<string, unknown>, status: number, die?: number) => {
    let off = 0;
    const stream = new Readable({
      read() {
        if (die !== undefined && off >= die) return void this.destroy(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
        if (off >= data.length) return void this.push(null);
        const piece = data.subarray(off, Math.min(off + chunk, die ?? Infinity));
        off += piece.length;
        this.push(piece);
      },
    });
    streams.push(stream);
    return Object.assign(stream, { headers, status, url: SEGMENT }) as AudioStream;
  };
  const net = {
    getStream: async (url: string, _deps?: undefined, opts: OpenOptions = {}) => {
      asked.push({ url, from: opts.from, to: opts.to, ifRange: opts.ifRange, bodyIdleMs: opts.bodyIdleMs });
      if (url === "https://h.test/k") return respond(key, {}, 200);
      if (opts.from === undefined) return respond(body, length ? { "content-length": String(body.length), etag: '"v1"' } : {}, 200, dieAt);
      if (probe === "ignore" && opts.from === body.length - 32) return respond(body, { "content-length": String(body.length) }, 200);
      const to = opts.to ?? body.length - 1;
      return respond(body.subarray(opts.from, to + 1), { "content-range": `bytes ${opts.from}-${to}/${body.length}`, etag: '"v1"' }, 206);
    },
  };
  return {
    asked,
    streams,
    open: (encrypted: boolean) => async (): Promise<DirectOpen> => ({ kind: "hls", hls: await openHls(playlistOf(encrypted), HLS_URL, { net, bodyIdleMs: 6000 }) }),
  };
}

async function readInput(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

test("HLS 큰 세그먼트: 첫 응답이 중간에 끊기면 그 위치부터 Range(If-Range)로 이어 원본과 같은 바이트를 받는다", async () => {
  const body = bytesOf(3 * MB);
  const server = segmentServer(body, { dieAt: 1_500_000 });
  const input = await openDirectInput(HLS_URL, { bodyIdleMs: 6000 }, server.open(false));
  assert.deepEqual(await readInput(input), body);
  const resumed = server.asked.filter((one) => one.from !== undefined);
  // 끊길 때 받는 쪽에 닿지 않은 청크는 버려지므로(운영체제마다 다르다) 받은 위치부터 잇는다. 처음부터 다시 받지 않는다
  assert.ok(resumed[0].from! > 1_000_000 && resumed[0].from! <= 1_500_000, `받은 위치부터(${resumed[0].from})`);
  assert.ok(resumed.every((one) => one.ifRange === '"v1"'));
  assert.equal(server.asked[0].bodyIdleMs, 6000, "첫 응답에 무응답 한도");
});

test("HLS 큰 AES 세그먼트: 블록 중간에서 끊겼다 이어도 통째로 복호화한 것과 같고, 스트리밍하기 전에 끝 32바이트로 키를 확인한다", async () => {
  const plain = tsOf(3 * MB + 5);
  const sealed = seal(plain);
  const server = segmentServer(sealed, { dieAt: 1_000_003 });
  const input = await openDirectInput(HLS_URL, { bodyIdleMs: 6000 }, server.open(true));
  assert.deepEqual(await readInput(input), plain);
  assert.ok(
    server.asked.some((one) => one.from === sealed.length - 32 && one.to === sealed.length - 1),
    "끝 32바이트 확인",
  );
});

test("HLS 큰 AES 세그먼트: 끝 패딩이 깨졌으면(확인을 건너뛴 서버) 마지막 블록만 버리고 warn을 남긴 채 깨끗이 끝난다", async () => {
  const plain = tsOf(2 * MB + 5);
  const sealed = seal(plain);
  sealed[sealed.length - 1] ^= 0xff;
  const server = segmentServer(sealed, { probe: "ignore" });
  const from = sink.buffer.length;
  const input = await openDirectInput(HLS_URL, { bodyIdleMs: 6000 }, server.open(true));
  const out = await readInput(input);
  assert.deepEqual(out, plain.subarray(0, plain.length - 5), "마지막 블록(평문 5바이트)만 버렸다");
  assert.ok(sink.buffer.slice(from).some((e) => e.level === "warn" && e.text.includes("HLS 세그먼트의 끝")));
  const probe = server.streams.find((_, i) => server.asked[i]?.from === sealed.length - 32);
  assert.equal(probe?.destroyed, true, "구간 요청을 무시한 확인 응답도 닫았다");
});

test("HLS 큰 AES 세그먼트: 틀린 키나 블록 단위가 아닌 크기는 스트리밍하기 전에 재시도하지 않는 실패로 끝난다", async () => {
  const sealed = seal(tsOf(2 * MB));
  const wrong = segmentServer(sealed, { key: Buffer.alloc(16, 4) });
  const input = await openDirectInput(HLS_URL, { bodyIdleMs: 6000 }, wrong.open(true));
  let got = 0;
  input.on("data", (chunk: Buffer) => (got += chunk.length));
  await assert.rejects(new Promise((resolve, reject) => input.on("end", resolve).on("error", reject)), (e: Error & { permanent?: boolean }) => e.permanent === true && /키가 맞지 않/.test(e.message));
  assert.equal(got, 0, "아무것도 흘리지 않았다");

  const odd = segmentServer(Buffer.concat([sealed, Buffer.alloc(3)]));
  const oddInput = await openDirectInput(HLS_URL, { bodyIdleMs: 6000 }, odd.open(true));
  await assert.rejects(readInput(oddInput), (e: Error & { permanent?: boolean }) => e.permanent === true && /16/.test(e.message));
});

test("HLS 큰 AES 세그먼트: 암호문이 블록 중간에서 끝나면 그 조각만 버리고 앞의 온전한 블록은 흘린다", async () => {
  const plain = tsOf(2 * MB);
  const sealed = seal(plain);
  const server = segmentServer(sealed.subarray(0, sealed.length - 1), { length: false });
  const from = sink.buffer.length;
  const out = await readInput(await openDirectInput(HLS_URL, { bodyIdleMs: 6000 }, server.open(true)));
  assert.deepEqual(out, plain, "패딩 블록 앞까지 다 흘렸다(평문 2MB는 16의 배수라 마지막 블록은 패딩뿐)");
  assert.ok(sink.buffer.slice(from).some((e) => e.level === "warn" && e.text.includes("15바이트")));
});

test("HLS 큰 세그먼트: 크기를 모르면 모은 앞부분과 나머지를 이어 흘린다(AES면 앞부분이 블록 중간에서 끝나도 이어서 복호화한다)", async () => {
  const body = bytesOf(3 * MB + 77);
  const plainServer = segmentServer(body, { length: false });
  assert.deepEqual(await readInput(await openDirectInput(HLS_URL, { bodyIdleMs: 6000 }, plainServer.open(false))), body);

  const plain = tsOf(3 * MB + 9);
  const aesServer = segmentServer(seal(plain), { length: false, chunk: 100_003 });
  assert.deepEqual(await readInput(await openDirectInput(HLS_URL, { bodyIdleMs: 6000 }, aesServer.open(true))), plain);
});

test("HLS 큰 세그먼트: 크기를 모르는 세그먼트도 흘리다 끊기면 받은 위치부터 이어 받아 원본과 같은 바이트를 받는다(AES면 블록 중간이어도). 두 경우 모두 이어 받았다고 알린다", async () => {
  const body = bytesOf(3 * MB + 77);
  const server = segmentServer(body, { length: false, dieAt: 2_000_001 });
  const resumed: unknown[] = [];
  const input = await openDirectInput(HLS_URL, { bodyIdleMs: 6000, onResumed: (info) => void resumed.push(info) }, server.open(false));
  assert.deepEqual(await readInput(input), body);
  const again = server.asked.filter((one) => one.from !== undefined);
  assert.equal(again.length, 1);
  assert.ok(again[0].from! > 1_000_000 && again[0].from! <= 2_000_001, `받은 위치부터(${again[0].from})`);
  assert.equal(again[0].bodyIdleMs, 6000, "이어 받는 응답에도 무응답 한도");
  assert.equal(resumed.length, 1);

  const plain = tsOf(3 * MB + 9);
  const aes = segmentServer(seal(plain), { length: false, dieAt: 1_700_003, chunk: 100_003 });
  assert.deepEqual(await readInput(await openDirectInput(HLS_URL, { bodyIdleMs: 6000 }, aes.open(true))), plain);

  const sized = segmentServer(bytesOf(3 * MB), { dieAt: 1_500_000 });
  const told: unknown[] = [];
  await readInput(await openDirectInput(HLS_URL, { bodyIdleMs: 6000, onResumed: (info) => void told.push(info) }, sized.open(false)));
  assert.equal(told.length, 1, "크기를 아는 세그먼트(청크 스트림)도 알린다");
});

// test/fixtures/hls 의 세그먼트(만든 방법은 test/rules/hls-segment-start.test.ts)를 이어 붙여 큰 세그먼트를 만든다
const fixture = (name: string) => fs.readFileSync(new URL(`../fixtures/hls/${name}`, import.meta.url));
const repeated = (one: Buffer, size: number) => Buffer.concat(Array.from({ length: Math.ceil(size / one.length) }, () => one));

test("HLS 큰 AES 세그먼트: 맞는 키면 TS, fMP4, Packed Audio 를 그대로 흘리고, 틀린 키면 끝을 확인할 수 없어도(크기를 모름) 아무것도 흘리기 전에 재시도하지 않는 실패로 끝난다", async () => {
  for (const name of ["segment.mpegts", "segment.m4s", "segment.aac"]) {
    const plain = repeated(fixture(name), 2 * MB);
    const right = segmentServer(seal(plain), { length: false });
    assert.deepEqual(await readInput(await openDirectInput(HLS_URL, { bodyIdleMs: 6000 }, right.open(true))), plain, name);

    const wrong = segmentServer(seal(plain, Buffer.alloc(16, 4)), { length: false });
    const input = await openDirectInput(HLS_URL, { bodyIdleMs: 6000 }, wrong.open(true));
    let got = 0;
    input.on("data", (chunk: Buffer) => (got += chunk.length));
    await assert.rejects(new Promise((resolve, reject) => input.on("end", resolve).on("error", reject)), (e: Error & { permanent?: boolean }) => e.permanent === true && /키가 맞지 않/.test(e.message), name);
    assert.equal(got, 0, `${name}: 아무것도 흘리지 않았다`);
  }
});

// 복호화 단계에 암호문을 size 바이트씩 넣고 나온 것과 오류를 모은다
async function decryptIn(sealed: Buffer, size: number, key: Buffer = KEY) {
  const stage = decrypting(key, IV);
  const out: Buffer[] = [];
  const pushed: number[] = [];
  stage.on("data", (chunk: Buffer) => out.push(chunk));
  const ended = new Promise<Error | null>((resolve) => stage.on("end", () => resolve(null)).on("error", resolve));
  for (let at = 0; at < sealed.length; at += size) {
    stage.write(sealed.subarray(at, at + size));
    pushed.push(Buffer.concat(out).length);
  }
  stage.end();
  return { error: await ended, out: Buffer.concat(out), pushed };
}

test("AES 복호화: 판정할 만큼(TS 377바이트) 모이기 전에는 아무것도 내보내지 않는다", async () => {
  const plain = fixture("segment.mpegts");
  const { error, out, pushed } = await decryptIn(seal(plain), 1);
  assert.equal(error, null);
  assert.deepEqual(out, plain);
  assert.equal(pushed.findIndex((n) => n > 0) >= 392, true, `처음 내보낸 때: 암호문 ${pushed.findIndex((n) => n > 0) + 1}바이트`);
});

test("AES 복호화: 판정할 만큼 모이기 전에 끝난 짧은 세그먼트는 블록 단위, 끝 패딩, 컨테이너가 다 맞아야 내보낸다", async () => {
  const one = fixture("segment.mpegts").subarray(0, 188);
  const ok = await decryptIn(seal(one), 64);
  assert.equal(ok.error, null);
  assert.deepEqual(ok.out, one, "패킷 하나짜리 TS");

  const twoPackets = Buffer.from(fixture("segment.mpegts").subarray(0, 376));
  twoPackets[188] = 0;
  const badPad = Buffer.from(seal(one));
  badPad[badPad.length - 1] ^= 0x01;
  const cases: Array<[string, Buffer, Buffer?]> = [
    ["끝 패딩이 깨짐", badPad],
    ["블록 단위가 아님(온전한 암호문 뒤에 5바이트)", Buffer.concat([seal(one), Buffer.alloc(5)])],
    ["틀린 키", seal(one), Buffer.alloc(16, 4)],
    ["컨테이너가 아님(둘째 패킷의 동기 바이트가 틀린 377바이트 미만 TS)", seal(twoPackets)],
  ];
  for (const [name, sealed, key] of cases) {
    const got = await decryptIn(sealed, 64, key);
    assert.ok((got.error as (Error & { permanent?: boolean }) | null)?.permanent === true && /키가 맞지 않/.test(got.error!.message), name);
    assert.equal(got.out.length, 0, `${name}: 아무것도 내보내지 않는다`);
  }
});
