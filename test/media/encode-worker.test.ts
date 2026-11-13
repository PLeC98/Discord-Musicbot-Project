// src/media/encode-worker.ts: 메인이 보낸 PCM 프레임(f32le)에 볼륨 배율(gain)을 곱해 Opus 패킷으로 돌려주는 인코딩 스레드
//
// 지키는 것: 기동하면 libopus 버전과 프레임 하나의 인코딩 시간을 알린다. 프레임마다 반드시 답하고(패킷이든 오류든),
// 한 스트림의 답은 보낸 순서대로 온다(인코더를 만드는 동안 온 프레임도). 한 차례에 처리한 답은 메시지 하나로 묶인다. 볼륨 배율이 소리에 걸린다.
// 깨진 샘플(NaN, 무한대, 터무니없이 큰 값)은 0 이 되어 그 뒤 프레임을 망치지 않고, ±1 을 넘는 샘플은 막힌다.
// 크기가 틀린 프레임, 열리지 않은 스트림은 그 프레임만 오류로 답하고 스트림은 이어진다. 생성 중에 닫아도 스레드가 멀쩡하다.
// 1초마다 인코딩에 쓴 시간, 스레드 CPU 시간, 인코더 수, GC를 보고한다.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Worker, MessageChannel, type MessagePort } from "worker_threads";
import { createDecoder } from "libopus-wasm";
import { FRAME_BYTES } from "../../src/media/audio-splicer.ts";
import type { FromWorker, Reply, ToWorker } from "../../src/media/encode-worker.ts";

// 묶여 온 답은 하나씩 풀어 둔다
type In = Exclude<FromWorker, { type: "replies" }> | ({ type: "packet"; packet: ArrayBuffer } & Reply) | ({ type: "error" } & Reply);

let worker: Worker;
let port: MessagePort;
let ready: Extract<In, { type: "ready" }>;
const inbox: In[] = [];
let batches = 0;
let wake: (() => void) | null = null;

function post(message: ToWorker, transfer: ArrayBuffer[] = []) {
  worker.postMessage(message, transfer);
}

// 조건에 맞는 답이 count 개 모일 때까지 기다려 꺼낸다
async function take<T extends In>(match: (m: In) => m is T, count = 1, timeoutMs = 5000): Promise<T[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = inbox.filter(match);
    if (found.length >= count) {
      const picked = found.slice(0, count);
      for (const m of picked) inbox.splice(inbox.indexOf(m), 1);
      return picked;
    }
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`답 ${count}개를 기다리다 시간 초과(받은 것 ${found.length}개)`);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, left);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}

const packetOf =
  (id: number) =>
  (m: In): m is Extract<In, { type: "packet" }> =>
    m.type === "packet" && m.id === id;
const errorOf =
  (id: number) =>
  (m: In): m is Extract<In, { type: "error" }> =>
    m.type === "error" && m.id === id;
const answerOf =
  (id: number) =>
  (m: In): m is Extract<In, { type: "packet" | "error" }> =>
    (m.type === "packet" || m.type === "error") && m.id === id;
const isLoad = (m: In): m is Extract<In, { type: "load" }> => m.type === "load";

// 진폭이 일정한 사인파 프레임 하나(자기 ArrayBuffer 를 가진다. 넘기면 메인 쪽은 비워진다)
function frame(amplitude = 0.37, at = (v: number, _i: number) => v) {
  const samples = new Float32Array(FRAME_BYTES / 4);
  for (let i = 0; i < samples.length; i += 2) {
    const v = at(amplitude * Math.sin((2 * Math.PI * 440 * (i / 2)) / 48000), i);
    samples[i] = v;
    samples[i + 1] = v;
  }
  return samples.buffer;
}

function sendFrame(id: number, seq: number, gain = 1, pcm = frame()) {
  post({ type: "frame", id, seq, gain, pcm }, [pcm]);
}

async function rmsOf(packets: ArrayBuffer[]) {
  const dec = await createDecoder({ sampleRate: 48000, channels: 2 });
  const out = packets.map((p) => {
    const pcm = dec.decode(new Uint8Array(p));
    let s = 0;
    for (const v of pcm) s += v * v;
    return Math.sqrt(s / pcm.length);
  });
  dec.free();
  return out;
}

before(async () => {
  worker = new Worker(new URL("../../src/media/encode-worker.ts", import.meta.url));
  const channel = new MessageChannel();
  port = channel.port1;
  port.on("message", (m: FromWorker) => {
    if (m.type !== "replies") inbox.push(m);
    else {
      batches++;
      for (const item of m.items) inbox.push(item.packet ? { ...item, type: "packet", packet: item.packet } : { ...item, type: "error" });
    }
    wake?.();
  });
  worker.postMessage({ type: "init", port: channel.port2, calibrateFrames: 20 } satisfies ToWorker, [channel.port2]);
  [ready] = await take((m): m is Extract<In, { type: "ready" }> => m.type === "ready");
});

after(async () => {
  port.close();
  await worker.terminate();
});

test("기동하면 libopus 버전과 프레임 하나의 인코딩 시간을 알린다", () => {
  assert.match(ready.libopusVersion, /libopus/);
  assert.ok(ready.frameUs > 0 && ready.frameUs < 100_000, `frameUs ${ready.frameUs}`);
});

test("열자마자 보낸 프레임도 보낸 순서대로 패킷이 되고, 볼륨 배율이 소리에 걸린다", async () => {
  const id = 1;
  const before = batches;
  post({ type: "open", id });
  for (let seq = 0; seq < 20; seq++) sendFrame(id, seq, 1);
  for (let seq = 20; seq < 40; seq++) sendFrame(id, seq, 0.25);
  const packets = await take(packetOf(id), 40);
  assert.ok(batches - before < 40, `답 메시지 ${batches - before}개`);
  assert.deepEqual(
    packets.map((p) => p.seq),
    Array.from({ length: 40 }, (_, i) => i),
  );
  const rms = await rmsOf(packets.map((p) => p.packet));
  const loud = rms.slice(5, 20).reduce((a, b) => a + b) / 15;
  const quiet = rms.slice(25).reduce((a, b) => a + b) / 15;
  assert.ok(Math.abs(quiet / loud - 0.25) < 0.05, `배율 ${quiet / loud}`);
  post({ type: "close", id });
});

test("깨진 샘플은 0 으로 보고 그 뒤 프레임을 망치지 않으며, ±1 을 넘는 샘플은 막는다", async () => {
  const id = 7;
  post({ type: "open", id });
  for (let seq = 0; seq < 10; seq++) sendFrame(id, seq);
  // 깨진 값만 든 프레임 셋. 막기로만 다루면 최대 크기의 소리가 된다. NaN 이 든 프레임은 libopus 가 스스로 무음으로 내므로 따로 본다
  const broken = [Infinity, -Infinity, 1e30, -1e30];
  for (let seq = 10; seq < 13; seq++)
    sendFrame(
      id,
      seq,
      1,
      frame(0, (_v, i) => broken[Math.floor(i / 200) % broken.length] as number),
    );
  sendFrame(
    id,
    13,
    1,
    frame(0.37, (v, i) => (i % 50 === 0 ? NaN : v)),
  );
  for (let seq = 14; seq < 20; seq++) sendFrame(id, seq);
  // 배율로 ±1 을 넘긴 프레임은 막혀 원래 크기의 몇 배가 되지 못한다
  for (let seq = 20; seq < 30; seq++) sendFrame(id, seq, 10);
  const rms = await rmsOf((await take(packetOf(id), 30)).map((p) => p.packet));
  assert.ok(rms.every(Number.isFinite), `rms ${rms.join(", ")}`);
  const steady = rms.slice(5, 10).reduce((a, b) => a + b) / 5;
  assert.ok((rms[11] as number) < steady * 0.1, `깨진 프레임 ${rms[11]}, 평소 ${steady}`);
  const after = rms.slice(15, 20).reduce((a, b) => a + b) / 5;
  assert.ok(Math.abs(after / steady - 1) < 0.1, `깨진 프레임 뒤 ${after / steady}`);
  const loud = rms.slice(25).reduce((a, b) => a + b) / 5;
  assert.ok(loud / steady < 5, `배율 10 에서 ${loud / steady}`);
  post({ type: "close", id });
});

test("크기가 틀린 프레임은 그 프레임만 오류로 답하고 스트림은 이어진다", async () => {
  const id = 2;
  post({ type: "open", id });
  sendFrame(id, 0);
  sendFrame(id, 1, 1, new ArrayBuffer(100));
  sendFrame(id, 2);
  const answers = await take(answerOf(id), 3);
  assert.deepEqual(
    answers.map((a) => [a.type, a.seq]),
    [
      ["packet", 0],
      ["error", 1],
      ["packet", 2],
    ],
  );
  const error = answers[1] as Extract<In, { type: "error" }>;
  assert.equal(error.fatal, false);
  assert.match(error.error ?? "", /100B/);
  post({ type: "close", id });
});

test("열리지 않은 스트림, 닫힌 스트림의 프레임은 오류로 답한다", async () => {
  sendFrame(99, 7);
  const [unknown] = await take(errorOf(99));
  assert.equal(unknown?.seq, 7);
  assert.equal(unknown?.fatal, false);
  assert.ok(unknown?.error);

  const id = 3;
  post({ type: "open", id });
  sendFrame(id, 0);
  await take(packetOf(id));
  post({ type: "close", id });
  sendFrame(id, 1);
  const [closed] = await take(errorOf(id));
  assert.equal(closed?.seq, 1);
});

test("인코더를 만드는 동안 닫아도 스레드가 멀쩡하고, 같은 id 로 다시 열 수 있다", async () => {
  const id = 4;
  post({ type: "open", id });
  sendFrame(id, 0);
  post({ type: "close", id });
  post({ type: "open", id });
  sendFrame(id, 1);
  // 닫기 전 프레임은 인코더가 그 사이 만들어졌으면 패킷이 되고 아니면 버려진다(닫은 쪽은 답을 기다리지 않는다)
  const [first] = await take(answerOf(id));
  const answer = first?.seq === 0 ? (await take(answerOf(id)))[0] : first;
  assert.equal(first?.type, "packet");
  assert.deepEqual([answer?.type, answer?.seq], ["packet", 1]);
  post({ type: "close", id });
});

test("1초마다의 보고에 이 스레드의 GC 횟수와 멈춘 시간(합, 최대)이 실린다", async () => {
  const id = 6;
  post({ type: "open", id });
  // 프레임마다 버퍼를 새로 만들어 GC가 돌게 한다
  for (let seq = 0; seq < 3000; seq++) sendFrame(id, seq);
  await take(packetOf(id), 3000, 20_000);
  inbox.splice(0, inbox.length, ...inbox.filter((m) => !isLoad(m)));
  const loads = await take(isLoad, 2, 3000);
  const gc = loads.reduce((sum, l) => sum + l.gcCount, 0);
  assert.ok(gc > 0, JSON.stringify(loads));
  for (const l of loads) assert.ok(l.gcMs >= l.gcMaxMs && l.gcMaxMs >= 0 && (l.gcCount > 0 || l.gcMs === 0), JSON.stringify(l));
  post({ type: "close", id });
});

test("1초마다 인코딩 시간, 스레드 CPU 시간, 인코더 수를 보고한다", async () => {
  const id = 5;
  post({ type: "open", id });
  for (let seq = 0; seq < 10; seq++) sendFrame(id, seq);
  await take(packetOf(id), 10);
  // 인코딩이 들어간 보고를 찾는다(앞선 테스트의 보고가 섞여 있을 수 있다)
  inbox.splice(0, inbox.length, ...inbox.filter((m) => !isLoad(m)));
  const [load] = await take(isLoad, 1, 3000);
  assert.ok(load);
  assert.equal(load.encoders, 1);
  assert.ok(load.cpuUs >= 0);
  post({ type: "close", id });
  const later = await take(isLoad, 1, 3000);
  assert.equal(later[0]?.encoders, 0);
});
