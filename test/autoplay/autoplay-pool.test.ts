// src/autoplay/pool.ts: 소스에서 받아 온 곡을 쥐고 한 곡씩 내주는 풀.
//
// 여기서 지키려는 성질은 다섯이다: 같은 곡을 두 번 안 낸다, 다 쓰면 다시 채운다,
// 설정이 다르면 풀도 다르다, 소스가 죽어도 던지지 않는다, 여러 서버가 함께 채워도 앞의 풀을 덮지 않는다.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import * as pool from "../../src/autoplay/pool.ts";
import type { GenreSource } from "../../src/config/genres.ts";

const songs = (n: number, tag = "s") => Array.from({ length: n }, (_, i) => ({ artist: "A", title: `${tag}${i}`, sourceKey: `${tag}${i}` }));

beforeEach(() => pool._reset());

test("풀을 한 번 채우면 여러 번 내줄 때 다시 부르지 않는다", async () => {
  let calls = 0;
  const fill = async () => {
    calls++;
    return songs(5);
  };
  const src = { type: "lastfm", tags: ["pop"] };

  for (let i = 0; i < 5; i++) assert.ok(await pool.take(src, fill));
  assert.equal(calls, 1, "다섯 곡을 내는 동안 한 번만 불러야 한다");
});

test("같은 곡을 두 번 내지 않는다", async () => {
  const fill = async () => songs(10);
  const src = { type: "lastfm", tags: ["pop"] };

  const got = [];
  for (let i = 0; i < 10; i++) got.push((await pool.take(src, fill))?.sourceKey);
  assert.equal(new Set(got).size, 10);
});

test("다 쓰면 다시 채운다. 소진과 장애를 같은 일로 다룬다", async () => {
  let round = 0;
  const fill = async () => songs(3, `r${++round}-`);
  const src = { type: "lastfm", tags: ["pop"] };

  for (let i = 0; i < 3; i++) await pool.take(src, fill);
  const next = await pool.take(src, fill);
  assert.equal(round, 2, "풀이 비면 한 번 더 불러야 한다");
  assert.ok(next?.sourceKey.startsWith("r2-"));
});

test("설정이 다르면 풀도 다르다. 같은 소스라도 태그가 다르면 섞이지 않는다", async () => {
  const seen: string[] = [];
  const fill = async (s: GenreSource) => {
    const [tag = ""] = s.tags ?? [];
    seen.push(tag);
    return songs(2, tag);
  };

  await pool.take({ type: "lbradio", tags: ["anime"] }, fill);
  await pool.take({ type: "lbradio", tags: ["pop"] }, fill);
  assert.deepEqual(seen, ["anime", "pop"], "태그가 다르면 각각 채워야 한다");
  assert.equal(pool.stats().length, 2);
});

test("키 순서가 달라도 같은 설정이면 같은 풀이다", () => {
  assert.equal(pool.keyOf({ type: "lastfm", tags: ["pop"] }), pool.keyOf({ tags: ["pop"], type: "lastfm" }));
});

test("weight는 풀을 나누지 않는다. 고를 확률일 뿐 내용이 아니다", () => {
  assert.equal(pool.keyOf({ type: "lastfm", tags: ["pop"], weight: 1 }), pool.keyOf({ type: "lastfm", tags: ["pop"], weight: 9 }));
});

test("소스가 죽어도 던지지 않는다. 부르는 쪽이 다음 소스로 넘어가야 한다", async () => {
  const fill = async () => {
    throw new Error("HTTP 503");
  };
  assert.equal(await pool.take({ type: "lastfm", tags: ["pop"] }, fill), null);
});

test("빈 손으로 오면 null이다", async () => {
  assert.equal(await pool.take({ type: "lastfm", tags: ["pop"] }, async () => []), null);
});

test("싫다고 한 곡은 건너뛰되 썼다고 치지 않는다. 다른 서버는 받아도 된다", async () => {
  const fill = async () => songs(3);
  const src = { type: "lastfm", tags: ["pop"] };

  // s0을 싫다고 하면 s1이나 s2가 온다
  const first = await pool.take(src, fill, (t) => t.sourceKey === "s0");
  assert.notEqual(first?.sourceKey, "s0");

  // s0은 아직 안 쓴 것으로 남아 있다
  const rest = [];
  for (let i = 0; i < 2; i++) {
    const t = await pool.take(src, fill);
    if (t) rest.push(t.sourceKey);
  }
  assert.ok(rest.includes("s0"), "건너뛴 곡은 여전히 남아 있어야 한다");
});

test("싫다는 것만 남으면 null. 억지로 내지 않는다", async () => {
  const fill = async () => songs(2);
  assert.equal(await pool.take({ type: "lastfm", tags: ["pop"] }, fill, () => true), null);
});

// 채우기를 테스트가 끝내는 소스. 부를 때마다 다른 곡(r1-, r2-)을 준비하고 done(i)로 i번째 채우기를 끝낸다
function deferredFill(size: number) {
  const pending: Array<() => void> = [];
  let round = 0;
  const fill = () => {
    const tag = `r${++round}-`;
    return new Promise<ReturnType<typeof songs>>((resolve) => pending.push(() => resolve(songs(size, tag))));
  };
  const done = async (i: number) => {
    pending[i]?.();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { fill, done, calls: () => round };
}

test("빈 풀을 두 서버가 함께 채우면 뒤에 채운 쪽이 앞의 풀을 덮지 않고 받은 곡을 보탠다(이미 낸 곡을 다시 내지 않는다)", async () => {
  const src = { type: "lastfm", tags: ["pop"] };
  const { fill, done, calls } = deferredFill(5);
  const first = pool.take(src, fill);
  const second = pool.take(src, fill);
  await done(0);
  const a = await first;
  await done(1);
  const b = await second;
  assert.equal(calls(), 2);
  assert.ok(a?.sourceKey.startsWith("r1-") && b, `${a?.sourceKey}, ${b?.sourceKey}`);
  assert.notEqual(a?.sourceKey, b?.sourceKey);
  assert.deepEqual(
    pool.stats().map((p) => [p.total, p.used]),
    [[10, 2]],
    "뒤에 받은 곡은 그 풀에 보탠다",
  );
});

test("함께 채운 풀을 그사이 다 썼으면 자기가 받은 것으로 채운다(곡을 못 받는 서버가 없다)", async () => {
  const src = { type: "lastfm", tags: ["pop"] };
  const { fill, done } = deferredFill(1);
  const first = pool.take(src, fill);
  const second = pool.take(src, fill);
  await done(0);
  assert.equal((await first)?.sourceKey, "r1-0");
  await done(1);
  assert.equal((await second)?.sourceKey, "r2-0");
  assert.deepEqual(
    pool.stats().map((p) => [p.total, p.used]),
    [[1, 1]],
    "다 쓴 풀은 보태지 않고 새 풀로 바꾼다",
  );
});

test("함께 채운 풀에 남은 곡이 다 싫은 곡이어도 자기가 받은 곡에서 고른다", async () => {
  const src = { type: "lastfm", tags: ["pop"] };
  const { fill, done } = deferredFill(2);
  const first = pool.take(src, fill);
  const second = pool.take(src, fill, (track) => track.sourceKey.startsWith("r1-"));
  await done(0);
  assert.ok((await first)?.sourceKey.startsWith("r1-"));
  await done(1);
  assert.ok((await second)?.sourceKey.startsWith("r2-"));
});

test("같은 곡이 두 번 든 목록도 곡마다 한 번으로 세어, 다 쓰면 다시 채운다", async () => {
  let calls = 0;
  const fill = async () => {
    calls++;
    return [...songs(1, `d${calls}-`), ...songs(1, `d${calls}-`)];
  };
  const src = { type: "lastfm", tags: ["pop"] };
  assert.equal((await pool.take(src, fill))?.sourceKey, "d1-0");
  assert.equal((await pool.take(src, fill))?.sourceKey, "d2-0");
  assert.equal(calls, 2);
});

test("함께 채운 두 목록이 겹치면 겹친 곡은 한 번만 보탠다", async () => {
  const src = { type: "lastfm", tags: ["pop"] };
  const pending: Array<() => void> = [];
  const fill = () => new Promise<ReturnType<typeof songs>>((resolve) => pending.push(() => resolve(songs(3))));
  const first = pool.take(src, fill);
  const second = pool.take(src, fill);
  pending[0]?.();
  await first;
  pending[1]?.();
  await second;
  assert.deepEqual(
    pool.stats().map((p) => [p.total, p.used]),
    [[3, 2]],
  );
});

test("한 시간이 지난 풀은 남은 곡이 있어도 다시 채운다", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  let round = 0;
  const fill = async () => songs(5, `t${++round}-`);
  const src = { type: "lastfm", tags: ["pop"] };
  assert.ok((await pool.take(src, fill))?.sourceKey.startsWith("t1-"));
  t.mock.timers.tick(pool.TTL_MS);
  assert.ok((await pool.take(src, fill))?.sourceKey.startsWith("t1-"), "한 시간까지는 그대로");
  t.mock.timers.tick(1);
  assert.ok((await pool.take(src, fill))?.sourceKey.startsWith("t2-"));
});

test("함께 채운 목록을 보태도 한 풀은 곡 수 상한(MAX_TRACKS)을 넘지 않는다", async () => {
  const src = { type: "lastfm", tags: ["pop"] };
  const { fill, done } = deferredFill(1500);
  const takes = [pool.take(src, fill), pool.take(src, fill), pool.take(src, fill)];
  for (let i = 0; i < takes.length; i++) await done(i);
  assert.equal((await Promise.all(takes)).filter(Boolean).length, 3);
  assert.equal(pool.stats()[0]?.total, pool.MAX_TRACKS);
});
