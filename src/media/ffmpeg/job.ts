// 끝까지 돌리는 ffmpeg 일(시험 · 검사 · 굽기). 재생의 spawnFfmpeg 와 달리 출력을 모아 끝난 코드와 함께 돌려준다.
// signal 로 멈추고, timeoutMs 를 넘으면 끊는다. 표준 오류는 끝의 64KB 만 둔다(긴 굽기의 경고가 쌓이지 않게). 줄마다 받으려면 onStderrLine.
// 띄운 것은 자식 프로세스 장부에 올린다(봇이 갑자기 꺼져도 다음 기동에 치운다). bindCores 면 굽기용 코어로 묶는다(infra/cpu-affinity)

import { spawn } from "node:child_process";
import { ffmpegPath } from "./path.ts";
import * as procRegistry from "../../infra/process-registry.ts";
import { bindCommand, bindProcess } from "../../infra/cpu-affinity.ts";
import type { Job } from "../../infra/process-job.ts";

/** 남겨 둘 표준 오류의 끝 */
const STDERR_KEEP = 64 * 1024;

type FfmpegJob = {
  /** 표준 입력으로 줄 것 */
  input?: Buffer;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 표준 출력을 모으지 않는다(파일로 쓰는 일) */
  discardStdout?: boolean;
  onStderrLine?: (line: string) => void;
  /** 장부에 적을 이름(ffmpeg:<label>)과 하는 일 */
  label?: string;
  job?: Job;
  /** 굽기용 코어로 묶는다 */
  bindCores?: boolean;
};
/** 끝난 코드(실행하지 못하면 null) · 모은 출력(글 · 바이트 그대로) · 멈춘 까닭 */
type FfmpegResult = { code: number | null; stdout: string; output: Buffer; stderr: string; aborted: boolean; timedOut: boolean };

function runFfmpeg(args: string[], { input, signal, timeoutMs, discardStdout = false, onStderrLine, label = "job", job, bindCores = false }: FfmpegJob = {}): Promise<FfmpegResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ code: null, stdout: "", output: Buffer.alloc(0), stderr: "", aborted: true, timedOut: false });
    let child;
    try {
      const command = { file: ffmpegPath(), args: ["-hide_banner", "-nostdin", ...args] };
      const { file, args: line } = bindCores ? bindCommand(command.file, command.args) : command;
      child = spawn(file, line, { windowsHide: true, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    } catch (error) {
      return resolve({ code: null, stdout: "", output: Buffer.alloc(0), stderr: String(error), aborted: false, timedOut: false });
    }
    if (bindCores) bindProcess(child.pid);
    const release = procRegistry.register(child, `ffmpeg:${label}`, { job });
    const chunks: Buffer[] = [];
    let stderr = "";
    let partial = "";
    let timedOut = false;
    const kill = () => child.kill("SIGKILL");
    const timer = timeoutMs ? setTimeout(() => ((timedOut = true), kill()), timeoutMs) : null;
    signal?.addEventListener("abort", kill, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (!discardStdout) chunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      // -progress 의 "열쇠=값" 줄은 남기지 않는다(실패했을 때 끝 줄이 오류가 아니라 진행으로 채워진다)
      stderr = (stderr + text.replace(/^[a-z_]+=[^\n]*\n?/gm, "")).slice(-STDERR_KEEP);
      if (!onStderrLine) return;
      const lines = (partial + text).split(/\r\n|\r|\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) if (line) onStderrLine(line);
    });
    const done = (code: number | null, extra = "") => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      release();
      const output = Buffer.concat(chunks);
      resolve({ code, stdout: output.toString("utf8"), output, stderr: stderr + extra, aborted: signal?.aborted ?? false, timedOut });
    };
    child.on("error", (error) => done(null, String(error)));
    child.on("close", (code) => done(code));
    if (input) child.stdin?.end(input);
  });
}

export { runFfmpeg };
export type { FfmpegJob, FfmpegResult };
