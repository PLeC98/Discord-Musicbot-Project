// src/sources/ytdlp-spawn.ts — 정보만 읽는 호출의 시간 한도. 멈춘 yt-dlp 가 곡 넣기를 끝없이 붙잡지 않게 한도에서 트리째 내린다.
// 다운로드(output 이 있는 호출)는 곡 길이만큼 걸리므로 한도를 걸지 않는다.
// yt-dlp 대신 말이 없는 진짜 자식 프로세스를 실행한다(내리는 길이 진짜여야 한다).

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import run, { useExec, useInfoTimeout, type Exec, type YtDlpError } from "../../src/sources/ytdlp-spawn.ts";
import * as registry from "../../src/infra/process-registry.ts";

let child: ChildProcess | null = null;

// youtube-dl-exec 의 exec 와 같은 모양: 자식 프로세스이면서 끝나면 { stdout, stderr } 로 풀리는 약속
const silent = ((..._args: unknown[]) => {
  const proc = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)"], { windowsHide: true });
  child = proc;
  const done = new Promise((resolve, reject) => {
    proc.on("exit", (code) => (code === 0 ? resolve({ stdout: "", stderr: "" }) : reject(Object.assign(new Error("killed"), { stderr: "", exitCode: code }))));
  });
  return Object.assign(done, proc);
}) as unknown as Exec;

const alive = (pid: number | undefined) => {
  try {
    process.kill(pid as number, 0);
    return true;
  } catch {
    return false;
  }
};

afterEach(() => {
  if (child?.pid && alive(child.pid)) child.kill("SIGKILL");
  useExec(null);
  useInfoTimeout(null);
});

test("정보만 읽는 호출은 한도가 지나면 자식을 내리고 연결 오류로 실패한다(다른 클라이언트로 다시 묻지 않게)", { timeout: 10_000 }, async () => {
  useExec(silent);
  useInfoTimeout(300);
  const before = registry.size();
  const started = Date.now();
  const error = await run("https://youtu.be/x", { dumpSingleJson: true }).then(
    () => null,
    (e: YtDlpError) => e,
  );
  assert.equal(error?.code, "network-error");
  assert.ok(Date.now() - started < 5000, "한도 뒤 곧 끝난다");
  await new Promise((done) => setTimeout(done, 200));
  assert.equal(alive(child?.pid), false, "자식이 남지 않는다");
  assert.equal(registry.size(), before);
});

test("다운로드(output)에는 한도를 걸지 않는다", { timeout: 10_000 }, async () => {
  useExec(silent);
  useInfoTimeout(300);
  const pending = run("https://youtu.be/x", { output: "x.opus" }).catch(() => "끝남");
  await new Promise((done) => setTimeout(done, 700));
  assert.equal(alive(child?.pid), true, "한도가 지나도 다운로드 중이다");
  child?.kill("SIGKILL");
  assert.equal(await pending, "끝남");
});
