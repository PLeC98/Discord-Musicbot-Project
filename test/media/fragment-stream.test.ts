// src/media/fragment-stream.ts: 세그먼트 목록으로만 주는 오디오(유튜브 post_live)를 순서대로 받아 흘린다.
// 요청은 가짜다. 세그먼트 번호를 본문에 싣는다

import { test } from "node:test";
import assert from "node:assert/strict";
import { createFragmentStream, openFragmentStream, streamFragments, startOf, type FragmentFetch, type FragmentSource } from "../../src/media/fragment-stream.ts";

const base = "https://rr.test/videoplayback?live=1";

// 세그먼트 번호를 적는 요청 가짜. answer(번호, 몇 번째 시도) 가 답을 정한다. 기본은 "세그먼트 N"
function fakeFetch(answer: (index: number, attempt: number) => "ok" | number | "throw" | "hang" = () => "ok") {
  const asked: string[] = [];
  const attempts = new Map<number, number>();
  const impl: FragmentFetch = (url, { signal }) => {
    asked.push(url);
    const index = Number(new URL(url).searchParams.get("sq"));
    const attempt = attempts.get(index) ?? 0;
    attempts.set(index, attempt + 1);
    const verdict = answer(index, attempt);
    if (verdict === "throw") return Promise.reject(new Error("socket hang up"));
    if (verdict === "hang") return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    const ok = verdict === "ok";
    return Promise.resolve({ ok, status: ok ? 200 : verdict, arrayBuffer: async () => new TextEncoder().encode(`세그먼트 ${index}|`).buffer as ArrayBuffer });
  };
  return { impl, asked };
}

async function readAll(stream: NodeJS.ReadableStream) {
  let text = "";
  for await (const chunk of stream) text += (chunk as Buffer).toString();
  return text;
}

test("처음부터 순서대로 흘리고 마지막 세그먼트 뒤에 끝난다. 세그먼트 주소는 base 뒤 &sq=번호", async () => {
  const { impl, asked } = fakeFetch();
  const s = createFragmentStream({ fragments: { base, count: 3 }, durationMs: 6_000, startMs: 0, fetchImpl: impl, retryDelaysMs: [] });
  assert.equal(await readAll(s), "세그먼트 0|세그먼트 1|세그먼트 2|");
  assert.deepEqual(asked, [`${base}&sq=0`, `${base}&sq=1`, `${base}&sq=2`]);
  assert.equal(s.startedAtMs, 0);
});

test("위치는 그 위치가 든 세그먼트부터. 세그먼트 하나의 길이는 전체 길이 ÷ 세그먼트 수", async () => {
  const { impl } = fakeFetch();
  const s = createFragmentStream({ fragments: { base, count: 5 }, durationMs: 10_000, startMs: 5_300, fetchImpl: impl, retryDelaysMs: [] });
  assert.equal(await readAll(s), "세그먼트 2|세그먼트 3|세그먼트 4|");
  assert.equal(s.startedAtMs, 4_000);
  assert.deepEqual(startOf({ base, count: 5 }, 10_000, 99_999), { index: 4, atMs: 8_000 }, "끝을 넘으면 마지막 세그먼트");
});

test("5xx, 네트워크 오류는 그 세그먼트만 다시 받는다", async () => {
  const { impl, asked } = fakeFetch((i, attempt) => (i === 1 && attempt === 0 ? 503 : i === 2 && attempt === 0 ? "throw" : "ok"));
  const s = createFragmentStream({ fragments: { base, count: 3 }, durationMs: 6_000, startMs: 0, fetchImpl: impl, retryDelaysMs: [1, 1] });
  assert.equal(await readAll(s), "세그먼트 0|세그먼트 1|세그먼트 2|");
  assert.equal(asked.filter((u) => u.endsWith("&sq=1")).length, 2);
  assert.match(s.describe(), /세그먼트 3\/3\(시작 0\) · 다시 받음 2회/);
});

test("4xx 는 다시 받지 않고 오류로 끝난다. 다시 받아도 안 되면 오류로 끝난다", async () => {
  const forbidden = fakeFetch((i) => (i === 1 ? 403 : "ok"));
  const a = createFragmentStream({ fragments: { base, count: 3 }, durationMs: 6_000, startMs: 0, fetchImpl: forbidden.impl, retryDelaysMs: [1, 1] });
  await assert.rejects(readAll(a), /HTTP 403/);
  assert.equal(forbidden.asked.filter((u) => u.endsWith("&sq=1")).length, 1);

  const down = fakeFetch((i) => (i === 0 ? 500 : "ok"));
  const b = createFragmentStream({ fragments: { base, count: 2 }, durationMs: 4_000, startMs: 0, fetchImpl: down.impl, retryDelaysMs: [1, 1] });
  await assert.rejects(readAll(b), /HTTP 500/);
  assert.equal(down.asked.filter((u) => u.endsWith("&sq=0")).length, 3, "처음 한 번과 다시 두 번");
});

test("세그먼트가 멈추면 끊고 다시 받는다", async () => {
  const { impl } = fakeFetch((i, attempt) => (i === 0 && attempt === 0 ? "hang" : "ok"));
  const s = createFragmentStream({ fragments: { base, count: 2 }, durationMs: 4_000, startMs: 0, fetchImpl: impl, retryDelaysMs: [1], stallMs: 50 });
  assert.equal(await readAll(s), "세그먼트 0|세그먼트 1|");
});

test("세그먼트 수가 없으면 만들지 않는다", () => {
  assert.throws(() => createFragmentStream({ fragments: { base, count: 0 }, durationMs: 1, startMs: 0 }), /세그먼트 수가 올바르지 않습니다/);
});

test("출처를 넘기면: 다음 세그먼트가 늦게 나와도(라이브) 차례대로 흘리고, 닫으면 출처에 알린다", async () => {
  const names = ["a", "b", "c"];
  let given = 0;
  let closed = 0;
  const source: FragmentSource<string> = {
    // 앞 세그먼트를 받는 중에도 부른다. 늦게 나오는 세그먼트 흉내
    next: () => new Promise((resolve) => setTimeout(() => resolve(names[given++] ?? null), 5)),
    fetch: async (name) => Buffer.from(`${name}|`),
    startedAtMs: 1_000,
    describe: (sent) => `흘림 ${sent}`,
    close: () => closed++,
  };
  const s = streamFragments(source, { retryDelaysMs: [] });
  assert.equal(await readAll(s), "a|b|c|");
  assert.deepEqual([s.startedAtMs, s.describe(), closed], [1_000, "흘림 3", 1]);

  const endless = streamFragments({ ...source, next: async () => "x" }, { retryDelaysMs: [] });
  for await (const _ of endless) break;
  assert.equal(closed, 2, "다 읽지 않고 닫아도 출처에 알린다");
});

test("열 때 첫 세그먼트까지 받는다: 막혔으면(403, 주소 만료나 망이 바뀜) 여는 자리에서 실패해 재생 쪽이 새로 받는다", async () => {
  const { impl, asked } = fakeFetch((i) => (i === 0 ? 403 : "ok"));
  await assert.rejects(openFragmentStream({ fragments: { base, count: 3 }, durationMs: 6_000, startMs: 0, fetchImpl: impl, retryDelaysMs: [] }), /HTTP 403/);
  assert.deepEqual(asked, [`${base}&sq=0`]);
});

test("연 뒤 읽으면 받아 둔 첫 세그먼트부터 흘린다. 첫 세그먼트를 두 번 받지 않는다", async () => {
  const { impl, asked } = fakeFetch();
  const s = await openFragmentStream({ fragments: { base, count: 3 }, durationMs: 6_000, startMs: 0, fetchImpl: impl, retryDelaysMs: [] });
  assert.equal(await readAll(s), "세그먼트 0|세그먼트 1|세그먼트 2|");
  assert.equal(asked.filter((u) => u.endsWith("&sq=0")).length, 1);
});

test("곡 길이를 모르면(0, NaN) 처음 세그먼트부터", () => {
  for (const durationMs of [0, NaN]) assert.deepEqual(startOf({ base, count: 5 }, durationMs, 30_000), { index: 0, atMs: 0 });
});

test("닫으면 받는 중인 세그먼트(미리 받는 것까지)를 끊는다", async () => {
  const signals: AbortSignal[] = [];
  const source: FragmentSource<number> = {
    next: async () => signals.length,
    fetch: (_n, signal) => {
      signals.push(signal);
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    },
    startedAtMs: 0,
    describe: () => "",
  };
  const s = streamFragments(source, { retryDelaysMs: [1], stallMs: 60_000 });
  s.on("error", () => {});
  s.resume();
  await new Promise((done) => setImmediate(done));
  assert.equal(signals.length, 2, "흘릴 것과 미리 받는 것");
  s.destroy();
  assert.deepEqual(
    signals.map((one) => one.aborted),
    [true, true],
  );
  await new Promise((done) => setTimeout(done, 5));
  assert.equal(signals.length, 2, "끊긴 뒤 다시 받지 않는다");
});
