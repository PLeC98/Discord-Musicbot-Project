// dashboard/src/utils/units.ts — 크기에 맞는 단위 고르기와 그래프 세로축의 상한

import { test } from "node:test";
import assert from "node:assert/strict";
import { axisMax, bitRate, byteRate, count, niceMax, time } from "../../../dashboard/src/utils/units.ts";
import { scaledText } from "../../../src/ui/format.ts";

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

test("개수: 1000 부터 k, 100만부터 M, 반올림이 경계를 넘으면 위 단위로", () => {
  const digits = (_: number, unit: string) => (unit ? 1 : 0);
  assert.deepEqual(scaledText(999, count, digits), { value: "999", unit: "", per: 1 });
  assert.deepEqual(scaledText(2499, count, digits), { value: "2.5", unit: "k", per: 1000 });
  assert.deepEqual(scaledText(112_455_000, count, digits), { value: "112.5", unit: "M", per: 1e6 });
  assert.deepEqual(scaledText(999_960, count, digits), { value: "1.0", unit: "M", per: 1e6 }, "1000.0k 가 아니라");
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

test("단위 경계의 반올림: 999.96 MB/s 는 1.0 GB/s, 999.6 Mbps 는 1.0 Gbps, 99.96 Mbps 는 100 Mbps", () => {
  assert.deepEqual(
    scaledText(999.96, byteRate, () => 1),
    { value: "1.0", unit: "GB/s", per: 1024 },
  );
  const rate = (n: number, unit: string) => (unit === "kbps" || n >= 100 ? 0 : 1);
  assert.equal(scaledText(999.6, bitRate, rate).unit, "Gbps");
  assert.equal(scaledText(999.6, bitRate, rate).value, "1.0");
  assert.deepEqual(scaledText(99.96, bitRate, rate), { value: "100", unit: "Mbps", per: 1 });
  assert.deepEqual(scaledText(0.9996, bitRate, rate), { value: "1.0", unit: "Mbps", per: 1 }, "999.6 kbps 가 1000 kbps 가 아니라");
});
