// src/media/resuming-body.ts: 크기를 모르는 본문이 끊기면 받은 위치부터 이어 받는다. 206은 Content-Range 시작과 전체 크기를, 구간을 무시한 200은 검사값을 확인하고 받은 만큼 버린다.
// 바뀐 본문, 어긋난 구간, 416, 짧은 응답, 버릴 앞부분 상한 초과는 다시 받지 않는 실패. 취소하면 요청과 본문을 닫고, 읽는 쪽이 멈추면 본문을 멈춘다

import { Readable } from "node:stream";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createResumingBody, type ResumingOptions } from "../../src/media/resuming-body.ts";
import * as SafeUrl from "../../src/infra/safe-url.ts";

const URL = "https://h.test/seg.ts";
const ACCEPT = { ...SafeUrl.DIRECT_LINK, contentType: /(?:)/ };
const bytesOf = (size: number) => Buffer.from(Array.from({ length: size }, (_, i) => (i * 7 + (i >> 8)) & 0xff));

type Body = Readable & { headers: Record<string, unknown>; status: number };
// data 를 from 부터 chunk 씩 흘리고 cut(절대 위치)에서 끊는다
function bodyOf(data: Buffer, { from = 0, cut, chunk = 1000, headers = {}, status = 200 }: { from?: number; cut?: number; chunk?: number; headers?: Record<string, unknown>; status?: number } = {}): Body {
  let off = from;
  const stream = new Readable({
    read() {
      if (cut !== undefined && off >= cut) return void this.destroy(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
      if (off >= data.length) return void this.push(null);
      const piece = data.subarray(off, Math.min(off + chunk, cut ?? Infinity, data.length));
      off += piece.length;
      this.push(piece);
    },
  });
  return Object.assign(stream, { headers, status });
}

type Asked = { from: number; ifRange?: string };
// 이어 받을 때 받은 요청을 기록하고, answer 가 정한 응답을 준다(Error 면 던진다)
function setup(data: Buffer, answer: (asked: Asked, n: number) => Body | Error, { headBytes = 0, firstCut, firstHeaders = { etag: '"v1"' }, ...rest }: { headBytes?: number; firstCut?: number; firstHeaders?: Record<string, unknown> } & Partial<ResumingOptions> = {}) {
  const asked: Asked[] = [];
  const bodies: Body[] = [];
  const first = bodyOf(data, { from: headBytes, cut: firstCut, headers: firstHeaders });
  bodies.push(first);
  const resumed: Array<{ attempts: number }> = [];
  const get: ResumingOptions["get"] = async (_url, _deps, opts) => {
    const one = { from: opts.from, ...(opts.ifRange ? { ifRange: opts.ifRange } : {}) };
    asked.push(one);
    const got = answer(one, asked.length);
    if (got instanceof Error) throw got;
    bodies.push(got);
    return got;
  };
  const stream = createResumingBody({ url: URL, body: first, head: headBytes ? data.subarray(0, headBytes) : null, validator: '"v1"', get, accept: ACCEPT, idleMs: 1000, retryDelaysMs: [1, 1, 1], onResumed: (info) => void resumed.push(info), ...rest });
  return { stream, asked, bodies, resumed };
}

async function readAll(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// 받은 위치부터 206 으로 응답하고 cuts 의 다음 위치에서 다시 끊는다
const ranged =
  (data: Buffer, cuts: number[] = [], size: string = String(data.length)) =>
  ({ from }: Asked, n: number) =>
    bodyOf(data, { from, cut: cuts[n - 1], status: 206, headers: { "content-range": `bytes ${from}-${data.length - 1}/${size}`, etag: '"v1"' } });

test("청크 경계가 아닌 위치에서 여러 번 끊겨도 받은 위치부터 If-Range 로 이어 받아 원본과 같은 바이트를 흘리고, 이어 받을 때마다 알린다", async () => {
  const data = bytesOf(50_003);
  const { stream, asked, resumed } = setup(data, ranged(data, [20_001, 33_337]), { headBytes: 3_001, firstCut: 7_777 });
  assert.deepEqual(await readAll(stream), data);
  assert.deepEqual(
    asked.map((one) => one.from),
    [7_777, 20_001, 33_337],
  );
  assert.ok(asked.every((one) => one.ifRange === '"v1"'));
  assert.equal(resumed.length, 3);
  assert.equal(resumed[0].attempts, 1);
});

test("Content-Range 전체 크기가 `*` 면 시작 위치만 확인하고, 크기를 모른 채 정상으로 끝나면 이어 받지 않고 완료한다", async () => {
  const data = bytesOf(30_000);
  const { stream } = setup(data, ranged(data, [], "*"), { firstCut: 10_000, firstHeaders: {}, validator: null });
  assert.deepEqual(await readAll(stream), data);
});

test("전체 크기를 아는데(처음 응답의 Content-Length) 다 받기 전에 오류 없이 끝나면 끊김으로 보고 이어 받는다", async () => {
  const data = bytesOf(20_000);
  const short = Object.assign(Readable.from([data.subarray(0, 8_000)]), { headers: { "content-length": String(data.length), etag: '"v1"' }, status: 200 });
  const asked: number[] = [];
  const stream = createResumingBody({
    url: URL,
    body: short,
    head: null,
    validator: '"v1"',
    accept: ACCEPT,
    idleMs: 1000,
    retryDelaysMs: [1],
    get: async (_url, _deps, opts) => (asked.push(opts.from), ranged(data)({ from: opts.from }, 1)),
  });
  assert.deepEqual(await readAll(stream), data);
  assert.deepEqual(asked, [8_000]);
});

test("어긋난 구간, 다른 전체 크기, 416, 4xx 는 다시 받지 않고 실패한다", async () => {
  const data = bytesOf(20_000);
  const cases: Array<[string, (asked: Asked) => Body | Error, RegExp]> = [
    ["시작이 다름", ({ from }) => bodyOf(data, { from: from - 1, status: 206, headers: { "content-range": `bytes ${from - 1}-${data.length - 1}/${data.length}` } }), /어긋/],
    ["Content-Range 없음", ({ from }) => bodyOf(data, { from, status: 206 }), /어긋/],
    ["전체 크기가 다름", ({ from }) => bodyOf(data, { from, status: 206, headers: { "content-range": `bytes ${from}-${data.length - 1}/${data.length + 1}` } }), /전체 크기/],
    ["416", () => Object.assign(new Error("요청 실패: HTTP 416"), { status: 416 }), /416/],
  ];
  for (const [name, answer, message] of cases) {
    const { stream, asked } = setup(data, answer, { firstCut: 5_000, firstHeaders: { "content-length": String(data.length), etag: '"v1"' } });
    await assert.rejects(readAll(stream), (e: Error & { permanent?: boolean }) => e.permanent === true && message.test(e.message), name);
    assert.equal(asked.length, 1, `${name}: 재시도하지 않는다`);
  }
});

test("구간을 무시한 200: 검사값이 같으면 처음부터 받아 받은 만큼 버린다. 다르거나 검사값이 없거나 받은 위치보다 짧거나 상한을 넘으면 실패한다", async () => {
  const data = bytesOf(40_000);
  const whole =
    (headers: Record<string, unknown>, size = data.length) =>
    () =>
      bodyOf(data.subarray(0, size), { headers });

  const same = setup(data, whole({ etag: '"v1"', "content-length": String(data.length) }), { firstCut: 12_345 });
  assert.deepEqual(await readAll(same.stream), data);

  const fails: Array<[string, ReturnType<typeof setup>, RegExp]> = [
    ["검사값이 다름", setup(data, whole({ etag: '"v2"' }), { firstCut: 12_345 }), /바뀌었/],
    ["약한 ETag 는 검사값이 아니다", setup(data, whole({ etag: 'W/"v1"' }), { firstCut: 12_345 }), /바뀌었/],
    ["검사값이 없음", setup(data, whole({}), { firstCut: 12_345, validator: null, firstHeaders: {} }), /검사값이 없어/],
    ["받은 위치보다 짧음", setup(data, whole({ etag: '"v1"' }, 10_000), { firstCut: 12_345 }), /짧습니다/],
    ["전체 크기가 다름", setup(data, whole({ etag: '"v1"', "content-length": String(data.length + 1) }), { firstCut: 12_345, firstHeaders: { etag: '"v1"', "content-length": String(data.length) } }), /전체 크기/],
    ["버릴 앞부분이 상한을 넘음", setup(data, whole({ etag: '"v1"' }), { firstCut: 12_345, discardMaxBytes: 12_000 }), /상한/],
  ];
  for (const [name, { stream, asked }, message] of fails) {
    await assert.rejects(readAll(stream), (e: Error & { permanent?: boolean }) => e.permanent === true && message.test(e.message), name);
    assert.equal(asked.length, 1, name);
  }
});

test("검사값이 Last-Modified 여도 같은 본문인지 확인한다", async () => {
  const data = bytesOf(20_000);
  const modified = "Wed, 21 Oct 2026 07:28:00 GMT";
  const { stream, asked } = setup(data, () => bodyOf(data, { headers: { "last-modified": modified } }), { firstCut: 6_000, validator: modified, firstHeaders: { "last-modified": modified } });
  assert.deepEqual(await readAll(stream), data);
  assert.equal(asked[0].ifRange, modified);
});

test("재시도할 수 있는 실패는 연달아 세 번까지 재시도하고, 바이트를 받으면 실패 횟수를 초기화한다", async () => {
  const data = bytesOf(30_000);
  const reset = () => Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" });
  // 실패 2회, 이어 받다 끊김, 실패 2회, 끝까지 수신
  const script = [reset(), reset(), "cut", reset(), reset(), "ok"];
  const { stream, asked } = setup(
    data,
    ({ from }, n) => {
      const step = script[n - 1];
      if (step instanceof Error) return step;
      return ranged(data, step === "cut" ? [20_000] : [])({ from }, 1);
    },
    { firstCut: 10_000 },
  );
  assert.deepEqual(await readAll(stream), data);
  assert.equal(asked.length, 6);

  const dead = setup(data, () => reset(), { firstCut: 10_000 });
  await assert.rejects(readAll(dead.stream), /ECONNRESET/);
  assert.equal(dead.asked.length, 3, "네 번째는 없다");
});

test("취소하면 기다리던 요청을 끊고 흘리던 본문을 닫는다. 그 뒤로 다시 받지 않는다", async () => {
  const data = bytesOf(30_000);
  let signal: AbortSignal | null = null;
  const pending = setup(data, () => new Error("쓰지 않는다"), {
    firstCut: 5_000,
    get: (_url, _deps, opts) =>
      new Promise((_resolve, reject) => {
        signal = opts.signal;
        opts.signal.addEventListener("abort", () => reject(opts.signal.reason), { once: true });
      }),
  });
  pending.stream.resume();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(signal, "이어 받기를 요청했다");
  pending.stream.destroy();
  assert.equal((signal as unknown as AbortSignal).aborted, true);

  const pouring = setup(data, ranged(data));
  pouring.stream.once("data", () => pouring.stream.destroy());
  await new Promise((resolve) => pouring.stream.once("close", resolve));
  assert.equal(pouring.bodies[0].destroyed, true);
});

test("읽는 쪽이 멈추면 본문을 멈추고(메모리에 쌓지 않는다) 다시 읽으면 재개한다", async () => {
  const data = bytesOf(2_000_000);
  const { stream, bodies } = setup(data, ranged(data), { firstCut: 1_500_000 });
  stream.once("data", () => stream.pause());
  stream.resume();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(bodies[0].isPaused(), true, "본문을 멈췄다");
  assert.ok(stream.readableLength < 200_000, `쌓인 양 ${stream.readableLength}`);
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  stream.resume();
  await new Promise((resolve) => stream.once("end", resolve));
  assert.equal(Buffer.concat(chunks).length + 1000, data.length);
});

test("처음 응답에 크기가 없으면 206 이 알린 전체 크기를 기억해 다음 이어 받기와 비교하고, 다 받기 전에 끝나면 끊김으로 본다", async () => {
  const data = bytesOf(30_000);
  const answers = [({ from }: Asked) => bodyOf(data, { from, cut: 18_000, status: 206, headers: { "content-range": `bytes ${from}-${data.length - 1}/${data.length}` } }), ({ from }: Asked) => bodyOf(data, { from, status: 206, headers: { "content-range": `bytes ${from}-${data.length - 1}/${data.length + 5}` } })];
  const changed = setup(data, (asked, n) => answers[n - 1](asked), { firstCut: 9_000, firstHeaders: {}, validator: null });
  await assert.rejects(readAll(changed.stream), (e: Error & { permanent?: boolean }) => e.permanent === true && /전체 크기/.test(e.message));

  // 206 이 전체 크기를 알린 뒤 전체 크기보다 일찍 오류 없이 끝난다
  const ends = [({ from }: Asked) => Object.assign(Readable.from([data.subarray(from, 20_000)]), { status: 206, headers: { "content-range": `bytes ${from}-${data.length - 1}/${data.length}` } }), ranged(data)];
  const short = setup(data, (asked, n) => ends[n - 1](asked, 1), { firstCut: 9_000, firstHeaders: {}, validator: null });
  assert.deepEqual(await readAll(short.stream), data);
  assert.deepEqual(
    short.asked.map((one) => one.from),
    [9_000, 20_000],
  );
});
