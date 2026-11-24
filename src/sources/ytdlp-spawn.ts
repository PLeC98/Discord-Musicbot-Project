import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SpawnOptions } from "child_process";
import config from "../config/index.ts";
import { toolEnv } from "../config/tool-env.ts";
import logger from "../infra/log/logger.ts";
import * as procRegistry from "../infra/process-registry.ts";
import { currentJob } from "../infra/guild-context.ts";
import { SlotQueue, type SlotStats } from "../infra/slot-queue.ts";
import { cpuQuota } from "../infra/cpu-quota.ts";
import type { Job } from "../infra/process-job.ts";
import { isYouTubeURL } from "../rules/links.ts";
import * as errors from "./youtube/errors.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import { ytdlpBinary } from "./ytdlp-binary.ts";
import { execWith, isJSON, isolated, type Exec, type YtDlpFlags } from "./ytdlp-exec.ts";
import { sec } from "../infra/log/seconds.ts";
import { repeatingFailure } from "../infra/repeating-failure.ts";
import { L } from "../infra/log/text.ts";
import { logTextError, type LogText } from "../infra/log/log-text.ts";
const log = logger.child({ category: "ytdlp" });

const IS_WIN = process.platform === "win32";

// POSIX: 자체 프로세스 그룹으로 실행해야 yt-dlp가 spawn한 ffmpeg까지 한 번에 정리된다.
// Windows: taskkill /T가 트리를 처리하므로 detached는 콘솔 분리 부작용만 남긴다.
const SPAWN_OPTS = IS_WIN ? {} : { detached: true };

/** yt-dlp가 실패했을 때 던지는 것. message는 stderr와 같고, 어떤 실패인지 code로 구분해 붙인다 */
type YtDlpError = Error & { stderr?: string; stdout?: string; exitCode?: number; code?: string };

/** spawn 옵션과 줄에 쓰는 것. retry: 재시도다(줄 맨 앞에 선다), job: 작업(없으면 문맥에서) */
type RunOptions = SpawnOptions & { retry?: boolean; job?: Job };

// 테스트는 useExec로 가짜를 넘긴다(기본은 실제 실행). 응답, 오류 형식 맞추기는 그대로 돈다
let fake: Exec | null = null;
function useExec(exec: Exec | null) {
  fake = exec;
}

// 파일로 다운로드하지 않는 호출(정보, 검색, 재생목록, 스트림 주소)의 한도. 멈춘 yt-dlp가 곡 추가를 끝없이 붙잡지 않게 넘으면 내린다.
// 곡 추가 하나가 yt-dlp를 여러 번 불러도 넉넉히 끝나는 값이다. 다운로드는 곡 길이만큼 걸려 걸지 않는다
const INFO_TIMEOUT_MS = 90_000;
let infoTimeoutMs = INFO_TIMEOUT_MS;
/** 테스트가 한도를 줄인다. null이면 원래대로 */
function useInfoTimeout(ms: number | null) {
  infoTimeoutMs = ms ?? INFO_TIMEOUT_MS;
}

// 동시에 도는 yt-dlp의 줄. lookup: 사용자가 기다리는 작업(곡 찾기, 검색, 재생목록, 재생 주소), background: 다운로드(파일로 받는 호출), 미리 받기(prefetch 문맥).
// 오래 도는 뒤의 작업이 앞의 작업을 막지 않게 따로 센다. 슬롯은 실행하는 동안만 잡는다(재시도는 슬롯을 돌려주고 줄 맨 앞에 다시 선다)
type Lane = "lookup" | "background";
const GB = 1024 ** 3;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/**
 * 자동 크기. 메모리는 프로세스에 걸린 상한(컨테이너)이 있으면 그것으로.
 * 곡 찾기는 하나가 약 400MB(JS 과제를 푸는 node 포함)라 메모리의 1/4를 넘지 않게 2GB마다 하나, 2 ~ 8.
 * 다운로드, 미리 받기는 하나가 그만큼에 변환 CPU까지 들어 4GB마다 하나, 2 ~ 4
 */
function autoSlots(constrained: number, total: number): Record<Lane, number> {
  const memory = constrained > 0 && constrained < total ? constrained : total;
  return { lookup: clamp(Math.floor(memory / (2 * GB)), 2, 8), background: clamp(Math.floor(memory / (4 * GB)), 2, 4) };
}
let auto: Record<Lane, number> | null = null;
const autoSize = (lane: Lane) => (auto ??= autoSlots(process.constrainedMemory(), os.totalmem()))[lane];
let fixedSizes: Record<Lane, number> | null = null;
/** 테스트가 줄 크기를 고정한다. null이면 원래대로 */
function useLaneSizes(sizes: Record<Lane, number> | null) {
  fixedSizes = sizes;
}
const lanes: Record<Lane, SlotQueue> = {
  lookup: new SlotQueue(() => fixedSizes?.lookup ?? (config.ytdlp.lookupSlots || autoSize("lookup"))),
  background: new SlotQueue(() => fixedSizes?.background ?? (config.ytdlp.backgroundSlots || autoSize("background"))),
};
// CPU 상한이 걸려 있으면(컨테이너 등) 두 줄을 합쳐 동시에 도는 yt-dlp 수를 상한에 맞춰 제한한다. yt-dlp 여럿이 한 주기의 CPU 할당량을 다 쓰면
// 봇도 다음 주기까지 멈춰 소리가 끊긴다(프로세스 우선순위를 낮춰도 같다). CPU 하나는 봇과 ffmpeg 몫으로 남긴다. 상한이 없으면 제한하지 않는다
const cpuSlots = (quota: number | null) => (quota === null ? Infinity : Math.max(1, Math.floor(quota) - 1));
let quotaRead: { quota: number | null } | null = null;
const quotaNow = () => (quotaRead ??= { quota: cpuQuota() }).quota;
let fixedCpuSlots: number | null = null;
/** 테스트가 CPU 상한에 따른 동시 실행 수를 고정한다. null이면 원래대로 */
function useCpuSlots(slots: number | null) {
  fixedCpuSlots = slots;
}
const cpuGate = new SlotQueue(() => fixedCpuSlots ?? cpuSlots(quotaNow()));
/** CPU 상한(CPU 수)과 그에 따른 yt-dlp 최대 동시 실행 수. 상한이 없으면 null */
function cpuLimit(): { quota: number; slots: number } | null {
  const quota = quotaNow();
  return quota === null ? null : { quota, slots: cpuSlots(quota) };
}
// 줄 안의 순서: 재시도가 맨 앞, 그다음 지금 곡의 작업, 미리 받기는 뒤
const RANK = { retry: 0, now: 1, prefetch: 2 };
// 이보다 오래 기다렸으면 debug 로그를 남긴다(ms)
const WAIT_NOTE_MS: Record<Lane, number> = { lookup: 5_000, background: 30_000 };
const LANE_NAME: Record<Lane, LogText> = { lookup: L.ytdlp.laneLookup(), background: L.ytdlp.laneBackground() };

async function enter(lane: Lane, rank: number, signal: AbortSignal | undefined): Promise<() => void> {
  const asked = Date.now();
  const leave = await lanes[lane].take({ rank, signal });
  const waited = Date.now() - asked;
  if (waited > WAIT_NOTE_MS[lane]) {
    const { running, size, waiting } = lanes[lane].stats();
    log.debug(L.ytdlp.slotWaited({ seconds: sec(waited), lane: LANE_NAME[lane], running, limit: size, waiting }));
  }
  return leave;
}

/** 줄을 닫는다(봇을 끌 때). 기다리던 호출은 거절되고 새로 띄우지 않는다 */
function closeLanes() {
  const closed = logTextError(L.ytdlp.shuttingDownNoSpawn());
  for (const lane of [...Object.values(lanes), cpuGate]) lane.close(closed);
}

// 유튜브 영상 정보 추출(JS 과제를 푸는 호출: 곡 찾기, 재생 주소, 다운로드. 검색, 재생목록 펼치기는 빼고)을 지난 1시간 센다.
// 로그인 없는 세션은 시간당 약 300편에서 막히기 시작한다(yt-dlp 위키). 가까워지면 한 번 알린다(내려갔다 다시 넘으면 또)
const HOUR_MS = 3_600_000;
const EXTRACTION_WARN = 250;
const extractions: number[] = [];
let extractionWarned = false;
function extractedLastHour(now = Date.now()): number {
  while (extractions.length && extractions[0] <= now - HOUR_MS) extractions.shift();
  return extractions.length;
}
function countExtraction(url: string, flags: YtDlpFlags) {
  if (flags.flatPlaylist || !isYouTubeURL(url)) return;
  extractions.push(Date.now());
  const count = extractedLastHour();
  if (count < EXTRACTION_WARN) {
    extractionWarned = false;
    return;
  }
  if (extractionWarned) return;
  extractionWarned = true;
  log.warn(L.ytdlp.infoReadsPerHour({ count }));
}

/** 봇 상태 탭: 줄마다 도는 수, 크기, 기다리는 수와 지난 1시간 영상 정보 추출 수(nearLimit: 알리는 수를 넘었다) */
function ytdlpLoad(): { lookup: SlotStats; background: SlotStats; extractedLastHour: number; nearLimit: boolean } {
  const count = extractedLastHour();
  return { lookup: lanes.lookup.stats(), background: lanes.background.stats(), extractedLastHour: count, nearLimit: count >= EXTRACTION_WARN };
}

// 다운로드 감시: 다운로드 파일 그룹이 limitMs 동안 하나도 바뀌지 않으면(이름, 크기, 수정 시각) 내린다. 느려도 무엇이든 바뀌면 둔다.
// 정상인데 아무것도 바뀌지 않는 구간(파일을 다 쓴 뒤 끝나기까지, 앞 광고 기다림, 다시 받기 전 쉬기)은 길어야 몇 분이다
const STALL = { everyMs: 30_000, limitMs: 10 * 60_000 };
let stall = STALL;
/** 테스트가 감시 간격, 한도를 줄인다. null이면 원래대로 */
function useStallWatch(values: typeof STALL | null) {
  stall = values ?? STALL;
}

/** 다운로드 파일 그룹: output의 이름으로 시작하는 .part, 조각 파일, 중간 파일, 결과, .info.json. 템플릿(%(ext)s)이면 그 앞까지가 이름이다 */
function familyOf(output: string) {
  const base = path.basename(output);
  const template = base.indexOf("%(");
  const stem = template >= 0 ? base.slice(0, template).replace(/\.$/, "") : base.replace(/\.[^.]*$/, "");
  return { dir: path.dirname(output), stem, has: (name: string) => name === base || name === stem || name.startsWith(`${stem}.`) };
}

/**
 * output의 파일 그룹을 지운다. 같은 출력으로 다시 받기 전에 부른다: yt-dlp는 남은 .part를 이어 받는데, 다시 받을 때 포맷이 다르면 이어 붙인 파일이 깨진다.
 * 돌려주는 것은 지운 수. 잠겨 있거나 이미 없는 것은 넘어간다
 */
function clearOutput(output: string): number {
  const { dir, has } = familyOf(output);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter(has);
  } catch (error) {
    if (codeOf(error) !== "ENOENT") log.warn(L.ytdlp.fragmentListFailed({ dir, error: messageOf(error) }));
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    try {
      fs.rmSync(path.join(dir, name), { force: true });
      removed++;
    } catch (error) {
      // 잠겨 있음. 호출부의 정리가 받는다
      log.warn(L.ytdlp.fragmentRemoveFailed({ file: name, error: messageOf(error) }));
    }
  }
  return removed;
}

type WatchLog = { listWarned: boolean; size: ReturnType<typeof repeatingFailure> };

function watchLog(): WatchLog {
  return { listWarned: false, size: repeatingFailure({ error: (line) => log.warn(line), info: (line) => log.info(line) }, L.ytdlp.downloadSizeRead()) };
}

async function snapshotOf({ dir, has }: ReturnType<typeof familyOf>, watch: WatchLog): Promise<string> {
  const listed = await fs.promises.readdir(dir).catch((error: unknown) => {
    if (codeOf(error) !== "ENOENT" && !watch.listWarned) {
      watch.listWarned = true;
      log.warn(L.ytdlp.stallWatchReaddirFailed({ dir, error: codeOf(error) ?? messageOf(error) }));
    }
    return [] as string[];
  });
  const names = listed.filter(has).sort();
  const sizeFailures: Array<string | number> = [];
  const parts = await Promise.all(
    names.map(async (name) => {
      // yt-dlp가 다운로드하는 동안 파일 이름을 바꾸므로 사라진 파일(ENOENT)은 정상이다. 나머지는 남긴다
      const stat = await fs.promises.stat(path.join(dir, name)).catch((error: unknown) => {
        if (codeOf(error) !== "ENOENT") sizeFailures.push(codeOf(error) ?? messageOf(error));
        return null;
      });
      return stat ? `${name}:${stat.size}:${stat.mtimeMs}` : name;
    }),
  );
  if (sizeFailures.length) watch.size.fail(`${dir} | ${sizeFailures[0]}`);
  else watch.size.ok();
  return parts.join("|");
}

/** output의 파일 그룹을 감시해 멎으면 onStall. 돌려주는 것은 감시를 멈추는 함수. read는 테스트가 바꾼다 */
function watchDownload(output: string, onStall: () => void, read = snapshotOf): () => void {
  const family = familyOf(output);
  const watch = watchLog();
  const { everyMs, limitMs } = stall;
  let last: string | null = null;
  let changedAt = Date.now();
  let busy = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void read(family, watch).then((now) => {
      busy = false;
      if (stopped) return;
      if (now !== last) {
        last = now;
        changedAt = Date.now();
      } else if (Date.now() - changedAt >= limitMs) {
        stop();
        onStall();
      }
    });
  }, everyMs);
  timer.unref();
  const stop = () => {
    stopped = true;
    clearInterval(timer);
  };
  return stop;
}

// 파일을 받기 시작했는지(받는 파일이 생겼는지) 보다가 시작하면 onStarted를 한 번 부른다. 돌려주는 것은 그만 보는 함수.
// .info.json은 받기 전에 이미 있을 수 있어 무시한다
const STARTED_EVERY_MS = 500;
function whenDownloading(output: string, onStarted: () => void): () => void {
  const { dir, has } = familyOf(output);
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void fs.promises
      .readdir(dir)
      .then(
        (names) => names.some((name) => has(name) && !name.endsWith(".info.json")),
        () => false,
      )
      .then((started) => {
        busy = false;
        if (!started) return;
        clearInterval(timer);
        onStarted();
      });
  }, STARTED_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}

// 실행할 때마다 현재 버전의 경로를 가져온다. 버전이 바뀌면(ytdlpBinary) 다음 호출부터 새 버전이 실행되고, 돌고 있던 것은 옛 버전으로 끝난다
let bound: { file: string; exec: Exec } | null = null;
function execNow(): Exec {
  if (fake) return fake;
  const file = ytdlpBinary.path();
  // 설치 전이거나 실행 파일이 사라졌다(ytdlpBinary가 설치를 예약한다). 띄우지 못한 것과 같은 코드로 알린다
  if (!file) throw Object.assign(logTextError(L.ytdlp.binaryMissing()), { code: "ENOENT" }) satisfies YtDlpError;
  if (bound?.file !== file) bound = { file, exec: isolated(execWith(file)) };
  return bound.exec;
}

/**
 * yt-dlp를 부르는 곳. 성공하면 JSON이나 문자열, 실패하면 stderr를 담은 Error(code로 어떤 실패인지)를 준다.
 * 띄운 프로세스를 레지스트리에 등록한다. yt-dlp는 이것으로만 부른다(바로 띄우면 실행한 yt-dlp와 그 자식 ffmpeg를 추적하지 못해 좀비가 남는다).
 * 띄우기 전에 줄에서 슬롯을 기다린다(기다리는 시간은 한도에 들지 않는다). signal이 끊기면 기다리다가도 빠진다.
 */
async function run(url: string, flags: YtDlpFlags = {}, { retry = false, job, ...opts }: RunOptions = {}): Promise<unknown> {
  // 작업은 받은 것, 문맥에서(다음 곡 미리 다운로드), 없으면 파일로 다운로드하는 것은 재생, 나머지는 곡 찾기
  const doing = job ?? currentJob() ?? (flags.output ? "play" : "lookup");
  const lane: Lane = flags.output || doing === "prefetch" ? "background" : "lookup";
  const rank = retry ? RANK.retry : doing === "prefetch" ? RANK.prefetch : RANK.now;
  const signal = opts.signal ?? undefined;
  const leave = await enter(lane, rank, signal);
  try {
    const leaveCpu = await cpuGate.take({ rank, signal });
    // 다운로드는 파일을 받기 시작하면 CPU를 거의 쓰지 않는다. 그때 CPU 자리를 내놓아 긴 다운로드가 곡 찾기를 막지 않게 한다(제한이 없으면 받기 시작했는지 보지 않는다)
    const stopWaiting = flags.output && Number.isFinite(cpuGate.stats().size) ? whenDownloading(flags.output, leaveCpu) : null;
    try {
      countExtraction(url, flags);
      return await spawnOnce(url, flags, opts, doing);
    } finally {
      stopWaiting?.();
      leaveCpu();
    }
  } finally {
    leave();
  }
}

// 한 번 띄워 끝을 기다린다. 정보 호출은 한도를 넘으면, 다운로드는 파일이 멎으면 내린다
async function spawnOnce(url: string, flags: YtDlpFlags, opts: SpawnOptions, job: Job): Promise<unknown> {
  const sub = execNow()(url, flags, { ...SPAWN_OPTS, env: toolEnv(), ...opts });
  // yt-dlp는 봇보다 낮은 우선순위로 돌린다. 같은 우선순위로 뜨면 뜬 직후(수십 ms) 재생 인코딩 워커가 20ms 넘게 CPU를 못 받아 소리가 밀릴 수 있다
  const release = procRegistry.register(sub, "yt-dlp", { group: !IS_WIN, job, lowPriority: true });
  let timedOut = false;
  let stalled = false;
  const limit = flags.output
    ? undefined
    : setTimeout(() => {
        timedOut = true;
        procRegistry.kill(sub);
      }, infoTimeoutMs);
  const stopWatch = flags.output
    ? watchDownload(flags.output, () => {
        stalled = true;
        procRegistry.kill(sub);
      })
    : null;
  try {
    const { stdout, stderr } = await sub;
    const out: unknown = isJSON(stdout) ? JSON.parse(stdout) : stdout;
    // 성공해도 stderr에 경고가 실려 온다("이 클라이언트는 POToken이 필요하다" 등).
    // 호출부가 볼 수 있게 얹어 준다. 열거 불가라 직렬화, 스프레드에는 안 섞인다.
    if (stderr && out && typeof out === "object") Object.defineProperty(out, "_stderr", { value: stderr, enumerable: false });
    return out;
  } catch (error) {
    // 한도에서 내렸다. 플랫폼이 응답하지 않은 것으로 보고 다른 클라이언트로 재시도하지 않는다(stderr를 싣지 않아 클라이언트 탓으로 읽히지 않는다)
    if (timedOut) throw Object.assign(logTextError(L.ytdlp.infoTimedOut({ seconds: infoTimeoutMs / 1000 })), { code: "network-error" }) satisfies YtDlpError;
    if (stalled) throw Object.assign(logTextError(L.ytdlp.downloadStalled({ minutes: stall.limitMs / 60_000 })), { code: "network-error" }) satisfies YtDlpError;
    // 실행 래퍼(ytdlp-exec)의 오류를 message = stderr 모양으로 맞춘다.
    // spawn 자체가 실패하면(ENOENT 등) stderr가 없으므로 원래 message를 쓴다.
    // 어떤 실패인지는 여기서 한 번 구분해 code로 붙인다. 호출부는 메시지 텍스트가 아니라 code를 본다.
    const failed = error as { stderr?: string; stdout?: string; exitCode?: number; message?: string; code?: string; logText?: LogText };
    const shaped: YtDlpError = Object.assign(
      new Error(failed.stderr || failed.message),
      { stderr: failed.stderr, stdout: failed.stdout, exitCode: failed.exitCode },
      // stderr가 없으면 message는 실행 래퍼가 쓴 우리 글(명령줄이 든 종료 줄)이다. 서술자를 옮겨 판정이 그 글을 읽지 않게 한다
      failed.stderr || !failed.logText ? {} : { logText: failed.logText },
    );
    shaped.code = errors.codeOf(shaped) || failed.code;
    throw shaped;
  } finally {
    clearTimeout(limit);
    stopWatch?.();
    release();
  }
}

export default run;
export { useExec, useInfoTimeout, useLaneSizes, useCpuSlots, useStallWatch, closeLanes, ytdlpLoad, cpuLimit, cpuSlots, autoSlots, familyOf, clearOutput, watchDownload };
/** yt-dlp 실행 함수. 테스트가 가짜를 넘기는 곳의 모양 */
type RunYtDlp = typeof run;
export type { YtDlpFlags, YtDlpError, RunYtDlp, RunOptions, Exec };
