// 시험용 인코딩 워커: libopus 없이 규약만 흉내 낸다. 프레임마다 8바이트 가짜 패킷으로 답하고,
// 배율이 -2 인 프레임에는 WASM 이 망가졌다는 오류(fatal)로 답한다
import { parentPort, type MessagePort } from "worker_threads";
import type { FromWorker, ToWorker } from "../../src/media/encode-worker.ts";

let reply: MessagePort | null = null;
const send = (message: FromWorker) => reply?.postMessage(message);

parentPort?.on("message", (m: ToWorker) => {
  if (m.type === "init") {
    reply = m.port;
    send({ type: "ready", libopusVersion: "stub", frameUs: 0 });
    return;
  }
  if (m.type !== "frame") return;
  const doneAt = performance.timeOrigin + performance.now();
  if (m.gain === -2) send({ type: "error", id: m.id, seq: m.seq, message: "unreachable", fatal: true, doneAt });
  else send({ type: "packet", id: m.id, seq: m.seq, packet: new ArrayBuffer(8), doneAt });
});
