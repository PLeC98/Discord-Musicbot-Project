// src/autoplay/sources/http.ts remembered — 화면을 위해 저쪽에서 받아 기억하는 값.
// 회귀 대상: AnimeThemes 가 죽어 있으면(522) 운영자 자동재생 설정이 소스 종류 목록을 받느라 시간 초과까지 기다렸고,
// 요청마다 다시 기다렸다. 그동안 화면은 모든 소스를 "모르는 종류"로 그렸다.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "../../src/autoplay/sources/http.ts";
const { remembered } = http;

const opts = { ttlMs: 60_000, retryMs: 60_000, waitMs: 30 };

test("느리면 waitMs 까지만 기다리고 먼저 답한다. 받은 값은 기억해 다음부터 쓴다", async () => {
  let loads = 0;
  let finish;
  const slow = remembered(() => {
    loads++;
    return new Promise((done) => (finish = done));
  }, opts);
  const started = Date.now();
  assert.equal(await slow.get(), null);
  assert.ok(Date.now() - started < 1000, "시간 초과를 기다리지 않는다");
  assert.equal(await slow.get(), null, "받는 중에 또 부르면 같은 물음을 기다린다");
  assert.equal(loads, 1);

  finish({ min: 1963, max: 2026 });
  await new Promise(setImmediate);
  assert.deepEqual(await slow.get(), { min: 1963, max: 2026 });
  assert.equal(loads, 1);
});

test("못 받았으면 retryMs 동안 다시 묻지 않는다. 처음 상태로 채우면 다시 묻는다", async () => {
  let loads = 0;
  const down = remembered(async () => {
    loads++;
    return null;
  }, opts);
  assert.equal(await down.get(), null);
  assert.equal(await down.get(), null);
  assert.equal(loads, 1, "죽어 있는 저쪽을 부를 때마다 묻지 않는다");

  down.seed(null);
  await down.get();
  assert.equal(loads, 2);
});
