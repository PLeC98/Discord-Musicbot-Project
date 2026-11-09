// 테스트용 인코딩 워커: libopus 없이 규약만 흉내 낸다. 프레임마다 8바이트 가짜 패킷으로 답하고,
// 볼륨 배율(gain)이 -2 인 프레임에는 WASM 이 망가졌다는 오류(fatal)로 답하고, 1 보다 크면 그 ms 만큼 멈췄다가 답한다(느린 워커).
// 테스트가 환경 변수로 정하면 ready 에 프레임당 시간(STUB_ENCODE_FRAME_US, 늘리기 판단용)을 싣고, 늘린 워커는 ready 를 STUB_ENCODE_GROW_READY_MS 만큼 늦춘다.
// STUB_ENCODE_GC(JSON, gcCount, gcMs, gcMaxMs)가 있으면 그 GC 를 담은 load 를 STUB_ENCODE_LOAD_MS(기본 1000)마다 보낸다
import { parentPort, type MessagePort } from "worker_threads";
import type { FromWorker, ToWorker } from "../../src/media/encode-worker.ts";

let reply: MessagePort | null = null;
const send = (message: FromWorker) => reply?.postMessage(message);

parentPort?.on("message", (m: ToWorker) => {
  if (m.type === "init") {
    reply = m.port;
    const ready = () => send({ type: "ready", libopusVersion: "stub", frameUs: Number(process.env.STUB_ENCODE_FRAME_US ?? 0) });
    const late = Number(process.env.STUB_ENCODE_GROW_READY_MS ?? 0);
    // 늘린 워커는 재지 않는다(calibrateFrames 0)
    if (m.calibrateFrames === 0 && late > 0) setTimeout(ready, late);
    else ready();
    const gc = process.env.STUB_ENCODE_GC;
    if (gc) setInterval(() => send({ type: "load", busyUs: 0, cpuUs: 0, encoders: 0, ...(JSON.parse(gc) as { gcCount: number; gcMs: number; gcMaxMs: number }) }), Number(process.env.STUB_ENCODE_LOAD_MS ?? 1000)).unref();
    return;
  }
  if (m.type !== "frame") return;
  // 바쁜 대기로 잰다(Atomics.wait 는 Windows 에서 15.6ms 단위로 늘어난다)
  for (const until = performance.now() + m.gain; m.gain > 1 && performance.now() < until;) continue;
  const doneAt = performance.timeOrigin + performance.now();
  if (m.gain === -2) return send({ type: "replies", items: [{ id: m.id, seq: m.seq, doneAt, error: "unreachable", fatal: true }] });
  const packet = new ArrayBuffer(8);
  reply?.postMessage({ type: "replies", items: [{ id: m.id, seq: m.seq, doneAt, packet }] } satisfies FromWorker, [packet]);
});
