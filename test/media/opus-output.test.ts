// src/media/opus-output.ts — PCM 을 20ms 프레임으로 모아 볼륨을 곱하고 Opus 로 인코딩하는 재생 출력
//
// 지키는 것: 조각 크기와 상관없이 3840바이트 프레임 하나가 패킷 하나가 되고, 패킷은 Buffer 로 한 번에 하나씩 나온다.
// 읽힐 때만 인코딩한다(읽지 않으면 받은 조각의 callback 이 미뤄진다). 인코더는 정확히 한 번 해제한다.
// 끝나면 end 를 내고, 입력 오류 · 인코딩 오류는 출력의 error 가 되며 위쪽 스트림까지 destroy 된다.
// voice 의 실제 리소스(StreamType.Opus)에서 read() 한 번이 패킷 하나이고 playbackDuration 이 20씩 오른다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Readable } from "stream";
import { once } from "events";
import { createAudioResource, StreamType } from "@discordjs/voice";
import { createDecoder } from "libopus-wasm";
import { OpusOutput, attachOpusOutput } from "../../src/media/opus-output.ts";
import { createOpusEncoder, type OpusEncoder } from "../../src/media/opus-encoder.ts";
import { FRAME_BYTES } from "../../src/media/audio-splicer.ts";

const real = () => createOpusEncoder();

// 해제 횟수를 세는 실제 인코더
function counted() {
  const stats = { created: 0, freed: 0 };
  const make = async (): Promise<OpusEncoder> => {
    const enc = await real();
    stats.created++;
    return {
      encode: (frame) => enc.encode(frame),
      free: () => {
        stats.freed++;
        enc.free();
      },
    };
  };
  return { make, stats };
}

// 진폭이 일정한 사인파(왼쪽 · 오른쪽 같음)
function sine(frames: number, amplitude = 12000) {
  const buf = Buffer.alloc(frames * FRAME_BYTES);
  for (let i = 0, t = 0; i < buf.length; i += 4, t++) {
    const v = Math.round(amplitude * Math.sin((2 * Math.PI * 440 * t) / 48000));
    buf.writeInt16LE(v, i);
    buf.writeInt16LE(v, i + 2);
  }
  return buf;
}

// 주어진 크기들로 잘라 흘리는 소스
function chunked(buf: Buffer, sizes: number[]) {
  const parts: Buffer[] = [];
  for (let o = 0, i = 0; o < buf.length; i++) {
    const n = sizes[i % sizes.length] ?? buf.length;
    parts.push(buf.subarray(o, o + n));
    o += n;
  }
  return Readable.from(parts, { objectMode: false });
}

async function readAll(output: Readable) {
  const packets: unknown[] = [];
  for await (const p of output) packets.push(p);
  return packets as Buffer[];
}

async function rmsOf(packets: Buffer[]) {
  const dec = await createDecoder({ sampleRate: 48000, channels: 2 });
  const out = packets.map((p) => {
    const pcm = dec.decode(p);
    let s = 0;
    for (const v of pcm) s += v * v;
    return Math.sqrt(s / pcm.length);
  });
  dec.free();
  return out;
}

test("조각 크기와 상관없이 3840바이트 프레임 하나가 Buffer 패킷 하나가 된다(1바이트 · 홀수 크기 포함)", async () => {
  for (const sizes of [[1], [3, 7, 4093], [FRAME_BYTES], [65536]]) {
    const output = attachOpusOutput(chunked(sine(10), sizes), { gain: 1, createEncoder: real });
    const packets = await readAll(output);
    assert.equal(packets.length, 10, `조각 ${sizes.join(",")}`);
    for (const p of packets) assert.ok(Buffer.isBuffer(p) && p.length > 0);
  }
});

test("끝에 남은 20ms 미만은 버리고 end 를 낸다", async () => {
  const pcm = Buffer.concat([sine(3), Buffer.alloc(FRAME_BYTES - 4)]);
  const packets = await readAll(attachOpusOutput(chunked(pcm, [5000]), { gain: 1, createEncoder: real }));
  assert.equal(packets.length, 3);
});

test("쓰기 없이 끝나도 end 를 낸다", async () => {
  const packets = await readAll(attachOpusOutput(Readable.from([], { objectMode: false }), { gain: 1, createEncoder: real }));
  assert.equal(packets.length, 0);
});

test("배율을 곱해 인코딩하고, 곡 중간 setVolume 은 그 뒤 패킷부터 먹는다", async () => {
  const output = attachOpusOutput(chunked(sine(60), [65536]), { gain: 1, createEncoder: real });
  const packets: Buffer[] = [];
  for await (const p of output) {
    packets.push(p as Buffer);
    if (packets.length === 30) output.setVolume(0.25);
  }
  const rms = await rmsOf(packets);
  const loud = rms.slice(10, 28).reduce((a, b) => a + b) / 18;
  const quiet = rms.slice(34).reduce((a, b) => a + b) / (rms.length - 34);
  // 0.25 배면 RMS 도 약 0.25 배(Opus 손실 때문에 정확하지 않다)
  assert.ok(Math.abs(quiet / loud - 0.25) < 0.05, `비율 ${(quiet / loud).toFixed(3)}`);
  // 바꾼 뒤 (HWM + 1) 패킷 안에 바뀐다: 30번째를 받은 뒤 바꿨으니 31번째는 이미 인코딩된 옛 크기, 32번째가 새 크기로 인코딩된다.
  // 디코더는 앞 프레임과 겹쳐 풀므로(lookahead) 32번째는 둘이 섞여 나오고 33번째부터 온전히 작다
  assert.ok(rms[30] > loud * 0.8, `31번째 패킷 RMS ${rms[30]}`);
  assert.ok(rms[32] < loud * 0.35, `33번째 패킷 RMS ${rms[32]}`);
});

test("처음 볼륨은 첫 패킷부터 먹는다(만든 뒤 한참 기다렸다 읽어도 앞서 인코딩된 큰 소리가 없다)", async () => {
  const output = attachOpusOutput(chunked(sine(60), [65536]), { gain: 0.1, createEncoder: real });
  await new Promise((r) => setTimeout(r, 200));
  const packets = await readAll(output);
  const rms = await rmsOf(packets);
  const full = 12000 / Math.SQRT2;
  // 첫 패킷은 디코더가 앞 소리 없이 시작해 작다. 둘째부터
  for (const [i, r] of rms.slice(1).entries()) assert.ok(r < full * 0.15, `${i + 2}번째 패킷 RMS ${r}`);
});

test("배율 1 이면 PCM 을 건드리지 않는다(곱하지 않은 인코딩과 같은 패킷)", async () => {
  const pcm = sine(5);
  const a = await readAll(attachOpusOutput(chunked(pcm, [4000]), { gain: 1, createEncoder: real }));
  const enc = await real();
  const b = Array.from({ length: 5 }, (_, i) => enc.encode(pcm.subarray(i * FRAME_BYTES, (i + 1) * FRAME_BYTES)));
  enc.free();
  assert.deepEqual(a, b);
});

test("읽지 않으면 HWM 을 넘겨 인코딩하지 않는다(받은 조각의 callback 이 미뤄진다)", async () => {
  const output = new OpusOutput({ gain: 1, createEncoder: real });
  let written = false;
  output.write(sine(20), () => {
    written = true;
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(output.readableLength, 1);
  assert.equal(written, false);
  // 읽으면 이어 간다
  let n = 0;
  while (output.read()) n++;
  assert.ok(n >= 1);
  output.destroy();
});

test("조각이 프레임 크기와 같아도(스플라이서) 읽지 않으면 앞서 인코딩하지 않는다", async () => {
  const src = new PassThrough();
  const output = attachOpusOutput(src, { gain: 1, createEncoder: real });
  const pcm = sine(200);
  for (let o = 0; o < pcm.length; o += FRAME_BYTES) src.write(pcm.subarray(o, o + FRAME_BYTES));
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(output.readableLength <= 1, `쌓인 패킷 ${output.readableLength}`);
  output.destroy();
});

test("조각이 프레임 크기와 같아도 setVolume 은 (HWM + 1) 패킷 안에 먹는다", async () => {
  const src = new PassThrough();
  const output = attachOpusOutput(src, { gain: 1, createEncoder: real });
  const pcm = sine(60);
  for (let o = 0; o < pcm.length; o += FRAME_BYTES) src.write(pcm.subarray(o, o + FRAME_BYTES));
  src.end();
  await once(output, "readable");
  const packets: Buffer[] = [];
  for (let i = 0; i < 60; i++) {
    const p = output.read();
    if (p) packets.push(p);
    else await new Promise((r) => setTimeout(r, 2));
    if (packets.length === 30) output.setVolume(0.25);
  }
  const rms = await rmsOf(packets);
  const loud = rms.slice(10, 28).reduce((a, b) => a + b) / 18;
  assert.ok(rms[32] < loud * 0.35, `33번째 패킷 RMS ${rms[32]} / ${loud}`);
});

test("destroy 하면 인코더를 정확히 한 번 해제한다(끝까지 읽고 끝나도, 중간에 destroy 해도)", async () => {
  const done = counted();
  await readAll(attachOpusOutput(chunked(sine(5), [3000]), { gain: 1, createEncoder: done.make }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(done.stats, { created: 1, freed: 1 });

  const cut = counted();
  const output = attachOpusOutput(chunked(sine(50), [3000]), { gain: 1, createEncoder: cut.make });
  await once(output, "readable");
  output.destroy();
  output.destroy();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(cut.stats, { created: 1, freed: 1 });
});

test("인코더가 만들어지기 전에 destroy 돼도 만들어지는 대로 해제한다", async () => {
  const done = counted();
  const output = new OpusOutput({ gain: 1, createEncoder: done.make });
  output.destroy();
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(done.stats, { created: 1, freed: 1 });
});

test("입력 오류는 출력의 error 가 된다", async () => {
  const src = new PassThrough();
  const output = attachOpusOutput(src, { gain: 1, createEncoder: real });
  const failed = once(output, "error");
  src.write(sine(2));
  src.destroy(new Error("입력 끊김"));
  const [err] = await failed;
  assert.equal((err as Error).message, "입력 끊김");
});

test("인코딩 오류가 _read 안에서 나도 error 로 나오고 위쪽 스트림이 destroy 된다", async () => {
  const src = new PassThrough();
  const output = attachOpusOutput(src, {
    gain: 1,
    createEncoder: async () => ({
      encode: () => {
        throw new Error("인코딩 실패");
      },
      free: () => {},
    }),
  });
  const failed = once(output, "error");
  src.write(sine(3));
  output.read();
  const [err] = await failed;
  assert.equal((err as Error).message, "인코딩 실패");
  await new Promise((r) => setImmediate(r));
  assert.equal(src.destroyed, true);
});

test("인코더 생성 실패는 출력의 error 가 되고 위쪽 스트림이 destroy 된다", async () => {
  const src = new PassThrough();
  const output = attachOpusOutput(src, { gain: 1, createEncoder: () => Promise.reject(new Error("WASM 없음")) });
  const failed = once(output, "error");
  src.write(sine(1));
  const [err] = await failed;
  assert.equal((err as Error).message, "WASM 없음");
  await new Promise((r) => setImmediate(r));
  assert.equal(src.destroyed, true);
});

test("voice 리소스(StreamType.Opus)에서 read() 한 번이 패킷 하나이고 playbackDuration 이 20씩, 끝나면 묵음 다섯", async () => {
  const output = attachOpusOutput(chunked(sine(4), [65536]), { gain: 1, createEncoder: real });
  const resource = createAudioResource(output, { inputType: StreamType.Opus });
  assert.equal(resource.playStream, output);
  await once(output, "readable");
  const reads: Buffer[] = [];
  // AudioPlayer 처럼 readable 을 보며 읽는다(스트림이 끝나면 readable 이 묵음 다섯을 내는 동안 참이다)
  for (let i = 0; i < 60 && resource.readable; i++) {
    const p = resource.read();
    if (p) reads.push(p);
    else await new Promise((r) => setTimeout(r, 5));
  }
  const silence = Buffer.from([0xf8, 0xff, 0xfe]);
  const audio = reads.filter((p) => !p.equals(silence));
  assert.equal(audio.length, 4);
  assert.equal(resource.playbackDuration, 80);
  assert.equal(reads.length - audio.length, 5);
});
