/**
 * 재생 인코딩 스레드. 메인(media/encode-pool)이 보낸 20ms PCM 프레임에 볼륨 배율(gain)을 곱해 Opus 패킷으로 돌려준다.
 * 프레임마다 반드시 답한다(패킷이든 오류든). 메인은 보낸 것과 받은 것으로 지연 · 멈춤을 잰다.
 * 답은 한 차례(이벤트 루프 한 바퀴)에 처리한 것을 모아 메시지 하나로 보낸다. 밀릴수록 배치가 커져 메인의 메시지 비용이 준다.
 * media/opus-encoder 와 Node 내장만 부른다. logger 를 부르면 이 스레드에 파일 출력이 없는 sink 가 따로 생긴다(로그는 메인이 남긴다).
 *
 * 받는 것(parentPort): init · open · frame · close. 주는 것(init 때 받은 포트): ready · replies · load
 */
import { parentPort, type MessagePort } from "worker_threads";
import { createOpusEncoder, loadOpus, type OpusEncoder } from "./opus-encoder.ts";

type ToWorker = { type: "init"; port: MessagePort; calibrateFrames: number } | { type: "open"; id: number } | { type: "frame"; id: number; seq: number; gain: number; pcm: ArrayBuffer } | { type: "close"; id: number };
// 프레임 하나의 답. packet 이 없으면 error 다.
// doneAt: 답을 낸 때(timeOrigin + now, ms). 메인이 받기를 미룬 시간을 빼고 워커가 걸린 시간을 잰다.
// fatal: 이 스레드의 WASM 모듈이 망가졌다(abort). 메인이 스레드를 바꾼다
type Reply = { id: number; seq: number; doneAt: number; packet?: ArrayBuffer; error?: string; fatal?: boolean };
type FromWorker =
  | { type: "ready"; libopusVersion: string; frameUs: number }
  // 한 스트림의 답은 보낸 순서대로 들어 있다
  | { type: "replies"; items: Reply[] }
  // 지난 보고 뒤로 인코딩에 쓴 시간과 스레드 CPU 시간(µs), 살아 있는 인코더 수
  | { type: "load"; busyUs: number; cpuUs: number; encoders: number };

const FRAME_BYTES = 3840;
const LOAD_EVERY_MS = 1000;

type Frame = Extract<ToWorker, { type: "frame" }>;
// 인코더를 만드는 동안 온 프레임은 줄 세워 두고, 만든 뒤 차례대로 처리한다(답의 순서가 보낸 순서와 같게)
type Stream = { encoder: OpusEncoder | null; waiting: Frame[]; closed: boolean; failed: string | null };

const streams = new Map<number, Stream>();
let reply: MessagePort | null = null;
let busyUs = 0;
let lastCpu = 0;

let pending: Reply[] = [];
let transfer: ArrayBuffer[] = [];

function send(message: FromWorker) {
  reply?.postMessage(message);
}

let firstAt = 0;

// 모아 둔 답을 보낸다. 같은 바퀴에 처리한 메시지의 답이 함께 간다.
// doneAt 은 보낸 때로 찍는다(묶느라 늦춘 시간도 메인이 재는 응답 시간에 든다)
function flush() {
  if (!pending.length) return;
  const items = pending;
  const moved = transfer;
  pending = [];
  transfer = [];
  const at = doneAt();
  for (const item of items) item.doneAt = at;
  reply?.postMessage({ type: "replies", items } satisfies FromWorker, moved);
}

// 밀린 메시지를 한 바퀴에 다 처리하면 앞의 답이 그만큼 늦게 나간다. 배치는 이만큼까지만 붙잡는다
const BATCH_MS = 0.25;
const BATCH_MAX = 16;

function answer(item: Reply) {
  if (!pending.length) {
    firstAt = performance.now();
    setImmediate(flush);
  }
  pending.push(item);
  if (item.packet) transfer.push(item.packet);
  if (pending.length >= BATCH_MAX || performance.now() - firstAt >= BATCH_MS) flush();
}

const doneAt = () => performance.timeOrigin + performance.now();

function errorOf(id: number, seq: number, error: unknown) {
  // WASM abort 는 모듈 전체가 망가진 것이라 이 스레드의 다른 인코더도 믿을 수 없다.
  // WebAssembly.RuntimeError 는 lib(es2024)에 타입이 없어 이름으로 본다
  const fatal = error instanceof Error && error.name === "RuntimeError";
  answer({ id, seq, doneAt: doneAt(), error: error instanceof Error ? error.message : String(error), fatal });
}

function encode(stream: Stream, frame: Frame) {
  if (stream.failed || !stream.encoder) return errorOf(frame.id, frame.seq, new Error(stream.failed ?? "인코더가 없습니다"));
  const started = performance.now();
  try {
    if (frame.pcm.byteLength !== FRAME_BYTES) throw new RangeError(`프레임 크기 ${frame.pcm.byteLength}B(3840B 여야 한다)`);
    if (frame.gain !== 1) {
      // 볼륨 배율은 0 ~ 1 이라 범위를 넘지 않는다. Int16Array 에 넣을 때 소수는 0 쪽으로 잘린다
      const samples = new Int16Array(frame.pcm);
      for (let i = 0; i < samples.length; i++) samples[i] *= frame.gain;
    }
    const packet = stream.encoder.encode(Buffer.from(frame.pcm));
    // encode 가 돌려준 것은 WASM 힙의 복사본이라 그 ArrayBuffer 를 그대로 넘겨도 된다
    const owned = packet.byteOffset === 0 && packet.byteLength === packet.buffer.byteLength ? (packet.buffer as ArrayBuffer) : packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength);
    answer({ id: frame.id, seq: frame.seq, doneAt: doneAt(), packet: owned as ArrayBuffer });
  } catch (error) {
    errorOf(frame.id, frame.seq, error);
  } finally {
    busyUs += (performance.now() - started) * 1000;
  }
}

function open(id: number) {
  const stream: Stream = { encoder: null, waiting: [], closed: false, failed: null };
  streams.set(id, stream);
  createOpusEncoder().then(
    (encoder) => {
      // 만드는 동안 닫혔으면 만든 것을 바로 해제한다
      if (stream.closed) return encoder.free();
      stream.encoder = encoder;
      for (const frame of stream.waiting.splice(0)) encode(stream, frame);
    },
    (error: unknown) => {
      stream.failed = error instanceof Error ? error.message : String(error);
      if (stream.closed) return;
      for (const frame of stream.waiting.splice(0)) errorOf(frame.id, frame.seq, error);
    },
  );
}

function frameIn(frame: Frame) {
  const stream = streams.get(frame.id);
  if (!stream) return errorOf(frame.id, frame.seq, new Error("열리지 않은 스트림"));
  if (!stream.encoder && !stream.failed) return void stream.waiting.push(frame);
  encode(stream, frame);
}

function close(id: number) {
  const stream = streams.get(id);
  if (!stream) return;
  streams.delete(id);
  stream.closed = true;
  stream.waiting.length = 0;
  stream.encoder?.free();
  stream.encoder = null;
}

// 기동 시 한 번: 모듈을 불러 두고 프레임 하나를 인코딩하는 데 드는 시간을 잰다(메인이 처음 워커 수를 정하는 데 쓴다)
async function init(port: MessagePort, calibrateFrames: number) {
  reply = port;
  const { libopusVersion } = await loadOpus();
  let frameUs = 0;
  if (calibrateFrames > 0) {
    const encoder = await createOpusEncoder();
    const pcm = Buffer.alloc(FRAME_BYTES);
    for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.round(8000 * Math.sin(i / 37)), i);
    encoder.encode(pcm);
    const started = performance.now();
    for (let i = 0; i < calibrateFrames; i++) encoder.encode(pcm);
    frameUs = ((performance.now() - started) * 1000) / calibrateFrames;
    encoder.free();
  }
  lastCpu = cpuNow();
  send({ type: "ready", libopusVersion, frameUs });
  setInterval(() => {
    const cpu = cpuNow();
    send({ type: "load", busyUs: Math.round(busyUs), cpuUs: Math.round(cpu - lastCpu), encoders: streams.size });
    busyUs = 0;
    lastCpu = cpu;
  }, LOAD_EVERY_MS).unref();
}

// 이 스레드가 실제로 CPU 를 쓴 시간(µs). 실제 경과 시간(wall-clock)으로 재는 ELU 는 코어를 다른 데 뺏긴 시간도 바쁨으로 센다
function cpuNow() {
  const used = process.threadCpuUsage();
  return used.user + used.system;
}

parentPort?.on("message", (message: ToWorker) => {
  switch (message.type) {
    case "init":
      init(message.port, message.calibrateFrames).catch((error: unknown) => {
        // 모듈을 불러오지 못했다. 스레드를 오류로 끝내 메인(Worker 의 error)이 기동 실패로 받게 한다
        process.nextTick(() => {
          throw error;
        });
      });
      return;
    case "open":
      return open(message.id);
    case "frame":
      return frameIn(message);
    case "close":
      return close(message.id);
  }
});

export type { ToWorker, FromWorker, Reply };
