// src/media/loudness-meter.ts: 재생 중 측정 단계(BS.1770 순간 볼륨과 100ms 샘플 피크)
//
// 지키는 것: EBU Tech 3341 기준 신호(1kHz 사인파 -23 dBFS 스테레오)가 -23.0 LUFS. 블록은 100ms 마다, 끝난 위치(채널당 샘플 수)와 함께 처음 400ms 뒤부터 나온다.
// 청크가 1바이트씩, 홀수 길이로 와도 같은 블록이 나오고 청크는 손대지 않고 넘긴다. 깨진 샘플은 무음으로 보고 뒤의 블록을 망치지 않는다.
// 무음이 이어져도 느려지지 않는다. 탭이 측정하라고 할 때만 재고, 다시 켜면 새로 시작한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { LoudnessMeter, BlockMeter } from "../../src/media/loudness-meter.ts";
import type { GainTap } from "../../src/media/gain-tap.ts";

const FS = 48_000;

// 진폭 amplitude 의 1kHz 사인파(두 채널 같음) seconds 초, f32le
function sine(seconds: number, amplitude: number) {
  const buf = Buffer.alloc(FS * seconds * 8);
  for (let i = 0; i < FS * seconds; i++) {
    const v = amplitude * Math.sin((2 * Math.PI * 1000 * i) / FS);
    buf.writeFloatLE(v, i * 8);
    buf.writeFloatLE(v, i * 8 + 4);
  }
  return buf;
}

type Block = [number, number, number];
function tapOf(metering: () => boolean = () => true) {
  const got: Block[] = [];
  const tap: GainTap = { frame: () => ({ gain: 0, press: false }), metering, block: (endPos, m, peak) => void got.push([endPos, m, peak]), close: () => {} };
  return { tap, got };
}

async function run(meter: LoudnessMeter, buf: Buffer, sizes: number[]) {
  const parts: Buffer[] = [];
  for (let o = 0, i = 0; o < buf.length; i++) {
    const n = sizes[i % sizes.length] as number;
    parts.push(buf.subarray(o, o + n));
    o += n;
  }
  const out: Buffer[] = [];
  for await (const chunk of Readable.from(parts, { objectMode: false }).pipe(meter)) out.push(chunk as Buffer);
  return Buffer.concat(out);
}

test("EBU Tech 3341: 1kHz 사인파 -23 dBFS 스테레오는 -23.0 LUFS 이고, 블록은 400ms 뒤부터 100ms 마다 끝난 위치와 함께 나온다", async () => {
  const amplitude = 10 ** (-23 / 20);
  const { tap, got } = tapOf();
  await run(new LoudnessMeter(tap), sine(2, amplitude), [65536]);
  assert.equal(got.length, 17);
  assert.deepEqual(
    got.slice(0, 3).map((b) => b[0]),
    [19_200, 24_000, 28_800],
  );
  for (const [, m, peak] of got) {
    assert.ok(Math.abs(m - -23) < 0.05, `순간 볼륨 ${m}`);
    assert.ok(Math.abs(peak - -23) < 0.01, `피크 ${peak}`);
  }
});

test("청크가 1바이트씩, 홀수 길이로 와도 같은 블록이 나오고, 청크는 손대지 않고 넘긴다", async () => {
  const buf = sine(1, 0.3);
  const a = tapOf();
  const passed = await run(new LoudnessMeter(a.tap), buf, [65536]);
  const b = tapOf();
  const odd = await run(new LoudnessMeter(b.tap), buf.subarray(0, 48_000 * 2), [1, 3, 7, 4093]);
  assert.deepEqual(passed, buf);
  assert.deepEqual(odd, buf.subarray(0, 48_000 * 2));
  assert.deepEqual(b.got, a.got.slice(0, b.got.length));
});

test("깨진 샘플은 무음으로 보고 뒤의 블록을 망치지 않는다", () => {
  const got: number[] = [];
  const meter = new BlockMeter((_p, m) => got.push(m));
  const samples = new Float32Array(FS * 2 * 2);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.1 * Math.sin(i * 0.07);
  samples[100] = NaN;
  samples[101] = Infinity;
  meter.push(samples, 0);
  assert.ok(got.every(Number.isFinite));
  assert.ok((got.at(-1) as number) > -40, `마지막 블록 ${got.at(-1)}`);
});

test("무음이 이어져도 느려지지 않는다(필터 상태를 0 으로 민다)", () => {
  const meter = new BlockMeter(() => {});
  const loud = new Float32Array(FS * 2).map((_v, i) => 0.3 * Math.sin(i * 0.05));
  const quiet = new Float32Array(FS * 2);
  meter.push(loud, 0);
  const timeOf = (pcm: Float32Array) => {
    const t = performance.now();
    for (let k = 0; k < 20; k++) meter.push(pcm, 0);
    return performance.now() - t;
  };
  timeOf(quiet);
  const silent = timeOf(quiet);
  const sound = timeOf(loud);
  assert.ok(silent < sound * 3, `무음 ${silent.toFixed(1)}ms, 소리 ${sound.toFixed(1)}ms`);
});

test("탭이 측정하라고 할 때만 재고, 위치는 늘 센다. 다시 켜면 처음 400ms 를 새로 채운다", async () => {
  let on = false;
  const { tap, got } = tapOf(() => on);
  const meter = new LoudnessMeter(tap);
  meter.resume();
  const buf = sine(2, 0.3);
  // 청크는 1초씩: 첫 청크는 끈 채, 둘째는 켜고 넣는다
  meter.write(buf.subarray(0, FS * 8));
  on = true;
  meter.write(buf.subarray(FS * 8));
  meter.end();
  await new Promise((r) => meter.on("end", r));
  assert.equal(got.length, 7, "켠 뒤 1초에서 400ms 가 차기 전에는 블록이 없다");
  assert.equal(got[0]?.[0], 48_000 + 19_200, "켠 뒤 400ms 를 채운 위치(지나간 위치는 끈 동안에도 셌다)");
});
