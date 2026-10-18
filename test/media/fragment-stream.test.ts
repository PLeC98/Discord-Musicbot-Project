// src/media/fragment-stream.ts — 조각 목록으로만 주는 오디오(유튜브 post_live)를 순서대로 받아 흘린다.
// 요청은 가짜다. 조각 번호를 본문에 싣는다

import { test } from "node:test";
import assert from "node:assert/strict";
import { createFragmentStream, startOf, type FragmentFetch } from "../../src/media/fragment-stream.ts";

const base = "https://rr.test/videoplayback?live=1";

// 조각 번호를 적는 요청 가짜. answer(번호, 몇 번째 시도) 가 답을 정한다. 기본은 "조각 N"
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
    return Promise.resolve({ ok, status: ok ? 200 : verdict, arrayBuffer: async () => new TextEncoder().encode(`조각 ${index}|`).buffer as ArrayBuffer });
  };
  return { impl, asked };
}

async function readAll(stream: NodeJS.ReadableStream) {
  let text = "";
  for await (const chunk of stream) text += (chunk as Buffer).toString();
  return text;
}

test("처음부터 순서대로 흘리고 마지막 조각 뒤에 끝난다. 조각 주소는 base 뒤 &sq=번호", async () => {
  const { impl, asked } = fakeFetch();
  const s = createFragmentStream({ fragments: { base, count: 3 }, durationMs: 6_000, startMs: 0, fetchImpl: impl, retryDelaysMs: [] });
  assert.equal(await readAll(s), "조각 0|조각 1|조각 2|");
  assert.deepEqual(asked, [`${base}&sq=0`, `${base}&sq=1`, `${base}&sq=2`]);
  assert.equal(s.startedAtMs, 0);
});

test("위치는 그 위치가 든 조각부터. 조각 하나의 길이는 전체 길이 ÷ 조각 수", async () => {
  const { impl } = fakeFetch();
  const s = createFragmentStream({ fragments: { base, count: 5 }, durationMs: 10_000, startMs: 5_300, fetchImpl: impl, retryDelaysMs: [] });
  assert.equal(await readAll(s), "조각 2|조각 3|조각 4|");
  assert.equal(s.startedAtMs, 4_000);
  assert.deepEqual(startOf({ base, count: 5 }, 10_000, 99_999), { index: 4, atMs: 8_000 }, "끝을 넘으면 마지막 조각");
});

test("5xx · 네트워크 오류는 그 조각만 다시 받는다", async () => {
  const { impl, asked } = fakeFetch((i, attempt) => (i === 1 && attempt === 0 ? 503 : i === 2 && attempt === 0 ? "throw" : "ok"));
  const s = createFragmentStream({ fragments: { base, count: 3 }, durationMs: 6_000, startMs: 0, fetchImpl: impl, retryDelaysMs: [1, 1] });
  assert.equal(await readAll(s), "조각 0|조각 1|조각 2|");
  assert.equal(asked.filter((u) => u.endsWith("&sq=1")).length, 2);
  assert.match(s.describe(), /조각 3\/3\(시작 0\) · 다시 받음 2회/);
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

test("조각이 멈추면 끊고 다시 받는다", async () => {
  const { impl } = fakeFetch((i, attempt) => (i === 0 && attempt === 0 ? "hang" : "ok"));
  const s = createFragmentStream({ fragments: { base, count: 2 }, durationMs: 4_000, startMs: 0, fetchImpl: impl, retryDelaysMs: [1], stallMs: 50 });
  assert.equal(await readAll(s), "조각 0|조각 1|");
});

test("조각 수가 없으면 만들지 않는다", () => {
  assert.throws(() => createFragmentStream({ fragments: { base, count: 0 }, durationMs: 1, startMs: 0 }), /조각 수가 올바르지 않습니다/);
});
