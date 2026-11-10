// src/sources/ytdlp-spawn.ts: yt-dlp 를 "보통보다 낮음"으로 돌린다(기동 직후 재생 인코딩 워커가 CPU 를 못 받아 소리가 밀리지 않게).
// yt-dlp 대신 말이 없는 진짜 자식 프로세스를 실행해 그 우선순위를 본다.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import run, { useExec, type Exec } from "../../src/sources/ytdlp-spawn.ts";

let child: ChildProcess | null = null;

// 실행 래퍼(ytdlp-exec)의 Exec 와 같은 모양: 자식 프로세스이면서 끝나면 { stdout, stderr } 로 풀리는 약속
const silent = ((..._args: unknown[]) => {
  const proc = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)"], { windowsHide: true });
  child = proc;
  const done = new Promise((resolve, reject) => {
    proc.on("exit", (code) => (code === 0 ? resolve({ stdout: "", stderr: "" }) : reject(Object.assign(new Error("killed"), { stderr: "", exitCode: code }))));
  });
  return Object.assign(done, proc);
}) as unknown as Exec;

afterEach(() => {
  child?.kill("SIGKILL");
  useExec(null);
});

test("띄운 yt-dlp 는 보통보다 낮은 우선순위로 돈다", { timeout: 10_000 }, async () => {
  useExec(silent);
  const pending = run("https://youtu.be/x", { output: "x.opus" }).catch(() => "끝남");
  await new Promise((done) => setTimeout(done, 200));
  assert.equal(os.getPriority(child?.pid), os.constants.priority.PRIORITY_BELOW_NORMAL);
  child?.kill("SIGKILL");
  assert.equal(await pending, "끝남");
});
