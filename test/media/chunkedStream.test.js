// src/media/chunkedStream.ts — Range 청크 수신 (완전성 / 수신·공급 분리 / 이어받기 / 중단 / 이상 응답)
//
// 네트워크는 fetch를 주입해 흉내낸다. 실 소켓 없이 전부 검증한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "stream";
import { createChunkedStream, openChunkedStream, contentLengthFromUrl, describeStreamError } from "../../src/media/chunkedStream.ts";

const URL_ = "https://x/y";
const FAST = { retryDelaysMs: [0, 0, 0] };

// 결정적인 본문 — 어긋나면 바로 드러나도록 위치마다 다른 값
function makeBody(size) {
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i++) b[i] = (i * 7 + (i >> 8)) & 0xff;
  return b;
}

// Range를 이해하는 가짜 서버.
//  sliceBytes   응답을 몇 바이트씩 나눠 줄지
//  readDelayMs  조각 사이 지연 — 요청이 오래 진행 중이게 할 때
//  plan(n, start) 요청마다 행동: { status, throws, dieAfter: 이 응답에서 몇 바이트 뒤 끊김, hangAfter: 몇 바이트 뒤 멈춤 }
function fakeFetch(body, { sliceBytes = 4096, status = 206, onRequest, readDelayMs = 0, plan } = {}) {
  let n = 0;
  return async (url, opts) => {
    const range = /bytes=(\d+)-(\d+)/.exec(opts?.headers?.Range || "");
    const start = range ? Number(range[1]) : 0;
    const end = range ? Number(range[2]) : body.length - 1;
    const signal = opts?.signal;
    onRequest?.({ start, end, signal });

    const act = plan?.(n++, start) || {};
    if (act.throws) throw act.throws;
    const st = act.status ?? status;
    const payload = st === 200 ? body : body.subarray(start, end + 1);
    const stopAt = act.dieAfter ?? act.hangAfter;
    const aborted = () => signal?.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" });
    let off = 0;
    return {
      status: st,
      headers: { get: (k) => (k.toLowerCase() === "content-range" && st === 206 ? `bytes ${start}-${end}/${body.length}` : null) },
      body:
        st >= 400
          ? null
          : {
              getReader: () => ({
                read: async () => {
                  if (readDelayMs) await new Promise((r) => setTimeout(r, readDelayMs));
                  if (signal?.aborted) throw aborted();
                  if (stopAt != null && off >= stopAt) {
                    if (act.hangAfter != null) await new Promise((_, rej) => signal.addEventListener("abort", () => rej(aborted()), { once: true }));
                    throw Object.assign(new TypeError("terminated"), { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
                  }
                  if (off >= payload.length) return { done: true, value: undefined };
                  const v = payload.subarray(off, off + Math.min(sliceBytes, stopAt != null ? stopAt - off : sliceBytes));
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
  const s = createChunkedStream({ url: URL_, totalBytes: body.length, chunkSize: 8192, fetchImpl: fakeFetch(body) });
  assert.deepEqual(await collect(s), body);
  assert.equal(s.stats().requests, Math.ceil(50_000 / 8192));
});

test("청크 경계: 전체 길이가 청크 크기의 배수여도 정확히 끝난다", async () => {
  const body = makeBody(32_768); // 8192 × 4
  const s = createChunkedStream({ url: URL_, totalBytes: body.length, chunkSize: 8192, fetchImpl: fakeFetch(body) });
  assert.deepEqual(await collect(s), body);
  assert.equal(s.stats().requests, 4, "마지막에 빈 요청을 더 보내지 않는다");
});

test("청크가 전체보다 크면 요청 한 번으로 끝난다", async () => {
  const body = makeBody(5_000);
  const s = createChunkedStream({ url: URL_, totalBytes: body.length, chunkSize: 1 << 20, fetchImpl: fakeFetch(body) });
  assert.deepEqual(await collect(s), body);
  assert.equal(s.stats().requests, 1);
});

test("요청 구간이 이어진다 — 겹치거나 빠지는 바이트가 없다", async () => {
  const body = makeBody(30_000);
  const seen = [];
  const s = createChunkedStream({ url: URL_, totalBytes: body.length, chunkSize: 10_000, fetchImpl: fakeFetch(body, { onRequest: (r) => seen.push(r) }) });
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

// ── 수신과 공급 분리 ─────────────────────────────────────────
// 백프레셔 속도로 본문을 읽으면 서버가 느린 수신자로 보고 연결을 끊는다. 받는 건 최대 속도로.

test("소비자가 멈춰 있어도 현재 청크는 끝까지 받아 둔다", async () => {
  const body = makeBody(100_000);
  const s = await openChunkedStream({ url: URL_, totalBytes: body.length, chunkSize: 32_000, fetchImpl: fakeFetch(body, { sliceBytes: 1024 }) });
  await new Promise((r) => setTimeout(r, 30));
  const st = s.stats();
  assert.equal(st.received, 32_000, "첫 청크 전부");
  assert.equal(st.requests, 1, "아무도 안 읽으니 다음 청크는 받지 않는다");
  s.destroy();
});

test("받아 두는 양은 청크 하나와 여유분을 넘지 않는다", async () => {
  const body = makeBody(200_000);
  const s = createChunkedStream({ url: URL_, totalBytes: body.length, chunkSize: 16_000, fetchImpl: fakeFetch(body, { sliceBytes: 1000 }) });
  let max = 0;
  const slow = new Writable({
    highWaterMark: 1024,
    write(c, _e, cb) {
      max = Math.max(max, s.stats().queued);
      setTimeout(cb, 1);
    },
  });
  await new Promise((res, rej) => {
    s.pipe(slow).on("finish", res).on("error", rej);
    s.on("error", rej);
  });
  assert.ok(max <= 16_000 + 4_000, `최대 ${max}B`);
});

test("느린 소비자에게도 한 바이트도 빠뜨리지 않는다 (중단→재개)", async () => {
  // 이 경로가 깨지면 곡 중간에 영구 정지한다. 소비자가 충분히 느리지 않으면 이 경로를 밟지 못한다.
  const body = makeBody(120_000);
  const s = createChunkedStream({ url: URL_, totalBytes: body.length, chunkSize: 16_384, fetchImpl: fakeFetch(body, { sliceBytes: 2048 }) });

  const got = [];
  const slow = new Writable({
    highWaterMark: 4096,
    write(c, _e, cb) {
      got.push(c);
      setTimeout(cb, 2);
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

// ── 이어받기 ─────────────────────────────────────────────────

test("중간에 끊기면 받은 위치부터 이어받는다 — 결과는 원본과 같다", async () => {
  const body = makeBody(50_000);
  const seen = [];
  const resumed = [];
  const s = createChunkedStream({
    url: URL_,
    totalBytes: body.length,
    chunkSize: 20_000,
    ...FAST,
    fetchImpl: fakeFetch(body, { sliceBytes: 1000, onRequest: (r) => seen.push(r.start), plan: (n) => (n === 1 ? { dieAfter: 7_000 } : null) }),
    onResumed: (info) => resumed.push(info),
  });
  assert.deepEqual(await collect(s), body);
  assert.deepEqual(seen, [0, 20_000, 27_000, 40_000], "끊긴 27000부터 다시 요청");
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].attempts, 1);
});

test("넘겨받았다고 하면 이어받지 않고 받아 둔 데까지 내보낸 뒤 정상 종료한다", async () => {
  const body = makeBody(50_000);
  const seen = [];
  const errors = [];
  const s = createChunkedStream({
    url: URL_,
    totalBytes: body.length,
    chunkSize: 20_000,
    ...FAST,
    fetchImpl: fakeFetch(body, { sliceBytes: 1000, onRequest: (r) => seen.push(r.start), plan: (n) => (n === 1 ? { dieAfter: 7_000 } : null) }),
    onInterrupt: (err) => {
      errors.push(err);
      return true;
    },
  });
  assert.deepEqual(await collect(s), body.subarray(0, 27_000));
  assert.deepEqual(seen, [0, 20_000], "다시 요청하지 않는다");
  assert.match(describeStreamError(errors[0]), /ECONNRESET/);
});

test("아무것도 못 받고 연속으로 실패하면 정해진 횟수 뒤 오류", async () => {
  const body = makeBody(50_000);
  let requests = 0;
  const s = createChunkedStream({
    url: URL_,
    totalBytes: body.length,
    chunkSize: 20_000,
    ...FAST,
    fetchImpl: fakeFetch(body, { onRequest: () => requests++, plan: (n) => (n >= 1 ? { dieAfter: 0 } : null) }),
  });
  await assert.rejects(collect(s), /terminated/);
  assert.equal(requests, 1 + 1 + 3, "첫 청크 + 끊긴 요청 + 재시도 3회");
});

test("조금씩이라도 받으면 실패 횟수가 초기화된다 — 여러 번 끊겨도 끝까지 받는다", async () => {
  const body = makeBody(30_000);
  const s = createChunkedStream({
    url: URL_,
    totalBytes: body.length,
    chunkSize: 30_000,
    ...FAST,
    fetchImpl: fakeFetch(body, { sliceBytes: 1000, plan: (n) => (n < 6 ? { dieAfter: 2_000 } : null) }),
  });
  assert.deepEqual(await collect(s), body);
});

test("4xx는 다시 요청하지 않는다 (만료·차단은 몇 번을 해도 같다)", async () => {
  const body = makeBody(50_000);
  let requests = 0;
  const s = createChunkedStream({
    url: URL_,
    totalBytes: body.length,
    chunkSize: 20_000,
    ...FAST,
    fetchImpl: fakeFetch(body, { onRequest: () => requests++, plan: (n) => (n === 1 ? { status: 403 } : null) }),
  });
  await assert.rejects(collect(s), /HTTP 403/);
  assert.equal(requests, 2);
});

test("받는 중에 데이터가 멈추면 정체로 보고 다시 요청한다", async () => {
  const body = makeBody(30_000);
  const s = createChunkedStream({
    url: URL_,
    totalBytes: body.length,
    chunkSize: 30_000,
    ...FAST,
    stallMs: 30,
    fetchImpl: fakeFetch(body, { sliceBytes: 1000, plan: (n) => (n === 0 ? { hangAfter: 5_000 } : null) }),
  });
  assert.deepEqual(await collect(s), body);
});

test("첫 요청이 네트워크 오류로 실패해도 다시 시도해 연다 — 재생 전이라 넘겨받기는 묻지 않는다", async () => {
  const body = makeBody(20_000);
  let asked = 0;
  const s = await openChunkedStream({
    url: URL_,
    totalBytes: body.length,
    chunkSize: 8192,
    ...FAST,
    fetchImpl: fakeFetch(body, { plan: (n) => (n === 0 ? { throws: new TypeError("fetch failed") } : null) }),
    onInterrupt: () => {
      asked++;
      return true;
    },
  });
  assert.deepEqual(await collect(s), body);
  assert.equal(asked, 0);
});

// ── 중단 ─────────────────────────────────────────────────────

test("destroy()는 진행 중인 요청을 abort하고 더 밀어내지 않는다", async () => {
  const body = makeBody(200_000);
  let signal = null;
  const s = createChunkedStream({ url: URL_, totalBytes: body.length, chunkSize: 16_384, fetchImpl: fakeFetch(body, { sliceBytes: 512, readDelayMs: 2, onRequest: (r) => (signal = r.signal) }) });

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
  const s = createChunkedStream({ url: URL_, totalBytes: body.length, chunkSize: 8192, fetchImpl: fakeFetch(body, { sliceBytes: 512 }) });
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
  const s = createChunkedStream({ url: URL_, totalBytes: body.length, chunkSize: 8192, fetchImpl: fakeFetch(body, { status: 200 }) });
  assert.deepEqual(await collect(s), body, "페이싱 우회는 못 해도 재생은 정상이어야 한다");
  assert.equal(s.stats().requests, 1);
});

test("첫 요청이 아닌데 200이면 구간이 어긋나므로 오류", async () => {
  const body = makeBody(40_000);
  const s = createChunkedStream({
    url: URL_,
    totalBytes: body.length,
    chunkSize: 8192,
    ...FAST,
    fetchImpl: fakeFetch(body, { plan: (n) => (n >= 1 ? { status: 200 } : null) }),
  });
  await assert.rejects(collect(s), /HTTP 200/);
});

test("Content-Range의 시작 위치가 어긋나면 오류 (프록시가 엉뚱한 구간을 줄 때)", async () => {
  const body = makeBody(40_000);
  const s = createChunkedStream({
    url: URL_,
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
    url: URL_,
    totalBytes: 1000,
    chunkSize: 500,
    fetchImpl: async () => ({ status: 403, headers: { get: () => null }, body: null }),
  });
  await assert.rejects(collect(s), /HTTP 403/);
});

// ── 첫 요청 선행(openChunkedStream) ──────────────────────────
// 만료된 URL 같은 실패가 호출부의 캐시 폴백을 지나쳐 재생 시작 뒤에야 드러나면 안 된다.

test("openChunkedStream은 첫 요청이 실패하면 그 자리에서 던진다", async () => {
  await assert.rejects(
    openChunkedStream({
      url: URL_,
      totalBytes: 1000,
      chunkSize: 500,
      fetchImpl: async () => ({ status: 403, headers: { get: () => null }, body: null }),
    }),
    /HTTP 403/,
  );
});

test("openChunkedStream은 성공하면 내용이 온전한 스트림을 돌려준다", async () => {
  const body = makeBody(20_000);
  const s = await openChunkedStream({ url: URL_, totalBytes: body.length, chunkSize: 8192, fetchImpl: fakeFetch(body) });
  assert.deepEqual(await collect(s), body);
});

test("선행 요청 실패는 스트림을 정리한다 (죽은 요청을 남기지 않음)", async () => {
  let signal = null;
  await assert.rejects(
    openChunkedStream({
      url: URL_,
      totalBytes: 1000,
      chunkSize: 500,
      ...FAST,
      fetchImpl: async (_u, o) => {
        signal = o.signal;
        throw new Error("network down");
      },
    }),
    /network down/,
  );
  assert.equal(signal.aborted, true);
});

// ── 오류 설명·관측 ───────────────────────────────────────────

test("오류 설명은 cause 사슬을 따라가 진짜 사유를 드러낸다", () => {
  const closed = Object.assign(new TypeError("terminated"), { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });
  assert.equal(describeStreamError(closed), "terminated ← UND_ERR_SOCKET other side closed");

  const reset = Object.assign(new TypeError("terminated"), { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
  assert.equal(describeStreamError(reset), "terminated ← read ECONNRESET", "메시지에 이미 든 코드는 반복하지 않는다");

  assert.equal(describeStreamError(new Error("Range 요청 실패: HTTP 403")), "Range 요청 실패: HTTP 403");
  assert.equal(describeStreamError(Object.assign(new Error("x"), { cause: "문자열 사유" })), "x ← 문자열 사유");
});

test("stats: 마지막 수신 이후 시간이 흐른다", async () => {
  const body = makeBody(200_000);
  const s = createChunkedStream({ url: URL_, totalBytes: body.length, chunkSize: 1 << 20, fetchImpl: fakeFetch(body, { sliceBytes: 512 }) });
  s.on("data", () => {});
  await new Promise((r) => s.once("data", r));
  s.pause();
  await new Promise((r) => setTimeout(r, 80));
  const st = s.stats();
  assert.ok(st.idleMs >= 60, `idleMs=${st.idleMs}`);
  assert.ok(st.sinceOpenMs >= st.idleMs);
  s.destroy();
});

test("stats: 현재 청크의 시작 위치와 받은 양", async () => {
  const body = makeBody(30_000);
  const s = createChunkedStream({ url: URL_, totalBytes: body.length, chunkSize: 10_000, fetchImpl: fakeFetch(body) });
  await collect(s);
  const st = s.stats();
  assert.equal(st.chunkStart, 20_000);
  assert.equal(st.chunkReceived, 10_000);
});

test("stats: URL의 expire로 만료까지 남은 초를 낸다", () => {
  const expire = Math.floor(Date.now() / 1000) + 100;
  const s = createChunkedStream({ url: `${URL_}?expire=${expire}`, totalBytes: 10, chunkSize: 10, fetchImpl: fakeFetch(makeBody(10)) });
  assert.ok(s.stats().expiresInS > 90 && s.stats().expiresInS <= 100);
  const bare = createChunkedStream({ url: URL_, totalBytes: 10, chunkSize: 10, fetchImpl: fakeFetch(makeBody(10)) });
  assert.equal(bare.stats().expiresInS, null);
});

// ── 인자 검증 ────────────────────────────────────────────────

test("totalBytes·chunkSize가 올바르지 않으면 만들 때 거부한다", () => {
  const base = { url: URL_, fetchImpl: async () => {} };
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
