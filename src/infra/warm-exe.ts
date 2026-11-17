// 막 받은 실행 파일을 워커 스레드에서 한 번 띄워 둔다(Windows만).
// Windows는 처음 보는 실행 파일을 띄우면 백신(Defender)이 검사를 끝낼 때까지 프로세스를 만드는 호출을 붙잡는다. Node의 spawn은 그 호출을 메인 스레드에서 해
// 그동안 이벤트 루프가 멈춘다(새로 받은 yt-dlp를 처음 띄울 때 100~300ms. 재생 중이면 소리가 끊긴다). 워커 스레드에서 띄우면 그 스레드만 멈춘다.
// 검사가 끝난 파일은 다음부터 메인 스레드에서 띄워도 바로 뜬다. 다른 OS는 띄울 때 검사로 멈추지 않아 하지 않는다

import { Worker } from "node:worker_threads";

// 워커가 하는 일: 띄우고 끝나면 알린다. 시간 안에 끝나지 않으면 내린다. 결과(출력, 종료 코드)는 보지 않는다(확인은 호출부가 메인에서 다시 띄워 한다)
const SOURCE = `
const { spawn } = require("node:child_process");
const { workerData, parentPort } = require("node:worker_threads");
const done = () => parentPort.postMessage("done");
let child = null;
try {
  child = spawn(workerData.file, workerData.args, { windowsHide: true, stdio: "ignore" });
} catch {
  done();
}
if (child) {
  const timer = setTimeout(() => child.kill(), workerData.timeoutMs);
  const end = () => (clearTimeout(timer), done());
  child.once("error", end);
  child.once("close", end);
}
`;

/** file을 워커 스레드에서 args로 한 번 띄우고 끝날 때까지 기다린다. 띄우지 못해도 그냥 끝난다(호출부의 실행이 그 실패를 본다) */
export function warmExecutable(file: string, args: string[], timeoutMs: number): Promise<void> {
  if (process.platform !== "win32") return Promise.resolve();
  return new Promise((resolve) => {
    const worker = new Worker(SOURCE, { eval: true, workerData: { file, args, timeoutMs } });
    const finish = () => {
      void worker.terminate();
      resolve();
    };
    worker.once("message", finish);
    worker.once("error", finish);
    worker.once("exit", () => resolve());
  });
}
