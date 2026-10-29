// src/media/encode-worker.ts: 메인이 보낸 PCM 프레임에 볼륨 배율(gain)을 곱해 Opus 패킷으로 돌려주는 인코딩 스레드
//
// 지키는 것: 기동하면 libopus 버전과 프레임 하나의 인코딩 시간을 알린다. 프레임마다 반드시 답하고(패킷이든 오류든),
// 한 스트림의 답은 보낸 순서대로 온다(인코더를 만드는 동안 온 프레임도). 한 차례에 처리한 답은 메시지 하나로 묶인다. 볼륨 배율이 소리에 걸린다.
// 크기가 틀린 프레임 · 열리지 않은 스트림은 그 프레임만 오류로 답하고 스트림은 이어진다. 생성 중에 닫아도 스레드가 멀쩡하다.
// 1초마다 인코딩에 쓴 시간 · 스레드 CPU 시간 · 인코더 수를 보고한다.

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
function frame(amplitude = 12000) {
  const buf = Buffer.alloc(FRAME_BYTES);
  for (let i = 0, t = 0; i < buf.length; i += 4, t++) {
    const v = Math.round(amplitude * Math.sin((2 * Math.PI * 440 * t) / 48000));
    buf.writeInt16LE(v, i);
    buf.writeInt16LE(v, i + 2);
  }
  return buf.buffer;
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

test("열리지 않은 스트림 · 닫힌 스트림의 프레임은 오류로 답한다", async () => {
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

test("1초마다 인코딩 시간 · 스레드 CPU 시간 · 인코더 수를 보고한다", async () => {
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
