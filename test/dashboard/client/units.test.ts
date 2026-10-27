// dashboard/src/utils/units.ts — 크기에 맞는 단위 고르기와 그래프 세로축의 상한

import { test } from "node:test";
import assert from "node:assert/strict";
import { axisMax, bitRate, byteRate, niceMax, time } from "../../../dashboard/src/utils/units.ts";

test("시간: 1000ms 부터 초", () => {
  assert.deepEqual(time(999.9), { n: 999.9, unit: "ms", per: 1 });
  assert.deepEqual(time(1000), { n: 1, unit: "s", per: 1000 });
  assert.deepEqual(time(41249), { n: 41.249, unit: "s", per: 1000 });
});

test("비트 속도: 1 Mbps 아래는 kbps, 1000 Mbps 부터 Gbps", () => {
  assert.deepEqual(bitRate(0.5), { n: 500, unit: "kbps", per: 0.001 });
  assert.deepEqual(bitRate(99.9), { n: 99.9, unit: "Mbps", per: 1 });
  assert.deepEqual(bitRate(9899), { n: 9.899, unit: "Gbps", per: 1000 });
});

test("바이트 속도: 1000 MB/s 부터 GB/s(1024 배)", () => {
  assert.deepEqual(byteRate(999), { n: 999, unit: "MB/s", per: 1 });
  assert.deepEqual(byteRate(2048), { n: 2, unit: "GB/s", per: 1024 });
});

test("깔끔한 상한: 1 · 2 · 5 × 10ⁿ", () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(3), 5);
  assert.equal(niceMax(454.6), 500);
  assert.equal(niceMax(41249), 50000);
});

test("세로축: 최고값이 바닥 아래면 바닥, 넘으면 그 단위의 깔끔한 수로 늘린다", () => {
  assert.equal(axisMax(250, 300, time), 300, "평소에는 고정값 그대로");
  assert.equal(axisMax(300, 300, time), 300);
  assert.equal(axisMax(420, 300, time), 500, "튀면 축이 따라 오른다");
  assert.equal(axisMax(41249, 300, time), 50000, "초 단위의 깔끔한 수(50s)");
  assert.equal(axisMax(1180.2, 5, byteRate), 2048, "GB/s 의 깔끔한 수(2 GB/s)");
  assert.equal(axisMax(0.4, 1, bitRate), 1);
});
