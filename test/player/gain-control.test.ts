// src/player/gain-control.ts: 볼륨 정규화의 게인 조절기(재생 상태와 파이프라인별 게인 탭)
//
// 지키는 것: 고정 게인 규칙(줄이는 쪽은 그대로, 증폭은 상한과 프레임 피크 상위 1% 로 제한하고 0 dB 아래로는 내리지 않음), 지금 캐시 파일과 같은 파일의 측정값만 고정 게인으로 쓴다.
// 정규화를 끈 서버는 게인 0, 리미터 끔. 켠 서버는 리미터를 켜고 측정값이 없으면 0 dB. 새 재생의 첫 프레임은 그 곡의 시작 게인이고, 이어 트는 재생의 새 탭은 확정 전까지 기존 재생 상태의 보낸 게인을 준다.
// 확정하면 이전 탭은 마지막 게인으로 고정된다. 설정을 바꾸거나 측정값이 생기면 보낸 게인에서 이어서 램프한다(감소 1초, 증가 초당 3 dB, 프레임 수 기준).
// 끈 뒤에도 게인이 0 으로 다 돌아올 때까지 리미터를 켠다. 측정값이 없는 캐시 파일을 틀거나 재생 중에 정규화를 켜면 측정을 요청한다.

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openTempStore } from "../helpers/temp-store.ts";
import type { PathFacts } from "../../src/media/gain-tap.ts";

const store = openTempStore("gain-control-");
after(() => store.close());
const { GainControl, fixedGainOf } = await import("../../src/player/gain-control.ts");
const loudness = await import("../../src/store/loudness.ts");

const FILE: PathFacts = { kind: "file", live: false, bounded: true, sizeBytes: null, downloading: false, cacheFile: "/cache/a.opus" };
const STREAM: PathFacts = { kind: "pipe", live: false, bounded: null, sizeBytes: null, downloading: true, cacheFile: null };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

function cached(key: string, integrated: number, peakP99 = -10) {
  store.db().prepare("INSERT OR REPLACE INTO audio_cache (audio_key, status, file_path, file_size_bytes, duration_sec, downloaded_at, created_at) VALUES (?, 'cached', ?, 1000, 200, 1, 0)").run(key, `/cache/${key}.opus`);
  loudness.recordFile(key, { integrated, truePeak: peakP99 + 1, peakP99 }, { sizeBytes: 1000, durationSec: 200, audioVersion: null });
}

function control(on = true) {
  const state = { on };
  const measured: string[] = [];
  const gain = new GainControl({ isOn: () => state.on, measure: (key) => measured.push(key) });
  return { gain, state, measured };
}

// 프레임 n 개를 진행한 뒤 마지막 프레임의 결과
function frames(tap: { frame(pos: number): { gain: number; press: boolean } }, n: number) {
  let last = { gain: NaN, press: false };
  for (let i = 0; i < n; i++) last = tap.frame(i * 960);
  return last;
}

beforeEach(() => {
  store.db().prepare("DELETE FROM loudness").run();
  store.db().prepare("DELETE FROM audio_cache").run();
});

test("고정 게인: 줄이는 쪽은 그대로, 증폭은 상한과 프레임 피크 상위 1% 로 제한하고 피크가 이미 높은 조용한 곡은 줄이지 않는다", () => {
  const row = (kind: "file" | "heard-full", integrated: number, peakP99: number) => ({ kind, integrated, truePeak: 0, peakP99, heardSec: null, sizeBytes: null, durationSec: null, audioVersion: null, algo: 1, measuredAt: 0, usedAt: 0 });
  assert.equal(fixedGainOf(row("file", -8, -1)), -6);
  assert.equal(fixedGainOf(row("file", -30, -40)), 12, "파일은 +12 까지");
  assert.equal(fixedGainOf(row("heard-full", -30, -40)), 6, "끝까지 재생하며 측정한 값은 +6 까지");
  assert.equal(fixedGainOf(row("file", -20, -5)), 3.5, "프레임 피크 상위 1% 가 -1.5 에 닿는 데까지");
  assert.equal(fixedGainOf(row("heard-full", -20, -5)), 3, "재생 중 측정한 값은 피크에 0.5 dB 를 더한다");
  assert.equal(fixedGainOf(row("file", -20, 0)), 0, "max(0, ...)");
  assert.equal(fixedGainOf(row("file", -55, -60)), null, "-50 LUFS 아래는 쓰지 않는다");
});

test("측정값이 있는 캐시 파일은 첫 프레임부터 고정 게인이고 리미터를 켠다. 정규화를 끈 서버는 게인 0, 리미터 끔", () => {
  cached("yt:a", -8);
  const on = control(true);
  const tap = on.gain.openTap({ key: "yt:a", continued: false }, FILE);
  assert.deepEqual(tap.frame(0), { gain: -6, press: true });
  const off = control(false);
  const plain = off.gain.openTap({ key: "yt:a", continued: false }, FILE);
  assert.deepEqual(frames(plain, 10), { gain: 0, press: false });
});

test("측정값이 없거나 지금 캐시 파일이 아닌 파일의 측정값이면 0 dB 다. 측정값이 없는 캐시 파일로 재생을 확정하면 측정을 요청한다", () => {
  const { gain, measured } = control(true);
  const none = gain.openTap({ key: "yt:none", continued: false }, FILE);
  assert.deepEqual(none.frame(0), { gain: 0, press: true });
  gain.commit(none, "yt:none");
  assert.deepEqual(measured, ["yt:none"]);

  cached("yt:old", -8);
  store.db().prepare("UPDATE audio_cache SET file_size_bytes = 999 WHERE audio_key = 'yt:old'").run();
  const other = gain.openTap({ key: "yt:old", continued: false }, FILE);
  assert.equal(other.frame(0).gain, 0, "다시 받은 다른 파일");
  store.db().prepare("DELETE FROM audio_cache WHERE audio_key = 'yt:old'").run();
  const evicted = gain.openTap({ key: "yt:old", continued: false }, STREAM);
  assert.equal(evicted.frame(0).gain, 0, "캐시 파일이 정리된 곡을 스트림으로 틀 때는 고정 게인으로 쓰지 않는다");
});

test("재생 중에 측정값이 생기면 보낸 게인에서 램프한다: 감소는 1초(50프레임)에 걸쳐, 증가는 초당 3 dB", () => {
  const { gain } = control(true);
  const tap = gain.openTap({ key: "yt:b", continued: false }, STREAM);
  gain.commit(tap, "yt:b");
  frames(tap, 5);
  cached("yt:b", -8);
  gain.valueArrived("yt:b");
  const steps: number[] = [];
  for (let i = 0; i < 60; i++) steps.push(tap.frame(i * 960).gain);
  assert.ok(near(steps[0] as number, -6 / 50), `첫 프레임 ${steps[0]}`);
  assert.ok(near(steps[49] as number, -6), `50번째 ${steps[49]}`);
  assert.equal(steps[59], -6);

  const up = control(true);
  const quiet = up.gain.openTap({ key: "yt:q", continued: false }, STREAM);
  up.gain.commit(quiet, "yt:q");
  cached("yt:q", -20, -30);
  up.gain.valueArrived("yt:q");
  assert.ok(near(frames(quiet, 50).gain, 3), "1초에 3 dB");
  assert.ok(near(frames(quiet, 50).gain, 6), "2초에 6 dB 에 닿는다");
});

test("정규화 켜고 끄기를 프레임마다 읽고 보낸 게인에서 램프한다. 끈 뒤에도 0 으로 다 돌아올 때까지 리미터를 켠다. 켜면 측정값이 없는 캐시 파일의 측정을 요청한다", () => {
  cached("yt:c", -8);
  const { gain, state, measured } = control(false);
  const tap = gain.openTap({ key: "yt:c", continued: false }, FILE);
  gain.commit(tap, "yt:c");
  assert.deepEqual(tap.frame(0), { gain: 0, press: false });
  state.on = true;
  assert.ok(near(tap.frame(960).gain, -6 / 50));
  const on = frames(tap, 60);
  assert.deepEqual(on, { gain: -6, press: true });
  state.on = false;
  const first = tap.frame(0);
  assert.ok(first.press && near(first.gain, -6 + 3 / 50), JSON.stringify(first));
  assert.ok(frames(tap, 98).press, "0 으로 다 돌아오는 2초가 되기 전까지는 리미터를 켠다");
  assert.deepEqual(frames(tap, 2), { gain: 0, press: false });
  assert.deepEqual(measured, [], "측정값이 있는 곡은 측정을 요청하지 않는다");

  const fresh = control(false);
  const none = fresh.gain.openTap({ key: "yt:none", continued: false }, FILE);
  fresh.gain.commit(none, "yt:none");
  fresh.state.on = true;
  none.frame(0);
  assert.deepEqual(fresh.measured, ["yt:none"]);
});

test("일시정지 중에는 게인 요청이 없으므로 램프도 멈춘다(프레임 수 기준)", () => {
  const { gain } = control(true);
  const tap = gain.openTap({ key: "yt:d", continued: false }, STREAM);
  gain.commit(tap, "yt:d");
  cached("yt:d", -8);
  gain.valueArrived("yt:d");
  frames(tap, 10);
  const before = tap.frame(0).gain;
  // 일시정지 중에는 프레임 호출이 없다. 다시 틀면 멈춘 위치에서 한 프레임씩 이어 간다
  const after = tap.frame(0).gain;
  assert.ok(near(after - before, -6 / 50), `${before} → ${after}`);
});

test("이어 트는 재생의 새 탭은 확정 전까지 기존 재생 상태의 보낸 게인을 주고, 확정하면 그 상태를 이어 간다. 이전 탭은 마지막 게인으로 고정된다", () => {
  const { gain } = control(true);
  const first = gain.openTap({ key: "yt:e", continued: false }, STREAM);
  gain.commit(first, "yt:e");
  cached("yt:e", -8);
  gain.valueArrived("yt:e");
  const mid = frames(first, 20).gain;
  const seek = gain.openTap({ key: "yt:e", continued: true }, FILE);
  assert.equal(seek.frame(0).gain, mid, "확정 전에는 기존 재생 상태의 보낸 게인");
  frames(first, 5);
  const sent = first.frame(0).gain;
  gain.commit(seek, "yt:e");
  assert.equal(first.frame(0).gain, sent, "이전 탭은 확정 때의 게인으로 고정된다");
  assert.ok(near(seek.frame(0).gain, sent - 6 / 50), "새 탭이 이어서 램프한다");
});

test("새 재생(다른 곡)의 탭은 자기 시작 게인으로 시작하고, 확정 전까지 앞 곡은 자기 게인을 계속 낸다", () => {
  cached("yt:f", -8);
  cached("yt:g", -20, -30);
  const { gain } = control(true);
  const a = gain.openTap({ key: "yt:f", continued: false }, FILE);
  gain.commit(a, "yt:f");
  frames(a, 3);
  const b = gain.openTap({ key: "yt:g", continued: false }, FILE);
  assert.equal(b.frame(0).gain, 6, "다음 곡은 앞 곡의 게인이 아니라 자기 시작 게인");
  assert.equal(a.frame(0).gain, -6, "건너뛴 뒤 다음 곡을 여는 동안에도 앞 곡은 자기 게인");
  gain.commit(b, "yt:g");
  assert.equal(a.frame(0).gain, -6);
  gain.end();
  assert.equal(b.frame(0).gain, 6, "곡이 끝나면 마지막 게인으로 고정된다");
});

test("확정할 때 바로잡힌 키로 근거를 다시 본다(캐시 폴백)", () => {
  cached("yt:right", -8);
  const { gain } = control(true);
  const tap = gain.openTap({ key: "yt:wrong", continued: false }, FILE);
  assert.equal(tap.frame(0).gain, 0);
  gain.commit(tap, "yt:right");
  assert.ok(near(tap.frame(0).gain, -6 / 50), "보낸 게인에서 램프한다");
});
