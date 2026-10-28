// 테스트용 인코딩 워커: 실제 워커(src/media/encode-worker)에 고장을 더한다.
// 프레임의 볼륨 배율(gain)이 -1 이면 답하기 전에 스레드를 끝낸다(같은 프레임을 다시 받은 워커도 끝난다).
// BroadcastChannel "faulty-encode-worker" 로 "exit" 를 받으면 바로 끝나고, "hang" 을 받으면 다음 프레임에서 멈춘다(무한 루프)
import { parentPort, BroadcastChannel } from "worker_threads";

let hang = false;
const faults = new BroadcastChannel("faulty-encode-worker");
faults.onmessage = (event: unknown) => {
  const what = (event as { data: unknown }).data;
  if (what === "exit") process.exit(7);
  if (what === "hang") hang = true;
};
faults.unref();

// 실제 워커보다 먼저 듣는다(그래야 답하기 전에 끝나거나 멈춘다)
parentPort?.on("message", (m: { type: string; gain?: number }) => {
  if (m.type !== "frame") return;
  if (m.gain === -1) process.exit(7);
  while (hang) hang = true;
});

await import("../../src/media/encode-worker.ts");
