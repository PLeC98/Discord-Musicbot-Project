// 끝까지 돌리는 ffmpeg 일(테스트 · 검사 · 굽기). 재생의 spawnFfmpeg 와 달리 출력을 모아 끝난 코드와 함께 돌려준다.
// signal 로 멈추고, timeoutMs 를 넘거나 진행(-progress)이 stallMs 동안 멈추면 끊는다. 표준 오류는 끝의 64KB 만 둔다(긴 굽기의 경고가 쌓이지 않게). 줄마다 받으려면 onStderrLine.
// 실행한 것은 자식 프로세스 레지스트리에 올린다(봇이 갑자기 꺼져도 다음 기동에 치운다). bindCores 면 굽기용 코어로 묶는다(infra/cpu-affinity)

import { spawn } from "node:child_process";
import { ffmpegPath } from "./path.ts";
import * as procRegistry from "../../infra/process-registry.ts";
import { bindCommand, bindProcess } from "../../infra/cpu-affinity.ts";
import type { Job } from "../../infra/process-job.ts";

/** 남겨 둘 표준 오류의 끝 */
const STDERR_KEEP = 64 * 1024;
/** 진행을 받는 인자(-progress 를 표준 오류로). stallMs 를 쓰려면 인자에 있어야 한다(없으면 진행이 오지 않아 stallMs 에 끊긴다) */
const PROGRESS_ARGS = ["-progress", "pipe:2", "-nostats"];

type FfmpegJob = {
  /** 표준 입력으로 줄 것 */
  input?: Buffer;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 진행(-progress 의 out_time_us)이 이만큼 늘지 않으면 끊는다. 느린 기기에서 길게 도는 굽기는 끊지 않고 멈춘 것만 끊는다 */
  stallMs?: number;
  /** 표준 출력을 모으지 않는다(파일로 쓰는 일) */
  discardStdout?: boolean;
  onStderrLine?: (line: string) => void;
  /** 레지스트리에 적을 이름(ffmpeg:<label>)과 하는 일 */
  label?: string;
  job?: Job;
  /** 굽기용 코어로 묶는다 */
  bindCores?: boolean;
};
/** 진행 감시: feed 에 표준 오류 줄을 주면 out_time_us 가 늘 때마다 다시 잰다. stallMs 동안 늘지 않으면 onStall */
function progressWatch(stallMs: number, onStall: () => void) {
  let last = -1;
  let timer = setTimeout(onStall, stallMs);
  return {
    feed(line: string) {
      const time = /^out_time_us=(\d+)/.exec(line);
      if (!time || Number(time[1]) <= last) return;
      last = Number(time[1]);
      clearTimeout(timer);
      timer = setTimeout(onStall, stallMs);
    },
    stop: () => clearTimeout(timer),
  };
}

/** 끝난 코드(실행하지 못했거나 신호로 끝났으면 null) · 끝낸 신호 · 모은 출력(글 · 바이트 그대로) · 멈춘 까닭 */
type FfmpegResult = { code: number | null; signal: NodeJS.Signals | null; stdout: string; output: Buffer; stderr: string; aborted: boolean; timedOut: boolean };

function runFfmpeg(args: string[], { input, signal, timeoutMs, stallMs, discardStdout = false, onStderrLine, label = "job", job, bindCores = false }: FfmpegJob = {}): Promise<FfmpegResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ code: null, signal: null, stdout: "", output: Buffer.alloc(0), stderr: "", aborted: true, timedOut: false });
    let child;
    try {
      const command = { file: ffmpegPath(), args: ["-hide_banner", "-nostdin", ...args] };
      const { file, args: line } = bindCores ? bindCommand(command.file, command.args) : command;
      child = spawn(file, line, { windowsHide: true, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    } catch (error) {
      return resolve({ code: null, signal: null, stdout: "", output: Buffer.alloc(0), stderr: String(error), aborted: false, timedOut: false });
    }
    if (bindCores) bindProcess(child.pid);
    const release = procRegistry.register(child, `ffmpeg:${label}`, { job });
    const chunks: Buffer[] = [];
    let stderr = "";
    let partial = "";
    let timedOut = false;
    const kill = () => child.kill("SIGKILL");
    const timer = timeoutMs ? setTimeout(() => ((timedOut = true), kill()), timeoutMs) : null;
    const watch = stallMs ? progressWatch(stallMs, () => ((timedOut = true), kill())) : null;
    signal?.addEventListener("abort", kill, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (!discardStdout) chunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      // -progress 의 "키=값" 줄은 남기지 않는다(실패했을 때 끝 줄이 오류가 아니라 진행으로 채워진다)
      stderr = (stderr + text.replace(/^[a-z_]+=[^\n]*\n?/gm, "")).slice(-STDERR_KEEP);
      if (!onStderrLine && !watch) return;
      const lines = (partial + text).split(/\r\n|\r|\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        watch?.feed(line);
        onStderrLine?.(line);
      }
    });
    const done = (code: number | null, extra = "", ended: NodeJS.Signals | null = null) => {
      if (timer) clearTimeout(timer);
      watch?.stop();
      signal?.removeEventListener("abort", kill);
      release();
      const output = Buffer.concat(chunks);
      resolve({ code, signal: ended, stdout: output.toString("utf8"), output, stderr: stderr + extra, aborted: signal?.aborted ?? false, timedOut });
    };
    child.on("error", (error) => done(null, String(error)));
    child.on("close", (code, ended) => done(code, "", ended));
    if (input) child.stdin?.end(input);
  });
}

export { runFfmpeg, progressWatch, PROGRESS_ARGS };
export type { FfmpegJob, FfmpegResult };
