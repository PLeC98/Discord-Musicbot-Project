// src/autoplayPool — 소스에서 받아 온 곡을 쥐고 한 곡씩 내주는 풀.
//
// 여기서 지키려는 성질은 넷이다: 같은 곡을 두 번 안 낸다 · 다 쓰면 다시 채운다 ·
// 설정이 다르면 풀도 다르다 · 소스가 죽어도 던지지 않는다.

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

test("다 쓰면 다시 채운다 — 소진과 장애를 같은 일로 다룬다", async () => {
  let round = 0;
  const fill = async () => songs(3, `r${++round}-`);
  const src = { type: "lastfm", tags: ["pop"] };

  for (let i = 0; i < 3; i++) await pool.take(src, fill);
  const next = await pool.take(src, fill);
  assert.equal(round, 2, "풀이 비면 한 번 더 불러야 한다");
  assert.ok(next?.sourceKey.startsWith("r2-"));
});

test("설정이 다르면 풀도 다르다 — 같은 소스라도 태그가 다르면 섞이지 않는다", async () => {
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

test("키 차례가 달라도 같은 설정이면 같은 풀이다", () => {
  assert.equal(pool.keyOf({ type: "lastfm", tags: ["pop"] }), pool.keyOf({ tags: ["pop"], type: "lastfm" }));
});

test("weight는 풀을 가르지 않는다 — 고를 확률일 뿐 내용이 아니다", () => {
  assert.equal(pool.keyOf({ type: "lastfm", tags: ["pop"], weight: 1 }), pool.keyOf({ type: "lastfm", tags: ["pop"], weight: 9 }));
});

test("소스가 죽어도 던지지 않는다 — 부르는 쪽이 다음 소스로 넘어가야 한다", async () => {
  const fill = async () => {
    throw new Error("HTTP 503");
  };
  assert.equal(await pool.take({ type: "lastfm", tags: ["pop"] }, fill), null);
});

test("빈 손으로 오면 null이다", async () => {
  assert.equal(await pool.take({ type: "lastfm", tags: ["pop"] }, async () => []), null);
});

test("싫다고 한 곡은 건너뛰되 썼다고 치지 않는다 — 다른 서버는 받아도 된다", async () => {
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

test("싫다는 것만 남으면 null — 억지로 내지 않는다", async () => {
  const fill = async () => songs(2);
  assert.equal(await pool.take({ type: "lastfm", tags: ["pop"] }, fill, () => true), null);
});
