// src/store/loudness.ts: 음원의 음량 값(볼륨 정규화가 게인을 정할 때 쓴다)
//
// 지키는 것: file 값을 저장하면 그 음원의 file-failed 표시가 지워지고, file 값이 있으면 들으며 잰 값은 저장하지 않는다. heard-full 은 늘 교체하고,
// heard-part 는 들은 양이 min(기존 들은 양, 600초) 이상이거나 기존 값이 30일보다 오래됐을 때만 교체한다(교체하지 않아도 마지막 사용 시각은 갱신한다).
// file-failed 는 같은 파일(크기, 길이)과 같은 측정 방식에서만 다시 재지 않는다. file 값의 중앙값은 30개부터 구하고, 저장하거나 초기화하면 다시 계산한다.
// 180일 동안 쓰지 않은 행은 하루에 한 번 지운다. 재는 동안 캐시 파일의 삭제를 막는다(audio-cache 의 holdForMeasure).

import fs from "node:fs";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openTempStore } from "../helpers/temp-store.ts";

const store = openTempStore("loudness-");
after(() => store.close());
const loudness = await import("../../src/store/loudness.ts");
const audioCache = await import("../../src/store/audio-cache.ts");

const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000;
const value = (integrated: number) => ({ integrated, truePeak: -1, peakP99: -3 });
const file = { sizeBytes: 1000, durationSec: 200, audioVersion: "v1" };
const unknown = { sizeBytes: null, durationSec: null, audioVersion: null };

beforeEach(() => {
  store.db().prepare("DELETE FROM loudness").run();
  loudness.forgetMemory();
});

test("file 값을 저장하면 file-failed 표시가 지워지고, file 값이 있으면 들으며 잰 값은 저장하지 않는다", () => {
  loudness.recordFileFailed("yt:a", file, NOW);
  assert.ok(loudness.rowsOf("yt:a")["file-failed"]);
  loudness.recordFile("yt:a", value(-9), file, NOW);
  const rows = loudness.rowsOf("yt:a");
  assert.equal(rows["file-failed"], undefined);
  assert.equal(rows.file?.integrated, -9);
  assert.equal(loudness.recordHeard("yt:a", "heard-full", { value: value(-12), identity: file, heardSec: 190 }, NOW), false);
  assert.equal(loudness.rowsOf("yt:a")["heard-full"], undefined);
});

test("heard-full 은 늘 교체한다", () => {
  loudness.recordHeard("yt:b", "heard-full", { value: value(-10), identity: file, heardSec: 190 }, NOW);
  assert.equal(loudness.recordHeard("yt:b", "heard-full", { value: value(-11), identity: file, heardSec: 40 }, NOW + 1), true);
  assert.equal(loudness.rowsOf("yt:b")["heard-full"]?.integrated, -11);
});

test("heard-part 는 들은 양이 min(기존 들은 양, 600초) 이상이거나 30일이 지났을 때만 교체하고, 교체하지 않아도 마지막 사용 시각은 갱신한다", () => {
  loudness.recordHeard("dl:r", "heard-part", { value: value(-20), identity: unknown, heardSec: 7200 }, NOW);
  assert.equal(loudness.recordHeard("dl:r", "heard-part", { value: value(-5), identity: unknown, heardSec: 40 }, NOW + 1000), false, "두 시간 들은 값을 40초가 지우지 못한다");
  const kept = loudness.rowsOf("dl:r")["heard-part"];
  assert.deepEqual([kept?.integrated, kept?.usedAt, kept?.measuredAt], [-20, NOW + 1000, NOW]);
  assert.equal(loudness.recordHeard("dl:r", "heard-part", { value: value(-15), identity: unknown, heardSec: 600 }, NOW + 2000), true, "10분 이상 들은 값은 늘 교체한다");
  assert.equal(loudness.recordHeard("dl:r", "heard-part", { value: value(-14), identity: unknown, heardSec: 599 }, NOW + 3000), false);
  assert.equal(loudness.recordHeard("dl:r", "heard-part", { value: value(-14), identity: unknown, heardSec: 31 }, NOW + 2000 + 31 * DAY), true, "30일이 지나면 들은 양을 따지지 않는다");
  assert.equal(loudness.rowsOf("dl:r")["heard-part"]?.heardSec, 31);
});

test("file-failed 는 같은 파일(크기, 길이)과 같은 측정 방식에서만 다시 재지 않는다", () => {
  loudness.recordFileFailed("yt:c", file, NOW);
  assert.equal(loudness.failedBefore("yt:c", file), true);
  assert.equal(loudness.failedBefore("yt:c", { ...file, sizeBytes: 1001 }), false, "다시 받은 다른 파일");
  assert.equal(loudness.failedBefore("yt:d", file), false);
  store
    .db()
    .prepare("UPDATE loudness SET algo = ? WHERE audio_key = 'yt:c'")
    .run(loudness.ALGO + 1);
  assert.equal(loudness.failedBefore("yt:c", file), false, "다른 측정 방식에서 실패한 표시");
});

test("file 값의 중앙값은 30개부터 구하고, 저장하거나 초기화하면 다시 계산한다", () => {
  for (let i = 0; i < 29; i++) loudness.recordFile(`yt:m${i}`, value(-i), file, NOW);
  assert.equal(loudness.fileMedian(), null);
  loudness.recordFile("yt:m29", value(-29), file, NOW);
  assert.equal(loudness.fileMedian(), -14);
  loudness.recordFile("yt:m30", value(-30), file, NOW);
  assert.equal(loudness.fileMedian(), -15);
  store.db().prepare("DELETE FROM loudness").run();
  assert.equal(loudness.fileMedian(), -15, "초기화를 알리기 전에는 캐시된 값");
  loudness.forgetMemory();
  assert.equal(loudness.fileMedian(), null);
});

test("180일 동안 쓰지 않은 행은 하루에 한 번 지운다", () => {
  loudness.recordFile("yt:old", value(-9), file, NOW - 200 * DAY);
  loudness.recordFile("yt:used", value(-9), file, NOW - 200 * DAY);
  loudness.touch("yt:used", "file", NOW - DAY);
  assert.equal(loudness.pruneIfDue(NOW), 1);
  assert.deepEqual([Boolean(loudness.rowsOf("yt:old").file), Boolean(loudness.rowsOf("yt:used").file)], [false, true]);
  loudness.recordFile("yt:old2", value(-9), file, NOW - 200 * DAY);
  assert.equal(loudness.pruneIfDue(NOW + 1000), 0, "하루가 지나지 않았다");
  assert.equal(loudness.pruneIfDue(NOW + DAY), 1);
});

test("재는 동안 막아 둔 캐시 파일은 삭제되지 않고, 모두 푼 뒤에는 삭제된다", async () => {
  fs.mkdirSync(audioCache.cacheDir(), { recursive: true });
  const path = audioCache.getFilePath("yt:held");
  fs.writeFileSync(path, "x".repeat(100));
  store.db().prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, downloaded_at, created_at) VALUES ('yt:held', 'cached', ?, 100, 1, 0)").run(path);
  const first = audioCache.holdForMeasure("yt:held");
  const second = audioCache.holdForMeasure("yt:held");
  first();
  first();
  assert.deepEqual(await audioCache.removeCached("yt:held", 1), { ok: false, code: "in-use", where: "measuring" }, "두 번 건 막기 중 하나가 남아 있다");
  second();
  assert.equal((await audioCache.removeCached("yt:held", 1)).ok, true);
});
