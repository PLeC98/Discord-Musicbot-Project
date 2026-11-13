// src/media/opus-output.ts: PCM 을 20ms 프레임으로 모아 인코딩 세션에 보내고 Opus 패킷을 내주는 출력 스트림
//
// 지키는 것: 청크 크기와 상관없이 20ms 프레임(f32le 7680바이트) 하나가 패킷 하나가 되고, 패킷은 Buffer 로 한 번에 하나씩 나온다.
// 미리 만드는 것은 세션의 큐 깊이까지다(보낸 것 + 받아 둔 것 + 읽는 쪽 버퍼). 읽지 않으면 받은 청크의 callback 이 미뤄진다.
// 볼륨은 바꾼 뒤 큐 깊이 + 2 패킷 안에 들린다(바꾼 프레임 안에서 게인을 램프한다). read() 는 와 있는 패킷을 그 자리에서 받는다(_read 가 한 번 빈손이었어도).
// 세션은 정확히 한 번 해제한다. 끝나면 end 를 내고, 입력 오류, 세션 오류는 출력 스트림의 error 가 되며 위쪽 스트림까지 destroy 된다.
// voice 의 실제 리소스(StreamType.Opus)에서 read() 한 번이 패킷 하나이고 playbackDuration 이 20씩 오른다.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Readable } from "stream";
import { once } from "events";
import { createAudioResource, StreamType } from "@discordjs/voice";
import { createDecoder } from "libopus-wasm";
import { OpusOutput, attachOpusOutput, type OpenEncoder } from "../../src/media/opus-output.ts";
import { EncodePool, type SessionHooks } from "../../src/media/encode-pool.ts";
import { createOpusEncoder } from "../../src/media/opus-encoder.ts";
import { FRAME_BYTES } from "../../src/media/audio-splicer.ts";
import { Limiter } from "../../src/media/limiter.ts";

const pool = new EncodePool({ calibrateFrames: 0 });
after(() => pool.close());
const real: OpenEncoder = (hooks) => pool.open(hooks);

// 실제 세션의 해제 횟수를 센다
function counted() {
  const stats = { opened: 0, freed: 0 };
  const open: OpenEncoder = (hooks) => {
    const session = pool.open(hooks);
    stats.opened++;
    return {
      get depth() {
        return session.depth;
      },
      send: (frame, gain) => session.send(frame, gain),
      drain: () => session.drain(),
      late: () => session.late(),
      underrun: () => session.underrun(),
      describe: () => session.describe(),
      free: () => {
        stats.freed++;
        session.free();
      },
    };
  };
  return { open, stats };
}

// 패킷을 손으로 주는 가짜 세션: read() 의 drain 때만 준다. hold 면 워커가 늦은 것처럼 주지 않는다
function manual(depth = 2) {
  const stats = { sent: 0, late: 0, underrun: 0, freed: 0 };
  const control = { hold: false };
  let hooks: SessionHooks | null = null;
  let queued = 0;
  const deliver = () => {
    for (; queued > 0 && !control.hold; queued--) hooks?.onPacket(Buffer.alloc(320, 1));
  };
  const open: OpenEncoder = (h) => {
    hooks = h;
    return {
      depth,
      send: () => {
        stats.sent++;
        queued++;
      },
      drain: deliver,
      late: () => stats.late++,
      underrun: () => stats.underrun++,
      free: () => stats.freed++,
      describe: () => ({ worker: null, oldestMs: null }),
    };
  };
  return { open, stats, control, fail: (error: Error) => hooks?.onError(error) };
}

// 진폭이 일정한 사인파(왼쪽, 오른쪽 같음). 진폭은 디코더가 내는 16비트 정수의 크기로 적는다
function sine(frames: number, amplitude = 12000) {
  const buf = Buffer.alloc(frames * FRAME_BYTES);
  for (let i = 0, t = 0; i < buf.length; i += 8, t++) {
    const v = (amplitude / 32768) * Math.sin((2 * Math.PI * 440 * t) / 48000);
    buf.writeFloatLE(v, i);
    buf.writeFloatLE(v, i + 4);
  }
  return buf;
}

// 주어진 크기들로 잘라 내보내는 소스
function chunked(buf: Buffer, sizes: number[]) {
  const parts: Buffer[] = [];
  for (let o = 0, i = 0; o < buf.length; i++) {
    const n = sizes[i % sizes.length] ?? buf.length;
    parts.push(buf.subarray(o, o + n));
    o += n;
  }
  return Readable.from(parts, { objectMode: false });
}

// 프레임 크기 청크로 써 넣는 소스(스플라이서처럼)
function framed(frames: number, src = new PassThrough()) {
  const pcm = sine(frames);
  for (let o = 0; o < pcm.length; o += FRAME_BYTES) src.write(pcm.subarray(o, o + FRAME_BYTES));
  return src;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ahead = (output: OpusOutput) => {
  const d = output.describe();
  return d.inflight + d.ready + d.frames;
};

test("청크가 프레임 크기와 같아도(스플라이서) 읽지 않으면 큐 깊이 + 1 프레임까지만 미리 만든다", async () => {
  const src = new PassThrough();
  const output = attachOpusOutput(src, { gain: 1, openEncoder: real });
  framed(200, src);
  await sleep(100);
  const d = output.describe();
  assert.ok(ahead(output) <= d.depth + 1, `미리 만든 것 ${JSON.stringify(d)}`);
  output.destroy();
});

test("청크 크기와 상관없이 20ms 프레임 하나가 Buffer 패킷 하나가 된다(1바이트, 홀수 크기 포함)", async () => {
  for (const sizes of [[1], [3, 7, 4093], [FRAME_BYTES], [65536]]) {
    const output = attachOpusOutput(chunked(sine(10), sizes), { gain: 1, openEncoder: real });
    const packets = await readAll(output);
    assert.equal(packets.length, 10, `청크 ${sizes.join(",")}`);
    for (const p of packets) assert.ok(Buffer.isBuffer(p) && p.length > 0);
  }
});

test("끝에 남은 20ms 미만은 버리고 end 를 낸다", async () => {
  const pcm = Buffer.concat([sine(3), Buffer.alloc(FRAME_BYTES - 4)]);
  const packets = await readAll(attachOpusOutput(chunked(pcm, [5000]), { gain: 1, openEncoder: real }));
  assert.equal(packets.length, 3);
});

test("쓰기 없이 끝나도 end 를 낸다", async () => {
  const packets = await readAll(attachOpusOutput(Readable.from([], { objectMode: false }), { gain: 1, openEncoder: real }));
  assert.equal(packets.length, 0);
});

test("볼륨 게인을 곱해 인코딩하고, 곡 중간 setVolume 은 큐 깊이 + 2 패킷 안에 먹는다", async () => {
  const output = attachOpusOutput(chunked(sine(60), [65536]), { gain: 1, openEncoder: real });
  const packets: Buffer[] = [];
  let depth = 0;
  for await (const p of output) {
    packets.push(p as Buffer);
    if (packets.length === 30) {
      depth = output.describe().depth;
      output.setVolume(0.25);
    }
  }
  const rms = await rmsOf(packets);
  const loud = rms.slice(10, 28).reduce((a, b) => a + b) / 18;
  const quiet = rms.slice(40).reduce((a, b) => a + b) / (rms.length - 40);
  // 0.25 배면 RMS 도 약 0.25 배(Opus 손실 때문에 정확하지 않다)
  assert.ok(Math.abs(quiet / loud - 0.25) < 0.05, `비율 ${(quiet / loud).toFixed(3)}`);
  // 30번째를 받은 뒤 바꿨다. 이미 보낸 큐 깊이만큼은 이전 크기다. 그다음 프레임 안에서 게인을 램프하고, 디코더가 앞 프레임과 겹쳐 디코딩하므로 하나가 더 섞여 나온다
  assert.ok(rms[29] > loud * 0.8, `30번째 패킷 RMS ${rms[29]}`);
  const heard = 30 + depth + 2;
  assert.ok(rms[heard] < loud * 0.35, `${heard + 1}번째 패킷 RMS ${rms[heard]}(큐 깊이 ${depth})`);
});

test("처음 볼륨은 첫 패킷부터 먹는다(만든 뒤 한참 기다렸다 읽어도 앞서 인코딩된 큰 소리가 없다)", async () => {
  const output = attachOpusOutput(chunked(sine(60), [65536]), { gain: 0.1, openEncoder: real });
  await sleep(200);
  const packets = await readAll(output);
  const rms = await rmsOf(packets);
  const full = 12000 / Math.SQRT2;
  // 첫 패킷은 디코더가 앞 소리 없이 시작해 작다. 둘째부터
  for (const [i, r] of rms.slice(1).entries()) assert.ok(r < full * 0.15, `${i + 2}번째 패킷 RMS ${r}`);
});

test("볼륨 게인 1 이면 리미터의 지연만큼 늦춘 입력과 같은 패킷이다(리미터를 끈 서버는 소리를 바꾸지 않는다)", async () => {
  const pcm = sine(5);
  const a = await readAll(attachOpusOutput(chunked(pcm, [4000]), { gain: 1, openEncoder: real }));
  const delayed = Buffer.concat([Buffer.alloc(new Limiter().delaySamples * 8), pcm]);
  const enc = await createOpusEncoder();
  const b = Array.from({ length: 5 }, (_, i) => enc.encode(new Float32Array(delayed.buffer.slice(delayed.byteOffset + i * FRAME_BYTES, delayed.byteOffset + (i + 1) * FRAME_BYTES))));
  enc.free();
  assert.deepEqual(a, b);
});

test("볼륨 게인은 1 위로도 걸리고 넘치는 샘플은 ±1 로 클립된다", async () => {
  const quiet = await rmsOf(await readAll(attachOpusOutput(chunked(sine(20, 3000), [65536]), { gain: 1, openEncoder: real })));
  const raised = await rmsOf(await readAll(attachOpusOutput(chunked(sine(20, 3000), [65536]), { gain: 2, openEncoder: real })));
  const clipped = await rmsOf(await readAll(attachOpusOutput(chunked(sine(20, 12000), [65536]), { gain: 10, openEncoder: real })));
  const mean = (r: number[]) => r.slice(5).reduce((x, y) => x + y) / (r.length - 5);
  assert.ok(Math.abs(mean(raised) / mean(quiet) - 2) < 0.1, `게인 2: ${mean(raised) / mean(quiet)}`);
  assert.ok(mean(clipped) < 32768 * 1.01, `게인 10: ${mean(clipped)}`);
  assert.ok(mean(clipped) > 12000 * 2, `게인 10 이 곱해지지 않았다: ${mean(clipped)}`);
});

test("읽지 않으면 큐 깊이를 넘겨 보내지 않고 받은 청크의 callback 이 미뤄진다. 읽으면 이어 간다", async () => {
  const output = new OpusOutput({ gain: 1, openEncoder: real });
  let written = false;
  output.write(sine(20), () => {
    written = true;
  });
  await sleep(50);
  const d = output.describe();
  assert.ok(d.inflight + d.ready <= d.depth, JSON.stringify(d));
  assert.equal(written, false);
  let n = 0;
  for (let i = 0; i < 200 && n < 20; i++) {
    if (output.read()) n++;
    else await sleep(2);
  }
  assert.equal(n, 20);
  assert.equal(written, true);
  output.destroy();
});

test("_read 가 한 번 빈손으로 끝나도 다음 read() 가 와 있는 패킷을 그 자리에서 받는다", () => {
  const enc = manual();
  const output = new OpusOutput({ gain: 1, openEncoder: enc.open });
  output.write(sine(4));
  assert.equal(enc.stats.sent, 2);
  // 아직 아무것도 오지 않았다: 빈손
  enc.control.hold = true;
  assert.equal(output.read(), null);
  enc.control.hold = false;
  // 이벤트 루프를 돌리지 않고 읽는다. drain 이 주는 패킷이 바로 나온다
  const packet: unknown = output.read();
  assert.ok(Buffer.isBuffer(packet));
  output.destroy();
});

test("보낸 것은 있는데 받은 패킷이 없어 빈손으로 읽히면 세션에 지연을 알린다(첫 패킷 전은 세지 않는다)", () => {
  const before = manual();
  before.control.hold = true;
  const first = new OpusOutput({ gain: 1, openEncoder: before.open });
  first.write(sine(10));
  assert.equal(first.read(), null);
  assert.equal(before.stats.late, 0);
  first.destroy();

  const enc = manual();
  const output = new OpusOutput({ gain: 1, openEncoder: enc.open });
  output.write(sine(10));
  assert.ok(Buffer.isBuffer(output.read()));
  enc.control.hold = true;
  // 받아 둔 것은 아직 내준다
  assert.ok(Buffer.isBuffer(output.read()));
  assert.equal(enc.stats.late, 0);
  assert.equal(output.read(), null);
  assert.equal(enc.stats.late, 1);
  // read(0) 은 Node 안쪽의 채우기라 세지 않는다
  output.read(0);
  assert.equal(enc.stats.late, 1);
  output.destroy();
});

test("보낸 것이 다 돌아온 뒤 입력이 끊긴 채 빈손으로 읽히면 지연이 아니라 언더런으로 센다(끝내는 중은 세지 않는다)", () => {
  const enc = manual();
  const output = new OpusOutput({ gain: 1, openEncoder: enc.open });
  output.write(sine(2));
  assert.ok(Buffer.isBuffer(output.read()));
  assert.ok(Buffer.isBuffer(output.read()));
  assert.equal(output.read(), null);
  assert.deepEqual([enc.stats.late, enc.stats.underrun], [0, 1]);
  output.end();
  output.read();
  assert.deepEqual([enc.stats.late, enc.stats.underrun], [0, 1]);
  output.destroy();
});

test("destroy 하면 세션을 정확히 한 번 해제한다(끝까지 읽고 끝나도, 중간에 destroy 해도, 만들자마자 destroy 해도)", async () => {
  const done = counted();
  await readAll(attachOpusOutput(chunked(sine(5), [3000]), { gain: 1, openEncoder: done.open }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(done.stats, { opened: 1, freed: 1 });

  const cut = counted();
  const output = attachOpusOutput(chunked(sine(50), [3000]), { gain: 1, openEncoder: cut.open });
  await once(output, "readable");
  output.destroy();
  output.destroy();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(cut.stats, { opened: 1, freed: 1 });

  const early = counted();
  new OpusOutput({ gain: 1, openEncoder: early.open }).destroy();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(early.stats, { opened: 1, freed: 1 });
});

test("입력 오류는 출력 스트림의 error 가 된다", async () => {
  const src = new PassThrough();
  const output = attachOpusOutput(src, { gain: 1, openEncoder: real });
  const failed = once(output, "error");
  src.write(sine(2));
  src.destroy(new Error("입력 끊김"));
  const [err] = await failed;
  assert.equal((err as Error).message, "입력 끊김");
});

test("세션 오류가 read() 안의 drain 에서 와도 error 로 나오고 위쪽 스트림이 destroy 된다", async () => {
  const src = new PassThrough();
  const enc = manual();
  const open: OpenEncoder = (hooks) => {
    const session = enc.open(hooks);
    return { ...session, depth: 2, drain: () => hooks.onError(new Error("인코딩 실패")) };
  };
  const output = attachOpusOutput(src, { gain: 1, openEncoder: open });
  const failed = once(output, "error");
  src.write(sine(3));
  await sleep(10);
  assert.equal(output.read(), null);
  const [err] = await failed;
  assert.equal((err as Error).message, "인코딩 실패");
  await new Promise((r) => setImmediate(r));
  assert.equal(src.destroyed, true);
});

test("세션이 쓸 수 없다고 알리면 출력 스트림의 error 가 되고 위쪽 스트림이 destroy 된다", async () => {
  const src = new PassThrough();
  const enc = manual();
  const output = attachOpusOutput(src, { gain: 1, openEncoder: enc.open });
  const failed = once(output, "error");
  enc.fail(new Error("쓸 수 있는 재생 인코딩 워커가 없습니다"));
  const [err] = await failed;
  assert.match((err as Error).message, /워커가 없습니다/);
  await new Promise((r) => setImmediate(r));
  assert.equal(src.destroyed, true);
});

test("voice 리소스(StreamType.Opus)에서 read() 한 번이 패킷 하나이고 playbackDuration 이 20씩, 끝나면 무음 다섯", async () => {
  const output = attachOpusOutput(chunked(sine(4), [65536]), { gain: 1, openEncoder: real });
  const resource = createAudioResource(output, { inputType: StreamType.Opus });
  assert.equal(resource.playStream, output);
  await once(output, "readable");
  const reads: Buffer[] = [];
  // AudioPlayer 처럼 readable 을 보며 읽는다(스트림이 끝나면 readable 이 무음 다섯을 내는 동안 참이다)
  for (let i = 0; i < 60 && resource.readable; i++) {
    const p = resource.read();
    if (p) reads.push(p);
    else await sleep(5);
  }
  const silence = Buffer.from([0xf8, 0xff, 0xfe]);
  const audio = reads.filter((p) => !p.equals(silence));
  assert.equal(audio.length, 4);
  assert.equal(resource.playbackDuration, 80);
  assert.equal(reads.length - audio.length, 5);
});
