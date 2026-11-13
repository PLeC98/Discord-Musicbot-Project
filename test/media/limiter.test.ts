// src/media/limiter.ts: 인코딩 워커의 게인 램프와 룩어헤드 리미터
//
// 지키는 것: 리미터를 켜면(press) 까다로운 신호(임펄스, 계단, 고역 사인, 잡음, 저역, 버스트, 사각파, 보간 계수의 부호에 맞춘 샘플)의 true peak 가 상한(-1.5 dBTP)을 넘지 않는다.
// 프레임 크기를 바꿔도 결과가 같다. 깨진 샘플은 무음이 된다. 리미터를 끄면 지연만큼 늦춘 입력을 ±1 로 클립한 것과 같다.
// 게인은 프레임 안에서 선형 램프해 이웃 샘플이 튀지 않고, 리미터를 켜고 꺼도 출력이 이어진다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Limiter, TRUE_PEAK_PHASES } from "../../src/media/limiter.ts";

const FS = 48_000;
const CEIL = 10 ** (-1.5 / 20);

// 채널마다 4배 보간 true peak
function truePeakOf(pcm: Float32Array) {
  let max = 0;
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i + 1 < pcm.length / 2; i++) {
      max = Math.max(max, Math.abs(pcm[i * 2 + c] as number));
      if (i < 11) continue;
      for (const phase of TRUE_PEAK_PHASES) {
        let s = 0;
        for (let t = 0; t < 12; t++) s += (phase[t] as number) * (pcm[(i - t) * 2 + c] as number);
        max = Math.max(max, Math.abs(s));
      }
    }
  }
  return max;
}

let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
const SIGN = TRUE_PEAK_PHASES[1] as readonly number[];

const SIGNALS: Record<string, (i: number) => number> = {
  "임펄스(1초마다, +12 dBFS)": (i) => (i % FS === 100 ? 4 : 0.01 * Math.sin(i * 0.05)),
  "계단(조용하다 갑자기 +10 dBFS 사인)": (i) => (i < FS ? 0.05 : 3.16) * Math.sin((2 * Math.PI * 440 * i) / FS),
  "고역 사인 11 kHz +6 dBFS": (i) => 2 * Math.sin((2 * Math.PI * 11025 * i) / FS + 0.7),
  "나이퀴스트 근처 23 kHz +6 dBFS": (i) => 2 * Math.sin((2 * Math.PI * 23000 * i) / FS + 0.3),
  "백색 잡음 +6 dBFS": () => 2 * rnd(),
  "저역 30 Hz +9 dBFS": (i) => 2.8 * Math.sin((2 * Math.PI * 30 * i) / FS),
  "잡음 버스트(50ms 켬, 50ms 끔) +9 dBFS": (i) => (Math.floor(i / 2400) % 2 ? 0 : 2.8 * rnd()),
  "사각파 1 kHz +6 dBFS": (i) => (Math.floor(i / 24) % 2 ? 2 : -2),
  "보간 계수의 부호에 맞춘 12 샘플을 +12 dBFS 로 되풀이": (i) => 4 * Math.sign(SIGN[11 - (i % 12)] as number),
};

// 프레임 크기를 바꿔 가며(20ms, 홀수 크기) 처리한 출력
function limited(fn: (i: number) => number, seconds: number, sizes = [960, 333, 960, 77, 4800, 960]) {
  const limiter = new Limiter();
  const out: Float32Array[] = [];
  let i = 0;
  for (let k = 0; i < FS * seconds; k++) {
    const frames = Math.min(sizes[k % sizes.length] as number, FS * seconds - i);
    const pcm = new Float32Array(frames * 2);
    for (let f = 0; f < frames; f++, i++) {
      const v = fn(i);
      pcm[f * 2] = v;
      pcm[f * 2 + 1] = v * 0.8;
    }
    limiter.run(pcm, 1, 1, true);
    out.push(pcm);
  }
  const all = new Float32Array(out.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of out) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

for (const [name, fn] of Object.entries(SIGNALS)) {
  test(`리미터를 켜면 상한을 넘지 않는다: ${name}`, () => {
    seed = 1;
    const tp = truePeakOf(limited(fn, 2));
    assert.ok(tp <= CEIL, `true peak ${(20 * Math.log10(tp)).toFixed(3)} dBTP`);
  });
}

test("보간 계수의 부호에 맞춘 신호(샘플 크기는 상한의 절반 아래)도 true peak 가 상한을 넘지 않는다", () => {
  // 계수의 절댓값 합이 2.02 인 가운데 두 위상(바깥 둘은 1.43 이라 넘지 않는다)
  for (const phase of TRUE_PEAK_PHASES.slice(1, 3)) {
    const pcm = new Float32Array(4000);
    for (let rep = 0; rep < 20; rep++)
      for (let t = 0; t < 12; t++) {
        const v = 0.499999 * CEIL * Math.sign(phase[11 - t] as number);
        pcm[(100 + rep * 90 + t) * 2] = v;
        pcm[(100 + rep * 90 + t) * 2 + 1] = v;
      }
    assert.ok(truePeakOf(pcm) > CEIL, "넣기 전에는 상한을 넘는 입력이어야 한다");
    const limiter = new Limiter();
    limiter.run(pcm, 1, 1, true);
    const tail = new Float32Array(limiter.delaySamples * 2);
    limiter.run(tail, 1, 1, true);
    const both = new Float32Array(pcm.length + tail.length);
    both.set(pcm);
    both.set(tail, pcm.length);
    assert.ok(truePeakOf(both) <= CEIL, `true peak ${(20 * Math.log10(truePeakOf(both))).toFixed(3)} dBTP`);
  }
});

test("프레임 크기를 바꿔도 출력이 같다", () => {
  const fn = SIGNALS["계단(조용하다 갑자기 +10 dBFS 사인)"] as (i: number) => number;
  const a = limited(fn, 2, [960]);
  const b = limited(fn, 2, [333, 77, 4800]);
  assert.deepEqual(a, b);
});

test("깨진 샘플(NaN, 무한대, 터무니없이 큰 값)은 무음이 되고 뒤의 소리를 망치지 않는다", () => {
  const limiter = new Limiter();
  const broken = new Float32Array([0.1, 0.1, NaN, 0.2, Infinity, 0.1, 0.1, -Infinity, 1e30, 0.1]);
  limiter.run(broken, 1, 1, true);
  const after = new Float32Array(FS / 10).fill(0.3);
  limiter.run(after, 1, 1, true);
  assert.ok([...broken, ...after].every(Number.isFinite));
  // 깨진 샘플이 지연 버퍼를 빠져나간 뒤에는 들어간 소리 그대로다
  assert.ok(Math.abs((after[after.length - 1] as number) - 0.3) < 1e-6, `${after[after.length - 1]}`);
});

test("리미터를 끄면 지연만큼 늦춘 입력을 ±1 로 클립한 것과 같다", () => {
  const limiter = new Limiter();
  const delay = limiter.delaySamples;
  const src = new Float32Array(FS * 2);
  for (let i = 0; i < src.length; i += 2) src[i] = src[i + 1] = 1.4 * Math.sin(i * 0.02);
  const out = src.slice();
  for (let o = 0; o < out.length; o += 1920) limiter.run(out.subarray(o, o + 1920), 1, 1, false);
  for (let i = 0; i < delay * 2; i++) assert.equal(out[i], 0);
  for (let i = delay * 2; i < out.length; i++) assert.equal(out[i], Math.fround(Math.max(-1, Math.min(1, src[i - delay * 2] as number))));
});

test("게인은 프레임 안에서 선형 램프하고 마지막 샘플에 새 게인이 걸린다", () => {
  const limiter = new Limiter();
  const delay = limiter.delaySamples;
  const pcm = new Float32Array(1920 * 3).fill(0.2);
  limiter.run(pcm.subarray(0, 1920), 1, 1, false);
  limiter.run(pcm.subarray(1920, 3840), 1, 0.5, false);
  limiter.run(pcm.subarray(3840), 0.5, 0.5, false);
  let jump = 0;
  for (let i = (delay + 2) * 2; i < pcm.length; i += 2) jump = Math.max(jump, Math.abs((pcm[i] as number) - (pcm[i - 2] as number)));
  // 한 번에 바꾸면 0.1, 960 샘플에 나누면 0.000104
  assert.ok(jump < 0.0002, `이웃 샘플 차 ${jump}`);
  assert.ok(Math.abs((pcm[pcm.length - 1] as number) - 0.1) < 1e-6);
});

test("재생 중에 리미터를 켜고 꺼도 출력이 이어진다", () => {
  const src = new Float32Array(FS * 2);
  for (let i = 0; i < src.length; i += 2) src[i] = src[i + 1] = 1.4 * Math.sin(i * 0.02);
  const out = src.slice();
  const limiter = new Limiter();
  for (let o = 0, n = 0; o < out.length; o += 1920, n++) limiter.run(out.subarray(o, o + 1920), 1, 1, Math.floor(n / 10) % 2 === 1);
  let slope = 0;
  let jump = 0;
  for (let i = 2; i < src.length; i += 2) {
    slope = Math.max(slope, Math.abs((src[i] as number) - (src[i - 2] as number)));
    jump = Math.max(jump, Math.abs((out[i] as number) - (out[i - 2] as number)));
  }
  // 클립 상한을 한 번에 바꾸면 이웃 샘플 차가 입력 기울기의 몇 배로 튄다
  assert.ok(jump <= slope * 1.2, `이웃 샘플 차 ${jump}, 입력 기울기 ${slope}`);
});
