import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import youtubedl from "youtube-dl-exec";
import type { Flags } from "youtube-dl-exec";
import type { SpawnOptions } from "child_process";
import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
import * as procRegistry from "../infra/process-registry.ts";
import { currentJob } from "../infra/guild-context.ts";
import { SlotQueue, type SlotStats } from "../infra/slot-queue.ts";
import type { Job } from "../infra/process-job.ts";
import { isYouTubeURL } from "../rules/links.ts";
import * as errors from "./youtube/errors.ts";
import { ytdlpBinary } from "./ytdlp-binary.ts";
const log = logger.child({ category: "ytdlp" });

const IS_WIN = process.platform === "win32";

// POSIX: 자체 프로세스 그룹으로 실행해야 yt-dlp가 spawn한 ffmpeg까지 한 번에 정리된다.
// Windows: taskkill /T가 트리를 처리하므로 detached는 콘솔 분리 부작용만 남긴다.
const SPAWN_OPTS = IS_WIN ? {} : { detached: true };

/** yt-dlp 플래그(camelCase). 라이브러리 타입에 없는 것 중 우리가 쓰는 필드를 더한다 */
type YtDlpFlags = Flags & { cookiesFromBrowser?: string; extractorArgs?: string; pluginDirs?: string; fragmentRetries?: number; concurrentFragments?: number };

/** yt-dlp 가 실패했을 때 던지는 것. message 는 stderr 와 같고, 어떤 실패인지 code 로 구분해 붙인다 */
type YtDlpError = Error & { stderr?: string; stdout?: string; exitCode?: number; code?: string };

/** spawn 옵션과 줄에 쓰는 것. retry: 같은 것을 다시 묻는다(줄 맨 앞에 선다), job: 하는 일(없으면 문맥에서) */
type RunOptions = SpawnOptions & { retry?: boolean; job?: Job };

// 라이브러리가 내보내지만 타입에는 없는 것
const { isJSON } = youtubedl as typeof youtubedl & { isJSON(text: string): boolean };

/** yt-dlp 프로세스를 실행하는 것(라이브러리의 exec). 약속은 stdout · stderr 를 준다 */
type Exec = typeof youtubedl.exec;
// 테스트는 useExec 로 가짜를 넘긴다(기본은 진짜). 응답 · 오류 모양 맞추기는 그대로 돈다
let fake: Exec | null = null;
function useExec(exec: Exec | null) {
  fake = exec;
}

// 파일로 다운로드하지 않는 호출(정보 · 검색 · 재생목록 · 스트림 주소)의 한도. 멈춘 yt-dlp 가 곡 넣기를 끝없이 붙잡지 않게 넘으면 내린다.
// 곡 넣기 하나가 yt-dlp 를 여러 번 불러도 운영 로그(25일)에서 길어야 54초였다. 다운로드는 곡 길이만큼 걸려 걸지 않는다
const INFO_TIMEOUT_MS = 90_000;
let infoTimeoutMs = INFO_TIMEOUT_MS;
/** 테스트가 한도를 줄인다. null 이면 원래대로 */
function useInfoTimeout(ms: number | null) {
  infoTimeoutMs = ms ?? INFO_TIMEOUT_MS;
}

// 동시에 도는 yt-dlp 의 줄. lookup: 사용자가 기다리는 일(곡 찾기 · 검색 · 재생목록 · 재생 주소), background: 다운로드(파일로 받는 호출) · 미리 받기(prefetch 문맥).
// 오래 도는 뒤의 일이 앞의 일을 막지 않게 따로 센다. 자리는 실행 둘레에만 잡는다(다시 묻기는 자리를 돌려주고 줄 맨 앞에 다시 선다)
type Lane = "lookup" | "background";
const GB = 1024 ** 3;
/** 곡 찾기 하나가 약 400MB(JS 과제를 푸는 node 포함, 리눅스 노트북 실측)라 메모리의 1/4 를 넘지 않게: 2GB 마다 하나, 2 ~ 8. 프로세스에 걸린 상한(컨테이너)이 있으면 그것으로 */
function autoLookupSlots(constrained: number, total: number): number {
  const memory = constrained > 0 && constrained < total ? constrained : total;
  return Math.min(8, Math.max(2, Math.floor(memory / (2 * GB))));
}
const BACKGROUND_SLOTS = 2;
let autoLookup: number | null = null;
let fixedSizes: Record<Lane, number> | null = null;
/** 테스트가 줄 크기를 고정한다. null 이면 원래대로 */
function useLaneSizes(sizes: Record<Lane, number> | null) {
  fixedSizes = sizes;
}
const lanes: Record<Lane, SlotQueue> = {
  lookup: new SlotQueue(() => fixedSizes?.lookup ?? (config.ytdlp.lookupSlots || (autoLookup ??= autoLookupSlots(process.constrainedMemory(), os.totalmem())))),
  background: new SlotQueue(() => fixedSizes?.background ?? (config.ytdlp.backgroundSlots || BACKGROUND_SLOTS)),
};
// 줄 안의 차례: 다시 묻기가 맨 앞, 그다음 지금 곡의 일, 미리 받기는 뒤
const RANK = { retry: 0, now: 1, prefetch: 2 };
// 이보다 오래 기다렸으면 남긴다
const WAIT_NOTE_MS: Record<Lane, number> = { lookup: 5_000, background: 30_000 };
const LANE_NAME: Record<Lane, string> = { lookup: "곡 찾기", background: "다운로드 · 미리 받기" };

async function enter(lane: Lane, rank: number, signal: AbortSignal | undefined): Promise<() => void> {
  const asked = Date.now();
  const leave = await lanes[lane].take({ rank, signal });
  const waited = Date.now() - asked;
  if (waited > WAIT_NOTE_MS[lane]) {
    const { running, size, waiting } = lanes[lane].stats();
    log.debug(`yt-dlp 자리를 ${(waited / 1000).toFixed(1)}초 기다렸습니다 (${LANE_NAME[lane]} ${running}/${size}, 기다림 ${waiting})`);
  }
  return leave;
}

/** 줄을 닫는다(봇을 끌 때). 기다리던 호출은 거절되고 새로 띄우지 않는다 */
function closeLanes() {
  const closed = new Error("봇을 끄는 중이라 yt-dlp 를 띄우지 않습니다");
  for (const lane of Object.values(lanes)) lane.close(closed);
}

// 유튜브 영상 정보 추출(JS 과제를 푸는 호출: 곡 찾기 · 재생 주소 · 다운로드. 검색 · 재생목록 펼치기는 빼고)을 지난 1시간 센다.
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
  log.warn(`지난 1시간 동안 유튜브 영상 정보를 ${count}번 읽었습니다. 로그인 없는 세션은 시간당 약 300편에서 막히기 시작합니다`);
}

/** 봇 상태 탭: 줄마다 도는 수 · 크기 · 기다리는 수와 지난 1시간 영상 정보 추출 수(nearLimit: 알리는 수를 넘었다) */
function ytdlpLoad(): { lookup: SlotStats; background: SlotStats; extractedLastHour: number; nearLimit: boolean } {
  const count = extractedLastHour();
  return { lookup: lanes.lookup.stats(), background: lanes.background.stats(), extractedLastHour: count, nearLimit: count >= EXTRACTION_WARN };
}

// 다운로드 감시: 받는 파일 묶음이 limitMs 동안 하나도 바뀌지 않으면(이름 · 크기 · 수정 시각) 내린다. 느려도 무엇이든 바뀌면 둔다.
// 정상인데 아무것도 바뀌지 않는 구간(파일을 다 쓴 뒤 끝나기까지 · 앞 광고 기다림 · 다시 받기 전 쉬기)은 길어야 몇 분이다
const STALL = { everyMs: 30_000, limitMs: 10 * 60_000 };
let stall = STALL;
/** 테스트가 감시 간격 · 한도를 줄인다. null 이면 원래대로 */
function useStallWatch(values: typeof STALL | null) {
  stall = values ?? STALL;
}

/** 받는 파일 묶음: output 의 이름으로 시작하는 .part · 조각 · 중간 파일 · 결과 · .info.json. 템플릿(%(ext)s)이면 그 앞까지가 이름이다 */
function familyOf(output: string) {
  const base = path.basename(output);
  const template = base.indexOf("%(");
  const stem = template >= 0 ? base.slice(0, template).replace(/\.$/, "") : base.replace(/\.[^.]*$/, "");
  return { dir: path.dirname(output), has: (name: string) => name === base || name === stem || name.startsWith(`${stem}.`) };
}

async function snapshotOf({ dir, has }: ReturnType<typeof familyOf>): Promise<string> {
  const names = (await fs.promises.readdir(dir).catch(() => [] as string[])).filter(has).sort();
  const parts = await Promise.all(
    names.map(async (name) => {
      const stat = await fs.promises.stat(path.join(dir, name)).catch(() => null);
      return stat ? `${name}:${stat.size}:${stat.mtimeMs}` : name;
    }),
  );
  return parts.join("|");
}

/** output 의 파일 묶음을 감시해 멎으면 onStall. 돌려주는 것은 감시를 멈추는 함수 */
function watchDownload(output: string, onStall: () => void): () => void {
  const family = familyOf(output);
  const { everyMs, limitMs } = stall;
  let last: string | null = null;
  let changedAt = Date.now();
  let busy = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void snapshotOf(family).then((now) => {
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

// 실행할 때마다 지금 버전의 경로를 묻는다. 버전이 바뀌면(ytdlpBinary) 다음 호출부터 새 버전이 실행되고, 돌고 있던 것은 옛 버전으로 끝난다
let bound: { file: string; exec: Exec } | null = null;
function execNow(): Exec {
  if (fake) return fake;
  const file = ytdlpBinary.path();
  if (bound?.file !== file) bound = { file, exec: youtubedl.create(file).exec };
  return bound.exec;
}

/**
 * youtube-dl-exec의 드롭인 대체. 반환·예외 계약은 원본과 같다(성공 시 JSON이나 문자열, 실패 시 stderr를 담은 Error).
 * 원본은 Promise만 돌려줘 pid를 잡을 수 없어서, pid가 나오는 `.exec()`로 우회해 레지스트리에 등록한다.
 * yt-dlp 는 이것으로만 부른다. youtube-dl-exec 를 바로 부르면 실행한 yt-dlp(와 그 자식 ffmpeg)를 추적하지 못해 좀비가 남는다.
 * 띄우기 전에 줄에서 자리를 기다린다(기다리는 시간은 한도에 들지 않는다). signal 이 끊기면 기다리다가도 빠진다.
 *
 * @param {string} url
 * @param {object} flags yt-dlp 플래그(camelCase)
 * @param {object} opts child_process.spawn 옵션과 retry · job
 */
async function run(url: string, flags: YtDlpFlags = {}, { retry = false, job, ...opts }: RunOptions = {}): Promise<unknown> {
  // 일은 받은 것 · 문맥에서(다음 곡 미리 다운로드), 없으면 파일로 다운로드하는 것은 재생, 나머지는 곡 찾기
  const doing = job ?? currentJob() ?? (flags.output ? "play" : "lookup");
  const lane: Lane = flags.output || doing === "prefetch" ? "background" : "lookup";
  const leave = await enter(lane, retry ? RANK.retry : doing === "prefetch" ? RANK.prefetch : RANK.now, opts.signal ?? undefined);
  try {
    countExtraction(url, flags);
    return await spawnOnce(url, flags, opts, doing);
  } finally {
    leave();
  }
}

// 한 번 띄워 끝을 기다린다. 정보 호출은 한도를 넘으면, 다운로드는 파일이 멎으면 내린다
async function spawnOnce(url: string, flags: YtDlpFlags, opts: SpawnOptions, job: Job): Promise<unknown> {
  const sub = execNow()(url, flags, { ...SPAWN_OPTS, ...opts });
  const release = procRegistry.register(sub, "yt-dlp", { group: !IS_WIN, job });
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
    // 호출부가 볼 수 있게 얹어 준다. 열거 불가라 직렬화·스프레드에는 안 섞인다.
    if (stderr && out && typeof out === "object") Object.defineProperty(out, "_stderr", { value: stderr, enumerable: false });
    return out;
  } catch (error) {
    // 한도에서 내렸다. 플랫폼이 답하지 않은 것으로 보고 다른 클라이언트로 다시 묻지 않는다(stderr 를 싣지 않아 클라이언트 탓으로 읽히지 않는다)
    if (timedOut) throw Object.assign(new Error(`yt-dlp 가 ${infoTimeoutMs / 1000}초 안에 끝나지 않아 내렸습니다`), { code: "network-error" }) satisfies YtDlpError;
    if (stalled) throw Object.assign(new Error(`yt-dlp 다운로드가 ${stall.limitMs / 60_000}분 동안 나아가지 않아 내렸습니다`), { code: "network-error" }) satisfies YtDlpError;
    // tinyspawn의 오류를 youtube-dl-exec와 같은 모양(message = stderr)으로 맞춘다.
    // spawn 자체가 실패하면(ENOENT 등) stderr가 없으므로 원래 message를 쓴다.
    // 어떤 실패인지는 여기서 한 번 구분해 code 로 붙인다. 부르는 쪽은 글이 아니라 code 를 본다.
    const failed = error as { stderr?: string; stdout?: string; exitCode?: number; message?: string; code?: string };
    const shaped: YtDlpError = Object.assign(new Error(failed.stderr || failed.message), {
      stderr: failed.stderr,
      stdout: failed.stdout,
      exitCode: failed.exitCode,
    });
    shaped.code = errors.codeOf(shaped) || failed.code;
    throw shaped;
  } finally {
    clearTimeout(limit);
    stopWatch?.();
    release();
  }
}

export default run;
export { useExec, useInfoTimeout, useLaneSizes, useStallWatch, closeLanes, ytdlpLoad, autoLookupSlots, familyOf };
/** yt-dlp 실행 함수. 테스트가 가짜를 넘기는 곳의 모양 */
type RunYtDlp = typeof run;
export type { YtDlpFlags, YtDlpError, RunYtDlp, RunOptions, Exec };
