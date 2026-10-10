// src/infra/download-meter.ts — 받아 둔 곡의 양: 지난 15초에 마친 양의 평균 · 오늘 받은 양

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { _reset, addDownloaded, downloadMeter } from "../../src/infra/download-meter.ts";

beforeEach(_reset);

test("지난 15초에 마친 양의 초당 평균, 지나면 빠진다", () => {
  const now = new Date(2026, 9, 10, 12, 0, 0).getTime();
  addDownloaded(3_000_000, now - 20_000);
  addDownloaded(15_000_000, now - 5_000);
  addDownloaded(0, now);
  assert.deepEqual(downloadMeter(now), { bytesPerSec: 1_000_000, todayBytes: 18_000_000 });
  assert.equal(downloadMeter(now + 11_000).bytesPerSec, 0);
});

test("오늘 받은 양은 자정에 처음부터", () => {
  const evening = new Date(2026, 9, 10, 23, 59, 50).getTime();
  addDownloaded(5_000_000, evening);
  assert.equal(downloadMeter(evening).todayBytes, 5_000_000);
  assert.equal(downloadMeter(evening + 20_000).todayBytes, 0, "자정을 넘겼다");
  addDownloaded(1_000_000, evening + 20_000);
  assert.equal(downloadMeter(evening + 20_000).todayBytes, 1_000_000);
});
