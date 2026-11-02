// src/infra/query-memo.ts: 검색 결과 기억. 보관 시간, 개수 상한, 같은 키 함께 기다리기, 실패는 기억하지 않음

import { test } from "node:test";
import assert from "node:assert/strict";
import { queryMemo } from "../../src/infra/query-memo.ts";

test("보관 시간이 지나면 잊고, 개수를 넘으면 오래된 것부터 지운다", async () => {
  let now = 0;
  const memo = queryMemo<string>({ ttlMs: 100, max: 2, now: () => now });
  await memo.run("a", async () => "A");
  await memo.run("b", async () => "B");
  await memo.run("c", async () => "C");
  assert.equal(memo.get("a"), null, "셋째가 들어오며 가장 오래된 것이 빠진다");
  assert.deepEqual(memo.recent(), ["C", "B"]);
  now = 101;
  assert.equal(memo.get("b"), null);
  assert.deepEqual(memo.recent(), []);
});

test("같은 키를 찾는 중이면 그 검색을 함께 기다린다. 실패는 기다리던 쪽마다 받고 기억하지 않는다", async () => {
  const memo = queryMemo<string>({ ttlMs: 1000, max: 10, now: () => 0 });
  let calls = 0;
  let fail!: (error: Error) => void;
  const search = () => {
    calls++;
    return new Promise<string>((_, reject) => (fail = reject));
  };
  const both = [memo.run("k", search), memo.run("k", search)];
  fail(new Error("끊김"));
  for (const one of both) await assert.rejects(one, /끊김/);
  assert.equal(calls, 1);
  assert.equal(memo.get("k"), null);
  assert.equal(await memo.run("k", async () => "다시"), "다시");
});

test("앞부분이 같은 기억 중 가장 긴 것", async () => {
  const memo = queryMemo<string>({ ttlMs: 1000, max: 10, now: () => 0 });
  await memo.run("ab", async () => "AB");
  await memo.run("abc", async () => "ABC");
  assert.equal(memo.longestPrefix("abcd"), "ABC");
  assert.equal(memo.longestPrefix("abx"), "AB");
  assert.equal(memo.longestPrefix("abc"), "ABC");
  assert.equal(memo.longestPrefix("x"), null);
});
