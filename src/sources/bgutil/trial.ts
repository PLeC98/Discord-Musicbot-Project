// 설치의 실행 테스트: 받아 빌드한 bgutil 서버를 빈 포트에 띄워 /ping이 기대한 버전으로 응답하는지 보고 내린다(설치 스크립트가 가리킴을 바꾸기 전에 부른다).
// 봇의 POToken 서버와 같은 주소(127.0.0.1)와 같은 환경(비밀값을 뺀 toolEnv)으로 띄운다. 로거를 불러오지 않는다(설치 스크립트가 쓴다).
// 끝난 것을 확인하고 돌아간다: Windows에서는 돌고 있는 서버가 canvas.node를 쥐고 있어 폴더 이름을 바꾸지 못한다

import childProcess from "node:child_process";
import { toolEnv } from "../../config/tool-env.ts";
import { killTrees } from "../../infra/kill-tree.ts";
import { HOST, pickFreePort, serverArgs, versionOf } from "./launch.ts";
import { L } from "../../infra/log/text.ts";
import { logTextError, type LogText } from "../../infra/log/log-text.ts";

/** 응답을 기다리는 상한(ms). 따뜻할 때 bgutil의 모듈을 불러오는 데 1.6초쯤 걸린다 */
const READY_MS = 30_000;
/** 내린 뒤 끝나기를 기다리는 상한(ms). 표준 입력을 닫아 스스로 끝나게 하고, 넘으면 트리째 강제 종료한다 */
const EXIT_MS = 5_000;
/** 실패 사유에 붙일 서버 출력(stderr) 끝부분의 길이 */
const TAIL_CHARS = 600;

type TrialResult = { ok: true } | { ok: false; reason: LogText };

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** 끝날 때까지 기다린다. 상한 안에 끝나면 true */
function exited(child: childProcess.ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((done) => {
    const timer = setTimeout(() => done(false), ms);
    child.once("exit", () => {
      clearTimeout(timer);
      done(true);
    });
  });
}

/** 표준 입력을 닫아 끝내고(EXIT_WITH_PARENT), 끝나지 않으면 트리째 강제 종료한다. 그래도 끝나지 않으면 예외를 던진다 */
async function shutDown(child: childProcess.ChildProcess) {
  child.stdin?.end();
  if (await exited(child, EXIT_MS)) return;
  if (child.pid) killTrees([{ pid: child.pid, group: false }]);
  if (!(await exited(child, EXIT_MS))) throw logTextError(L.bgutil.trialServerNotExited({ pid: String(child.pid) }));
}

/**
 * serverDir(체크아웃의 server 폴더)의 서버를 띄워 /ping이 expected 버전으로 응답하는지 본다. 응답에 버전이 없어도 실패다(봇의 준비 확인과 다르다).
 * 서버가 끝난 것을 확인한 뒤에 돌아간다
 */
async function trialRun(serverDir: string, expected: string): Promise<TrialResult> {
  const port = await pickFreePort();
  const url = `http://${HOST}:${port}/ping`;
  const child = childProcess.spawn(process.execPath, serverArgs(port), { cwd: serverDir, stdio: ["pipe", "ignore", "pipe"], env: toolEnv(), windowsHide: true });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-TAIL_CHARS);
  });
  let spawnError: Error | null = null;
  child.once("error", (error) => {
    spawnError = error;
  });
  let result: TrialResult = { ok: false, reason: L.bgutil.trialNoAnswer({ seconds: READY_MS / 1000 }) };
  try {
    const deadline = Date.now() + READY_MS;
    while (Date.now() < deadline) {
      if (spawnError) return (result = { ok: false, reason: L.bgutil.trialSpawnFailed({ error: (spawnError as Error).message }) });
      if (child.exitCode !== null) return (result = { ok: false, reason: L.bgutil.trialExitedEarly({ code: child.exitCode }) });
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) }).catch(() => null);
      if (res?.ok) {
        const version = await versionOf(res);
        return (result = version === expected ? { ok: true } : { ok: false, reason: L.bgutil.trialOtherVersion({ expected, version: version ?? null }) });
      }
      await sleep(250);
    }
    return result;
  } finally {
    await shutDown(child);
    // 안에서 돌려준 객체가 곧 result라 새로 만들지 않고 고친다
    if (!result.ok && stderr.trim()) result.reason = L.bgutil.trialWithOutput({ reason: result.reason, output: stderr.trim().split("\n").slice(-3).join(" / ") });
  }
}

export { trialRun };
export type { TrialResult };
