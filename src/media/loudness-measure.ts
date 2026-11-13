// 캐시 파일의 음량 측정(볼륨 정규화가 쓰는 file 값). ffmpeg 의 ebur128 필터가 100ms 마다 내는 줄과 끝의 요약을 읽는다.
// 한 번에 하나씩 재는 큐다. 지금 재생 중인 곡이 먼저고, 미리 받는 곡을 재는 중이면 그것을 취소해 뒤로 돌린다.
// 큐는 서버와 상관없는 봇 작업이라 서버 문맥 밖에서 돈다(요청하는 쪽은 서버 문맥 안이다). 재는 동안 캐시 파일이 삭제되지 않게 막는다.
// 실패는 둘로 나눈다. 파일 탓(ffmpeg 는 끝까지 돌았는데 값이 맞지 않음)은 file-failed 로 기록해 다시 재지 않고,
// 환경 탓(실행 실패, 진행 멈춤, 줄을 하나도 못 읽음)은 기록하지 않는다(ffmpeg 를 고치면 다시 잰다).

import fs from "node:fs";
import logger from "../infra/log/logger.ts";
import { outsideGuild } from "../infra/guild-context.ts";
import { isShuttingDown } from "../infra/shutdown-state.ts";
import { repeatingFailure } from "../infra/repeating-failure.ts";
import { messageOf } from "../rules/error-kind.ts";
import * as audioCache from "../store/audio-cache.ts";
import * as loudness from "../store/loudness.ts";
import { CACHE_FORMATS, inputFilter } from "./ffmpeg/input-filter.ts";
import { PROGRESS_ARGS, runFfmpeg, type FfmpegJob, type FfmpegResult } from "./ffmpeg/job.ts";
const log = logger.child({ category: "ffmpeg", sub: "loudness" });

// 재생과 같은 48kHz 스테레오로 맞춘 소리를 잰다(모노, 다채널을 들리는 대로)
const FILTER = "aresample=48000,aformat=channel_layouts=stereo,ebur128=peak=true";
/** 진행이 이만큼(ms) 멈추면 끊는다 */
const STALL_MS = 30_000;
/** 이보다 긴 파일은 무거운 작업용 코어에 묶는다(짧은 것은 묶는 비용이 더 크다) */
const BIND_CORES_SEC = 600;
/** 통합 음량이 이보다 낮게 나온 값은 쓰지 않는다(무음이거나 잘못 잰 것) */
const QUIET_LUFS = -50;
/** 순간 음량이 이 아래인 프레임은 피크 상위 1% 에 넣지 않는다(절대 게이트) */
const GATE_LUFS = -70;
// 자체 테스트: 1kHz 사인파(진폭 0.1, 2초)는 줄 20개, 통합 음량과 피크가 -20.0
const PROBE_SEC = 2;
const PROBE_DB = -20;

const LINE = /TARGET.*?M:\s*(\S+).*?FTPK:\s*(\S+)\s+(\S+)/;
const SUMMARY_I = /^\s*I:\s+(\S+)\s+LUFS/;
const SUMMARY_PEAK = /^\s*Peak:\s+(\S+)\s+dBFS/;

type Run = (args: string[], options: FfmpegJob) => Promise<FfmpegResult>;
type Verdict = { kind: "ok"; value: loudness.Measured } | { kind: "file"; why: string } | { kind: "env"; why: string };
/** 한 번 잰 결과. lines: 100ms 줄 수, loudFrames: 게이트를 넘은 프레임 수 */
type Reading = { lines: number; loudFrames: number; integrated: number | null; truePeak: number | null; peakP99: number | null };

const numberOf = (text: string) => {
  const value = Number(text);
  return Number.isFinite(value) ? value : -120;
};

/** ebur128 의 stderr 줄을 하나씩 받아 결과를 낸다. 진행 줄(-progress 의 키=값)이 섞여 와도 된다 */
function readingOf() {
  let lines = 0;
  const peaks: number[] = [];
  let integrated: number | null = null;
  let truePeak: number | null = null;
  let section = "";
  return {
    feed(line: string) {
      const m = LINE.exec(line);
      if (m) {
        lines++;
        if (numberOf(m[1] as string) > GATE_LUFS) peaks.push(Math.max(numberOf(m[2] as string), numberOf(m[3] as string)));
        return;
      }
      if (/Integrated loudness:/.test(line)) section = "i";
      else if (/True peak:/.test(line)) section = "peak";
      const i = section === "i" ? SUMMARY_I.exec(line) : null;
      if (i) integrated = numberOf(i[1] as string);
      const peak = section === "peak" ? SUMMARY_PEAK.exec(line) : null;
      if (peak) truePeak = numberOf(peak[1] as string);
    },
    result(): Reading {
      const sorted = [...peaks].sort((a, b) => a - b);
      const peakP99 = sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(0.99 * sorted.length))] as number) : null;
      return { lines, loudFrames: peaks.length, integrated, truePeak, peakP99 };
    },
  };
}

/** 음량 측정용 ffmpeg 인자. input 은 -i 까지의 입력 인자 */
const measureArgs = (input: string[]) => [...PROGRESS_ARGS, ...input, "-af", FILTER, "-f", "null", "-"];

/**
 * 측정 결과를 분류한다. ok: 쓸 값, file: 파일 탓(기록한다), env: 환경 탓(기록하지 않는다).
 * 줄 수는 내림(길이 x 10)이고, 컨테이너가 알리는 길이와 디코딩한 길이가 다를 수 있어 한 줄 차이까지는 허용한다
 */
function verdictOf(result: Pick<FfmpegResult, "code" | "timedOut">, reading: Reading, durationSec: number | null): Verdict {
  if (result.timedOut) return { kind: "env", why: `진행이 ${STALL_MS / 1000}초 멈춤` };
  if (result.code !== 0) return { kind: "env", why: `ffmpeg 종료 코드 ${result.code ?? "없음"}` };
  // 줄 형식이 다른 빌드에서는 모든 파일이 이렇게 나온다. 파일 탓으로 기록하면 모든 캐시 파일이 file-failed 로 남아 다시 재지 못한다
  if (reading.lines === 0 || reading.integrated === null || reading.truePeak === null) return { kind: "env", why: "ebur128 줄이나 요약을 읽지 못함" };
  if (durationSec && Math.abs(reading.lines - Math.floor(durationSec * 10)) > 1) return { kind: "file", why: `100ms 줄 ${reading.lines}개, 길이 ${durationSec}초와 맞지 않음` };
  if (reading.peakP99 === null) return { kind: "file", why: "게이트를 넘은 프레임이 없음" };
  if (reading.integrated < QUIET_LUFS) return { kind: "file", why: `통합 음량 ${reading.integrated} LUFS` };
  return { kind: "ok", value: { integrated: reading.integrated, truePeak: reading.truePeak, peakP99: reading.peakP99 } };
}

type Job = { key: string; current: boolean };
type Running = Job & { controller: AbortController };

/**
 * 음량 측정 큐. run 은 바깥 경계(ffmpeg 작업, media/ffmpeg/job)
 * onMeasured: file 값을 저장한 뒤 부른다(그 음원을 트는 재생에 바로 반영되게)
 */
class MeasureQueue {
  readonly #run: Run;
  readonly #waiting: Job[] = [];
  #running: Running | null = null;
  #probe: Promise<boolean> | null = null;
  #onMeasured: ((audioKey: string) => void) | null = null;
  readonly #env = repeatingFailure({ error: (line) => log.warn(line), info: (line) => log.info(line) }, "캐시 파일 음량 측정");

  constructor({ run = runFfmpeg }: { run?: Run } = {}) {
    this.#run = run;
  }

  /** 값을 저장할 때마다 부를 함수(조립에서 연결한다) */
  onMeasured(fn: (audioKey: string) => void) {
    this.#onMeasured = fn;
  }

  /**
   * 음원의 캐시 파일을 잰다. 캐시 파일이 있고 맞는 file 값도, 같은 파일의 file-failed 표시도 없을 때만 큐에 넣는다(같은 키를 두 번 넣지 않는다).
   * current: 어느 서버에서든 지금 재생 중인 곡이다(먼저 재고, 미리 받는 곡의 측정을 밀어낸다)
   */
  request(audioKey: string, { current = false }: { current?: boolean } = {}) {
    outsideGuild(() => this.#enqueue(audioKey, current));
  }

  /** 큐에 있거나 재는 중인지 */
  has(audioKey: string) {
    return this.#running?.key === audioKey || this.#waiting.some((job) => job.key === audioKey);
  }

  #enqueue(key: string, current: boolean) {
    if (isShuttingDown()) return;
    if (this.#running?.key === key) {
      this.#running.current ||= current;
      return;
    }
    const queued = this.#waiting.findIndex((job) => job.key === key);
    if (queued >= 0) {
      if (!current || (this.#waiting[queued] as Job).current) return;
      this.#waiting.splice(queued, 1);
    } else if (!needsMeasure(key)) return;
    this.#insert({ key, current });
    // 다른 서버의 지금 곡을 재는 중이면 밀어내지 않는다(긴 파일을 트는 두 서버가 서로를 끝없이 취소한다)
    if (current && this.#running && !this.#running.current) {
      log.debug(`지금 곡을 먼저 재려고 미리 받는 곡의 음량 측정을 뒤로 돌림: ${this.#running.key}`);
      this.#running.controller.abort();
    }
    void this.#pump();
  }

  // 지금 곡은 다른 지금 곡 뒤, 미리 받는 곡 앞에 선다
  #insert(job: Job) {
    const at = job.current ? this.#waiting.findIndex((other) => !other.current) : -1;
    if (at < 0) this.#waiting.push(job);
    else this.#waiting.splice(at, 0, job);
  }

  async #pump() {
    if (this.#running || !this.#waiting.length) return;
    if (!(await this.#probeOnce())) {
      this.#waiting.length = 0;
      return;
    }
    // 자체 테스트를 기다리는 사이 다른 호출이 먼저 시작했을 수 있다
    if (this.#running || isShuttingDown()) return;
    const job = this.#waiting.shift();
    if (!job) return;
    const running: Running = { ...job, controller: new AbortController() };
    this.#running = running;
    try {
      const again = await this.#measure(running);
      if (again) this.#insert({ key: running.key, current: running.current });
    } catch (error) {
      log.warn(`캐시 파일 음량 측정 중 오류: ${running.key} | ${messageOf(error)}`);
    } finally {
      this.#running = null;
      void this.#pump();
    }
  }

  // 취소돼 다시 큐에 넣을 것이면 true
  async #measure(job: Running): Promise<boolean> {
    const row = audioCache.lookupByAudioKey(job.key);
    const file = row?.status === "cached" ? (row.file_path ?? audioCache.getFilePath(job.key)) : null;
    if (!row || !file || !needsMeasure(job.key)) return false;
    const identity = { sizeBytes: row.file_size_bytes, durationSec: row.duration_sec, audioVersion: row.audio_version };
    const release = audioCache.holdForMeasure(job.key);
    const started = performance.now();
    try {
      const reading = readingOf();
      const result = await this.#run(measureArgs([...inputFilter(CACHE_FORMATS, "file"), "-i", file]), {
        signal: job.controller.signal,
        stallMs: STALL_MS,
        onStderrLine: (line) => reading.feed(line),
        label: "loudness",
        job: "loudness",
        bindCores: (row.duration_sec ?? 0) > BIND_CORES_SEC,
      });
      // 취소(밀려남)와 종료 중에 끝난 것은 실패가 아니다
      if (isShuttingDown()) return false;
      if (result.aborted) return !isShuttingDown();
      const verdict: Verdict = fs.existsSync(file) ? verdictOf(result, reading.result(), row.duration_sec) : { kind: "env", why: "재는 사이 파일이 사라짐" };
      if (verdict.kind === "env") {
        this.#env.fail(verdict.why);
        return false;
      }
      this.#env.ok();
      if (verdict.kind === "file") {
        log.warn(`캐시 파일 음량을 재지 못해 이 파일은 다시 재지 않음: ${job.key} | ${verdict.why}`);
        loudness.recordFileFailed(job.key, identity);
        return false;
      }
      loudness.recordFile(job.key, verdict.value, identity);
      const { integrated, truePeak, peakP99 } = verdict.value;
      log.debug(`캐시 파일 음량: ${job.key} | ${integrated} LUFS, 피크 ${truePeak} dBTP, 프레임 피크 상위 1% ${peakP99} dB | ${((performance.now() - started) / 1000).toFixed(1)}초`);
      this.#onMeasured?.(job.key);
      return false;
    } finally {
      release();
    }
  }

  // 처음 쓸 때 한 번, 이 ffmpeg 가 예상한 줄 형식으로 출력하는지 기준 사인파로 확인한다. 아니면 캐시 파일 측정만 끈다(그 곡들은 file 값 없이 튼다)
  #probeOnce(): Promise<boolean> {
    this.#probe ??= this.#selfTest().then(
      (why) => {
        if (why) log.warn(`볼륨 정규화의 캐시 파일 음량 측정을 끔(이 ffmpeg 의 ebur128 출력을 읽지 못함): ${why}`);
        return !why;
      },
      (error: unknown) => {
        log.warn(`볼륨 정규화의 캐시 파일 음량 측정을 끔(자체 테스트 실패): ${messageOf(error)}`);
        return false;
      },
    );
    return this.#probe;
  }

  // 맞으면 null, 아니면 실패 이유
  async #selfTest(): Promise<string | null> {
    const samples = new Float32Array(48_000 * PROBE_SEC * 2);
    for (let i = 0; i < samples.length; i += 2) samples[i] = samples[i + 1] = 0.1 * Math.sin((2 * Math.PI * 1000 * (i / 2)) / 48_000);
    const reading = readingOf();
    const input = ["-protocol_whitelist", "pipe", "-f", "f32le", "-ar", "48000", "-ac", "2", "-i", "pipe:0"];
    const result = await this.#run(measureArgs(input), { input: Buffer.from(samples.buffer), stallMs: STALL_MS, onStderrLine: (line) => reading.feed(line), label: "loudness", job: "loudness" });
    const got = reading.result();
    const near = (value: number | null) => value !== null && Math.abs(value - PROBE_DB) <= 0.5;
    if (result.code !== 0) return `종료 코드 ${result.code ?? "없음"}`;
    if (got.lines !== PROBE_SEC * 10 || !near(got.integrated) || !near(got.truePeak)) return `줄 ${got.lines}개, 통합 음량 ${String(got.integrated)}, 피크 ${String(got.truePeak)}`;
    return null;
  }
}

// 잴 필요가 있는지: 캐시 파일이 있고, 그 파일과 맞는 file 값도 같은 파일의 file-failed 표시도 없다
function needsMeasure(audioKey: string): boolean {
  const row = audioCache.lookupByAudioKey(audioKey);
  if (!row || row.status !== "cached") return false;
  const identity = { sizeBytes: row.file_size_bytes, durationSec: row.duration_sec };
  const file = loudness.rowsOf(audioKey).file;
  if (file && file.sizeBytes === identity.sizeBytes && file.durationSec === identity.durationSec) return false;
  return !loudness.failedBefore(audioKey, identity);
}

/** 봇이 쓰는 음량 측정 큐 하나(값을 받을 곳은 조립에서 연결한다) */
const measureQueue = new MeasureQueue();

export { MeasureQueue, measureQueue, readingOf, verdictOf, measureArgs, needsMeasure };
export type { Reading };
