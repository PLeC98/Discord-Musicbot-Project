"use strict";

// src/chunkedStream.js — Range 청크 수신 (완전성 / 백프레셔 / 중단 / 이상 응답 폴백)
//
// 네트워크는 fetch를 주입해 흉내낸다. 실 소켓 없이 전부 검증한다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Writable } = require("stream");
const { createChunkedStream, openChunkedStream, contentLengthFromUrl } = require("../src/chunkedStream");

// 결정적인 본문 — 어긋나면 바로 드러나도록 위치마다 다른 값
function makeBody(size) {
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i++) b[i] = (i * 7 + (i >> 8)) & 0xff;
  return b;
}

// Range를 이해하는 가짜 서버. sliceBytes로 응답을 몇 조각에 나눠 보낼지 정한다.
function fakeFetch(body, { sliceBytes = 4096, status = 206, onRequest } = {}) {
  return async (url, opts) => {
    const range = /bytes=(\d+)-(\d+)/.exec(opts?.headers?.Range || "");
    const start = range ? Number(range[1]) : 0;
    const end = range ? Number(range[2]) : body.length - 1;
    onRequest?.({ start, end, signal: opts?.signal });

    const payload = status === 200 ? body : body.subarray(start, end + 1);
    let off = 0;
    return {
      status,
      headers: { get: (k) => (k.toLowerCase() === "content-range" && status === 206 ? `bytes ${start}-${end}/${body.length}` : null) },
      body: {
        getReader: () => ({
          read: async () => {
            if (opts?.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
            if (off >= payload.length) return { done: true, value: undefined };
            const v = payload.subarray(off, off + sliceBytes);
            off += v.length;
            return { done: false, value: new Uint8Array(v) };
          },
        }),
      },
    };
  };
}

const collect = (stream) =>
  new Promise((resolve, reject) => {
    const cs = [];
    stream.on("data", (c) => cs.push(c));
    stream.on("end", () => resolve(Buffer.concat(cs)));
    stream.on("error", reject);
  });

// ── 완전성 ───────────────────────────────────────────────────

test("여러 청크로 나눠 받아도 원본과 바이트 단위로 같다", async () => {
  const body = makeBody(50_000);
  const s = createChunkedStream({ url: "https://x/y", totalBytes: body.length, chunkSize: 8192, fetchImpl: fakeFetch(body) });
  assert.deepEqual(await collect(s), body);
  assert.equal(s.stats().requests, Math.ceil(50_000 / 8192));
});

test("청크 경계: 전체 길이가 청크 크기의 배수여도 정확히 끝난다", async () => {
  const body = makeBody(32_768); // 8192 × 4
  const s = createChunkedStream({ url: "https://x/y", totalBytes: body.length, chunkSize: 8192, fetchImpl: fakeFetch(body) });
  assert.deepEqual(await collect(s), body);
  assert.equal(s.stats().requests, 4, "마지막에 빈 요청을 더 보내지 않는다");
});

test("청크가 전체보다 크면 요청 한 번으로 끝난다", async () => {
  const body = makeBody(5_000);
  const s = createChunkedStream({ url: "https://x/y", totalBytes: body.length, chunkSize: 1 << 20, fetchImpl: fakeFetch(body) });
  assert.deepEqual(await collect(s), body);
  assert.equal(s.stats().requests, 1);
});

test("요청 구간이 이어진다 — 겹치거나 빠지는 바이트가 없다", async () => {
  const body = makeBody(30_000);
  const seen = [];
  const s = createChunkedStream({ url: "https://x/y", totalBytes: body.length, chunkSize: 10_000, fetchImpl: fakeFetch(body, { onRequest: (r) => seen.push(r) }) });
  await collect(s);
  assert.deepEqual(
    seen.map((r) => [r.start, r.end]),
    [
      [0, 9999],
      [10000, 19999],
      [20000, 29999],
    ],
  );
});

// ── 백프레셔 ─────────────────────────────────────────────────
// 이 경로가 깨지면 곡 중간에 영구 정지한다. 프로토타입에서도 소비자가 충분히 느리지 않아
// 처음엔 이 경로를 밟지 못했다 — 반드시 느린 소비자로 강제해서 확인할 것.

test("느린 소비자에게도 한 바이트도 빠뜨리지 않는다 (중단→재개)", async () => {
  const body = makeBody(120_000);
  const s = createChunkedStream({ url: "https://x/y", totalBytes: body.length, chunkSize: 16_384, fetchImpl: fakeFetch(body, { sliceBytes: 2048 }) });

  const got = [];
  const slow = new Writable({
    highWaterMark: 4096,
    write(c, _e, cb) {
      got.push(c);
      setTimeout(cb, 2); // 공급보다 느리게 — push()가 false를 반환하도록
    },
  });

  await new Promise((res, rej) => {
    s.pipe(slow).on("finish", res).on("error", rej);
    s.on("error", rej);
  });

  const received = Buffer.concat(got);
  assert.equal(received.length, body.length, "바이트 수");
  assert.deepEqual(received, body, "내용");
});

// ── 중단 ─────────────────────────────────────────────────────

test("destroy()는 진행 중인 요청을 abort하고 더 밀어내지 않는다", async () => {
  const body = makeBody(200_000);
  let signal = null;
  const s = createChunkedStream({ url: "https://x/y", totalBytes: body.length, chunkSize: 16_384, fetchImpl: fakeFetch(body, { sliceBytes: 512, onRequest: (r) => (signal = r.signal) }) });

  let pushed = 0;
  s.on("data", (c) => (pushed += c.length));
  await new Promise((r) => s.once("data", r));

  s.destroy();
  assert.equal(signal.aborted, true, "진행 중이던 요청이 abort됐다");

  const atDestroy = pushed;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(pushed, atDestroy, "destroy 이후로는 밀어내지 않는다");
});

test("중단은 오류가 아니다 — AbortError를 스트림 오류로 올리지 않는다", async () => {
  const body = makeBody(100_000);
  const s = createChunkedStream({ url: "https://x/y", totalBytes: body.length, chunkSize: 8192, fetchImpl: fakeFetch(body, { sliceBytes: 512 }) });
  let errored = null;
  s.on("error", (e) => (errored = e));
  s.on("data", () => {});
  await new Promise((r) => s.once("data", r));
  s.destroy();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(errored, null);
});

// ── 이상 응답 ────────────────────────────────────────────────

test("Range를 무시한 200 응답도 첫 요청이면 전체 본문으로 받아낸다", async () => {
  const body = makeBody(40_000);
  const s = createChunkedStream({ url: "https://x/y", totalBytes: body.length, chunkSize: 8192, fetchImpl: fakeFetch(body, { status: 200 }) });
  assert.deepEqual(await collect(s), body, "페이싱 우회는 못 해도 재생은 정상이어야 한다");
  assert.equal(s.stats().requests, 1);
});

test("첫 요청이 아닌데 200이면 구간이 어긋나므로 오류", async () => {
  const body = makeBody(40_000);
  let n = 0;
  const impl = fakeFetch(body);
  const s = createChunkedStream({
    url: "https://x/y",
    totalBytes: body.length,
    chunkSize: 8192,
    fetchImpl: async (u, o) => (++n === 1 ? impl(u, o) : fakeFetch(body, { status: 200 })(u, o)),
  });
  await assert.rejects(collect(s), /HTTP 200/);
});

test("Content-Range의 시작 위치가 어긋나면 오류 (프록시가 엉뚱한 구간을 줄 때)", async () => {
  const body = makeBody(40_000);
  const s = createChunkedStream({
    url: "https://x/y",
    totalBytes: body.length,
    chunkSize: 8192,
    fetchImpl: async () => ({
      status: 206,
      headers: { get: () => "bytes 999-2000/40000" },
      body: { getReader: () => ({ read: async () => ({ done: true }) }) },
    }),
  });
  await assert.rejects(collect(s), /어긋납니다/);
});

test("실패 상태 코드는 스트림 오류로 올라간다 (기존 캐시 폴백이 받도록)", async () => {
  const s = createChunkedStream({
    url: "https://x/y",
    totalBytes: 1000,
    chunkSize: 500,
    fetchImpl: async () => ({ status: 403, headers: { get: () => null }, body: null }),
  });
  await assert.rejects(collect(s), /HTTP 403/);
});

// ── 첫 요청 선행(openChunkedStream) ──────────────────────────
// 단일 GET 시절 `await fetch(...)`가 서 있던 자리와 같은 의미여야 한다.
// 그러지 않으면 만료된 URL 같은 실패가 호출부의 캐시 폴백을 지나쳐 재생 시작 뒤에야 드러난다.

test("openChunkedStream은 첫 요청이 실패하면 그 자리에서 던진다", async () => {
  await assert.rejects(
    openChunkedStream({
      url: "https://x/y",
      totalBytes: 1000,
      chunkSize: 500,
      fetchImpl: async () => ({ status: 403, headers: { get: () => null }, body: null }),
    }),
    /HTTP 403/,
  );
});

test("openChunkedStream은 성공하면 내용이 온전한 스트림을 돌려준다", async () => {
  const body = makeBody(20_000);
  const s = await openChunkedStream({ url: "https://x/y", totalBytes: body.length, chunkSize: 8192, fetchImpl: fakeFetch(body) });
  assert.deepEqual(await collect(s), body);
});

test("선행 요청 실패는 스트림을 정리한다 (죽은 요청을 남기지 않음)", async () => {
  let signal = null;
  await assert.rejects(
    openChunkedStream({
      url: "https://x/y",
      totalBytes: 1000,
      chunkSize: 500,
      fetchImpl: async (_u, o) => {
        signal = o.signal;
        throw new Error("network down");
      },
    }),
    /network down/,
  );
  assert.equal(signal.aborted, true);
});

// ── 인자 검증 ────────────────────────────────────────────────

test("totalBytes·chunkSize가 올바르지 않으면 만들 때 거부한다", () => {
  const base = { url: "https://x/y", fetchImpl: async () => {} };
  for (const bad of [0, -1, NaN, null, undefined]) {
    assert.throws(() => createChunkedStream({ ...base, totalBytes: bad, chunkSize: 1024 }), /totalBytes/);
    assert.throws(() => createChunkedStream({ ...base, totalBytes: 1024, chunkSize: bad }), /chunkSize/);
  }
});

// ── clen 추출 ────────────────────────────────────────────────

test("clen: URL에서 전체 길이를 읽는다 (HEAD 요청 불필요)", () => {
  assert.equal(contentLengthFromUrl("https://r1.googlevideo.com/videoplayback?clen=3626380&itag=251"), 3626380);
});

test("clen: 없거나 쓸 수 없으면 null — 호출부가 단일 GET으로 돌아간다", () => {
  assert.equal(contentLengthFromUrl("https://r1.googlevideo.com/videoplayback?itag=251"), null, "라이브 스트림에는 clen이 없다");
  assert.equal(contentLengthFromUrl("https://x/y?clen=0"), null);
  assert.equal(contentLengthFromUrl("https://x/y?clen=abc"), null);
  assert.equal(contentLengthFromUrl("주소가 아님"), null);
  assert.equal(contentLengthFromUrl(""), null);
});
