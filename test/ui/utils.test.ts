// src/ui/format.ts: 공용 소형 유틸

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, formatMs, formatSpan, formatBytes, byteUnit, scaledText } from "../../src/ui/format.ts";

test("formatDuration: 초 → M:SS / H:MM:SS", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(null), "0:00");
  assert.equal(formatDuration(undefined), "0:00");
  assert.equal(formatDuration(1), "0:01");
  assert.equal(formatDuration(59), "0:59");
  assert.equal(formatDuration(60), "1:00");
  assert.equal(formatDuration(61), "1:01");
  assert.equal(formatDuration(599), "9:59");
  assert.equal(formatDuration(600), "10:00");
  assert.equal(formatDuration(3599), "59:59");
  assert.equal(formatDuration(3600), "1:00:00");
  assert.equal(formatDuration(3661), "1:01:01");
  assert.equal(formatDuration(7325), "2:02:05");
});

test("formatDuration: 소수/문자열 입력도 안전", () => {
  assert.equal(formatDuration(61.9), "1:01", "소수는 내림");
  assert.equal(formatDuration("185"), "3:05", "숫자 문자열 허용");
  assert.equal(formatDuration("abc"), "0:00", "비숫자는 0 취급");
});

// /search, /seek, /highlight, 조작 거절, /cachestatus, /help, /system 이 같은 함수를 쓴다.
// 아래 기대값은 곳마다 보이던 표기 그대로다. 곳마다 보이는 표기를 바꾸지 않는다
const SECS = [0, 0.4, 5, 59.9, 65, 3599, 3600, 3725.7, 86399, 86400, 90061, 360000, 400000.5];

test("formatDuration: 값이 없을 때의 문구는 부르는 쪽이 넘긴다(/search 는 알 수 없음)", () => {
  assert.deepEqual(
    [...SECS, null, undefined].map((s) => formatDuration(s, "알 수 없음")),
    ["알 수 없음", "0:00", "0:05", "0:59", "1:05", "59:59", "1:00:00", "1:02:05", "23:59:59", "24:00:00", "25:01:01", "100:00:00", "111:06:40", "알 수 없음", "알 수 없음"],
  );
});

test("formatMs: 밀리초 → M:SS / H:MM:SS(/seek, /highlight, 조작 거절)", () => {
  assert.deepEqual([0, 999, 1000, 65_500, 3_725_000, 90_061_000].map(formatMs), ["0:00", "0:00", "0:01", "1:05", "1:02:05", "25:01:01"]);
});

test("formatSpan: 일을 쓰면 /help, 초까지 쓰면 /system, 일을 안 쓰면 /cachestatus 의 모양", () => {
  assert.deepEqual(
    SECS.map((s) => formatSpan(s)),
    ["0분", "0분", "0분", "0분", "1분", "59분", "1시간", "1시간 2분", "23시간 59분", "1일", "1일 1시간 1분", "4일 4시간", "4일 15시간 6분"],
  );
  assert.deepEqual(
    SECS.map((s) => formatSpan(s, { withSeconds: true })),
    ["0초", "0초", "5초", "59초", "1분 5초", "59분 59초", "1시간", "1시간 2분 5초", "23시간 59분 59초", "1일", "1일 1시간 1분", "4일 4시간", "4일 15시간 6분"],
  );
  assert.deepEqual(
    SECS.slice(0, 11).map((s) => formatSpan(s, { days: false })),
    ["0분", "0분", "0분", "0분", "1분", "59분", "1시간", "1시간 2분", "23시간 59분", "24시간", "25시간 1분"],
  );
  assert.equal(formatSpan(3605, { withSeconds: true }), "1시간 5초", "0인 단위는 가운데여도 뺀다");
  assert.equal(formatSpan(400000, { days: false, withSeconds: true }), "111시간 6분 40초");
});

test("formatBytes: GB, TB 의 소수 자릿수만 부르는 쪽이 정한다(/cachestatus 2, /system 1), 1024 GB 부터 TB", () => {
  const sizes = [0, 512, 1536, 5 * 1024 ** 2 + 300_000, 1024 ** 3, 3.456 * 1024 ** 3, 1023.9 * 1024 ** 3, 1024 ** 4, 97.23 * 1024 ** 4];
  assert.deepEqual(
    sizes.map((b) => formatBytes(b, { gbDigits: 2 })),
    ["0.0 KB", "0.5 KB", "1.5 KB", "5.3 MB", "1.00 GB", "3.46 GB", "1023.90 GB", "1.00 TB", "97.23 TB"],
  );
  assert.deepEqual(
    sizes.map((b) => formatBytes(b)),
    ["0.0 KB", "0.5 KB", "1.5 KB", "5.3 MB", "1.0 GB", "3.5 GB", "1023.9 GB", "1.0 TB", "97.2 TB"],
  );
});

test("byteUnit: 1024 배씩 KB, MB, GB, TB, KB 아래로는 내리지 않는다", () => {
  assert.deepEqual(byteUnit(100), { n: 100 / 1024, unit: "KB", per: 1024 });
  assert.deepEqual(byteUnit(2 * 1024 ** 3), { n: 2, unit: "GB", per: 1024 ** 3 });
  assert.deepEqual(byteUnit(3 * 1024 ** 4), { n: 3, unit: "TB", per: 1024 ** 4 });
});

test("scaledText: 반올림한 수가 단위 경계에 닿으면 다음 단위로, 자릿수 경계를 넘으면 그 자릿수로", () => {
  const oneDigit = () => 1;
  assert.equal(formatBytes(1023.96 * 1024 ** 3), "1.0 TB", "1024.0 GB 가 아니라");
  assert.equal(formatBytes(1023.94 * 1024 ** 3), "1023.9 GB");
  assert.deepEqual(scaledText(1023.96 * 1024 ** 3, byteUnit, oneDigit), { value: "1.0", unit: "TB", per: 1024 ** 4 });
  // 100 이상은 정수, 그 아래는 소수 한 자리인 규칙: 99.96 은 "100.0" 이 아니라 "100"
  const rule = (n: number) => (n >= 100 ? 0 : 1);
  assert.equal(scaledText(99.96 * 1024 ** 3, byteUnit, rule).value, "100");
  assert.equal(scaledText(99.94 * 1024 ** 3, byteUnit, rule).value, "99.9");
});

test("formatDuration: 경계 입력의 지금 답(모름 표기를 넘겼을 때)", () => {
  const U = "모름";
  const cases: Array<[unknown, string]> = [
    [0, U],
    [null, U],
    [Infinity, "Infinity:NaN:NaN"],
    [-Infinity, "NaN:NaN"],
    [-5, "-1:-5"],
    [-65, "-2:-5"],
    ["abc", "0:00"],
    [" ", "0:00"],
    [true, "0:01"],
    ["0", "0:00"],
    ["0.0", "0:00"],
    ["-0", "0:00"],
    ["0e3", "0:00"],
    [0.4, "0:00"],
    [59.9999, "0:59"],
    [3599.5, "59:59"],
    [90061, "25:01:01"],
    ["185", "3:05"],
  ];
  for (const [value, expected] of cases) assert.equal(formatDuration(value as never, U), expected, String(value));
  assert.equal(formatMs(NaN), "0:00");
});
