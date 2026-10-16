// 로그인 배경의 단계를 돌린다. 배경마다 다음 단계를 하나씩 단계 실행기(executors)에 맡기고, 굽기(h264 · encode)는 봇 전체에서 한 번에 하나만 한다(먼저 적용한 배경부터).
// 받기 · 미리보기 · 썸네일 · 정지 그림 · 장면 색은 굽기 차례를 기다리지 않는다(앞 배경을 굽는 동안 적용해도 새 썸네일이 곧 걸린다).
// 실행기를 아직 달지 않은 단계는 시작하지 않고 기다린다(달면 kick 으로 이어서 한다). 단계가 실패하면 배경을 실패로 남기고(문제 코드, 만든 것은 지운다) 운영자가 다시 올린다. 봇이 다시 켜지면 하던 단계부터 이어서 한다(그 단계의 임시 파일은 실행기가 치운다)

import fs from "node:fs";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { codeOf, codedError, messageOf } from "../../rules/error-kind.ts";
import { isCode } from "../../rules/problems.ts";
import { josa } from "../../rules/josa.ts";
import { LOGIN_BG_ENCODE_STAGES, type LoginBackgroundCrop, type LoginBackgroundStage } from "../contract/login-background.ts";
import * as store from "./store.ts";

/** 단계 하나의 일. item 은 지금 기록(바꾸지 않는다), folder 는 배경의 폴더, signal 은 취소, progress 는 그 단계의 0 ~ 1 */
type StageJob = { item: Readonly<store.Stored>; folder: string; signal: AbortSignal; progress: (value: number) => void };
/** 단계가 알아낸 것(받기: 종류 · 크기 · 길이, 미리보기: 어림, 장면 띠, 구운 것). 기록에 덧쓴다 */
type StageResult = Partial<Pick<store.Stored, "kind" | "width" | "height" | "duration" | "fps" | "strip" | "estimate" | "media">>;
type Executor = (job: StageJob) => Promise<StageResult | void>;
/** 크기 어림 다시 세기(편집 창에서 크롭을 정했을 때): 그 크롭 · 구간의 어림 */
type Recounter = (job: { item: Readonly<store.Stored>; folder: string; crop: LoginBackgroundCrop; range: [number, number] | null; signal: AbortSignal }) => Promise<store.Estimate>;

type Run = { stage: LoginBackgroundStage; controller: AbortController; progress: number };
const running = new Map<string, Run>();
let executors: Partial<Record<LoginBackgroundStage, Executor>> = {};
let recounter: Recounter | null = null;
/** 다시 세는 중인 배경 */
const counting = new Map<string, AbortController>();

/** 원본으로 만드는 단계(받기 · 고해상도 받기는 원본을 받고, 장면 띠는 미리보기에서, 마무리는 원본을 지운다) */
const FROM_SOURCE: readonly LoginBackgroundStage[] = ["preview", "thumb", "stills", "tones", "h264", "encode"];

const isEncode = (stage: LoginBackgroundStage | null) => stage !== null && LOGIN_BG_ENCODE_STAGES.includes(stage);

/** 단계 실행기를 단다(단계마다 맡은 모듈이 단다) */
function useExecutors(map: Partial<Record<LoginBackgroundStage, Executor>>) {
  executors = { ...executors, ...map };
}

/** 크기 어림을 다시 세는 일을 단다 */
function useRecounter(fn: Recounter) {
  recounter = fn;
}

/** 그 크롭 · 구간으로 크기 어림을 다시 센다(세던 것은 멈춘다). 편집을 적용하기 전에만 쓴다 */
function recount(one: store.Stored, crop: LoginBackgroundCrop, range: [number, number] | null) {
  stopCounting(one.id);
  if (!recounter) return;
  const controller = new AbortController();
  counting.set(one.id, controller);
  recounter({ item: one, folder: store.folderOf(one.id), crop, range, signal: controller.signal }).then(
    (estimate) => {
      if (counting.get(one.id) !== controller) return;
      counting.delete(one.id);
      if (store.find(one.id) !== one || one.edit !== null) return;
      one.estimate = estimate;
      store.save();
    },
    (error: unknown) => {
      if (counting.get(one.id) !== controller) return;
      counting.delete(one.id);
      log.warn({ sub: "admin" }, `로그인 배경 "${one.name}" 의 크기 어림을 다시 세지 못했습니다: ${messageOf(error)}`);
    },
  );
}

function stopCounting(id: string) {
  counting.get(id)?.abort();
  counting.delete(id);
}

/** 할 수 있는 단계인가(실행기를 단 단계만 한다. 아직 없는 단계는 기다린다) */
const canRun = (stage: LoginBackgroundStage | null): stage is LoginBackgroundStage => stage !== null && executors[stage] !== undefined;

/** 할 단계를 시작한다. 굽기는 도는 것이 없을 때 가장 먼저 적용한 배경 하나만 */
function kick() {
  for (const one of store.items()) {
    const stage = store.nextStage(one);
    if (canRun(stage) && !isEncode(stage) && !running.has(one.id)) start(one, stage);
  }
  if ([...running.values()].some((run) => isEncode(run.stage))) return;
  const waiting = store
    .items()
    .filter((one) => !running.has(one.id) && isEncode(store.nextStage(one)) && canRun(store.nextStage(one)))
    .sort((a, b) => a.appliedAt - b.appliedAt)[0];
  if (waiting) start(waiting, store.nextStage(waiting)!);
}

function start(one: store.Stored, stage: LoginBackgroundStage) {
  const run: Run = { stage, controller: new AbortController(), progress: 0 };
  running.set(one.id, run);
  one.stage = stage;
  store.save();
  const executor = executors[stage]!;
  const job: StageJob = { item: one, folder: store.folderOf(one.id), signal: run.controller.signal, progress: (value) => (run.progress = Math.min(1, Math.max(0, value))) };
  void Promise.resolve()
    .then(() => {
      // 원본으로 만드는 단계인데 원본이 없다(봇 폴더에서 지워졌다): 다시 올리게 한다
      if (FROM_SOURCE.includes(stage) && !fs.existsSync(store.sourceOf(one.id))) throw codedError("background-failed", "원본이 없습니다. 다시 올려 주세요");
      return executor(job);
    })
    .then(
      (result) => finished(one, run, result ?? {}),
      (error: unknown) => failed(one, run, error),
    );
}

/** 이 일이 아직 그 배경의 것인가(그 사이 취소 · 지우기로 빠졌으면 결과를 버린다) */
const stillOurs = (one: store.Stored, run: Run) => running.get(one.id) === run && store.find(one.id) === one;

function finished(one: store.Stored, run: Run, result: StageResult) {
  if (!stillOurs(one, run)) return;
  running.delete(one.id);
  const kindChanged = result.kind !== undefined && result.kind !== one.kind;
  Object.assign(one, result);
  if (kindChanged) one.stages = store.stagesOf(one.kind, one.from);
  one.done.push(run.stage);
  one.stage = null;
  one.bytes = store.folderBytes(one.id);
  if (run.stage === "thumb") store.showIfLatest(one);
  if (store.isReady(one)) {
    one.resumed = false;
    log.info({ sub: "admin" }, `로그인 배경 "${one.name}"${josa(one.name, "을")} 다 만들었습니다`);
    const removed = store.enforceLimits();
    if (removed.length) log.info({ sub: "admin" }, `로그인 배경 한도를 넘어 기록에서 지웠습니다: ${removed.join(", ")}`);
  }
  store.save();
  kick();
}

function failed(one: store.Stored, run: Run, error: unknown) {
  if (!stillOurs(one, run)) return;
  running.delete(one.id);
  const code = codeOf(error);
  one.problem = typeof code === "string" && isCode(code) ? code : "background-failed";
  one.stage = null;
  one.resumed = false;
  log.error({ sub: "admin" }, `로그인 배경 "${one.name}" 의 ${run.stage} 단계가 실패했습니다: ${messageOf(error)}`);
  // 만든 것은 지우고 기록만 남긴다(운영자가 까닭을 보고 지운 뒤 다시 올린다). 걸려 있던 배경이면 이전 배경으로
  const folder = store.folderOf(one.id);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  one.bytes = 0;
  if (store.loaded().current === one.id) store.show(store.previousId());
  store.save();
  kick();
}

/** 배경을 버린다(편집 취소 · 인코딩 취소 · 기록에서 지우기). 도는 단계는 멈추고, 걸려 있던 배경이면 이전 배경으로 */
function discard(id: string) {
  stopCounting(id);
  running.get(id)?.controller.abort();
  running.delete(id);
  store.remove(id);
  store.save();
  kick();
}

/** 그 배경의 단계가 도는 중인가 · 그 단계의 진행(0 ~ 1) */
const isRunning = (id: string) => running.has(id);
const progressOf = (id: string) => running.get(id)?.progress ?? 0;
const isCounting = (id: string) => counting.has(id);

/** 봇이 켜질 때: 하던 단계 · 남은 단계를 이어서 한다 */
function resume() {
  store.loaded();
  kick();
}

/** 테스트: 도는 일을 모두 멈추고 잊는다 */
function _reset() {
  for (const run of running.values()) run.controller.abort();
  running.clear();
  for (const controller of counting.values()) controller.abort();
  counting.clear();
  executors = {};
  recounter = null;
}

export { useExecutors, useRecounter, recount, stopCounting, kick, discard, isRunning, progressOf, isCounting, resume, _reset };
export type { StageJob, StageResult, Executor, Recounter };
