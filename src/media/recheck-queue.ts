// 캐시의 다시 확인 줄. 캐시 파일로 튼 곡의 원본을, 마지막으로 본 지 출처마다의 간격(설정 CACHE_RECHECK_*_DAYS)이 지났으면 뒤에서 다시 묻는다.
// 재생은 기다리지 않는다(캐시 파일로 바로 틀고, 결과는 다음 재생부터). 안 트는 파일은 묻지 않는다. 캐시 DB 의 재생 테스트는 캐시 파일이 있는 음원을 간격 · 줄 없이 바로 묻는다.
//
// 한 번에 하나씩, 같은 출처는 간격을 두고(유튜브 · 사운드클라우드는 yt-dlp 의 뒤 줄로), yt-dlp 가 바쁘거나 유튜브 추출 수가 알리는 선을 넘었으면 미룬다.
// 결과(media/source-recheck)는 source_checks 에 원본에서 틀 수 있는가 · 그때 본 원본의 버전으로 남긴다. 바뀜은 그 버전과 캐시 파일의 버전이 달라 보인다.
//
//   바뀜         유튜브는 알리기만(저작권 주장으로 소리를 지운 편집일 수 있다), 사운드클라우드 · 직접 링크는 캐시를 지워 다음 재생 때 새로 받는다(쓰는 중이면 끝난 뒤)
//   견주지 못함  틀 수 있음으로 남긴다(앞서 본 버전은 지킨다). 다시 물어도 같아 간격대로만 묻는다
//   사라짐       캐시는 그대로 틀고 남기기만(곡은 대개 다른 주소에 있어 정리는 다른 캐시와 같다)
//   모름         하루 뒤에 다시(일시 오류 · 요청 제한 · 만료된 주소)

import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
import { logTitle } from "../infra/log/title.ts";
import { inGuild } from "../infra/guild-context.ts";
import { ytdlpLoad } from "../sources/ytdlp-spawn.ts";
import * as audioCache from "../store/audio-cache.ts";
import * as sourceChecks from "../store/source-checks.ts";
import { audioKeyOf } from "../rules/audio-key-of.ts";
import { inputKind } from "../rules/input-kind.ts";
import { messageOf } from "../rules/error-kind.ts";
import { recheck, type Recheck, type Stored } from "./source-recheck.ts";
const log = logger.child({ category: "cache" });

type Platform = "youtube" | "soundcloud" | "direct";
type Job = { audioKey: string; audioUrl: string; title: string | null; guildId: string | null; platform: Platform };

// 같은 출처에 묻는 사이의 간격. 유튜브는 시간당 약 300편이 한도라 재생과 나눠 쓴다(yt-dlp 위키는 영상 사이 5 ~ 10초를 권한다)
const GAP_MS: Record<Platform, number> = { youtube: 30_000, soundcloud: 30_000, direct: 2_000 };
// yt-dlp 가 바쁘면 이만큼 뒤에 다시 본다
const BUSY_RETRY_MS = 60_000;
// 모름이면 이만큼 뒤에야 다시 묻는다(틀 때마다 다시 넣지 않게)
const UNKNOWN_HOLD_MS = 86_400_000;
// 바뀐 캐시를 쓰는 중이라 못 지웠으면 이만큼 뒤에 다시
const IN_USE_RETRY_MS = 10 * 60_000;

/** 원본에 묻는 함수 · 시계. 테스트가 바꾼다 */
const deps = { recheck, now: () => Date.now() };

const queue: Job[] = [];
const held = new Map<string, number>();
const lastAsked: Record<Platform, number> = { youtube: 0, soundcloud: 0, direct: 0 };
// 바뀌어 지울 캐시(쓰는 중이라 못 지운 것). 값은 그 파일을 받은 때(그새 새로 받았으면 지우지 않는다)
const replacing = new Map<string, { expect: number | null; title: string | null }>();
let running = false;
let timer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;

const platformOf = (audioUrl: string): Platform | null => {
  const kind = inputKind(audioUrl);
  return kind === "youtube" || kind === "soundcloud" || kind === "direct" ? kind : null;
};

// 마지막으로 원본을 본 때: 받은 때 · 버전을 본 때 · 확인한 때 중 늦은 것
function lastSeen(row: audioCache.AudioRow, audioKey: string): number {
  return Math.max(row.downloaded_at ?? 0, row.version_checked_at ?? 0, sourceChecks.getCheck(audioKey)?.at ?? 0);
}

/** 캐시 파일로 틀었다. 그 출처의 간격이 지났으면 줄에 넣는다 */
function notePlayedFromCache(track: { audioUrl?: string | null; title?: string | null }, guildId: string | null) {
  const audioUrl = track.audioUrl;
  const audioKey = audioUrl ? audioKeyOf(audioUrl) : null;
  const platform = audioUrl ? platformOf(audioUrl) : null;
  if (!audioUrl || !audioKey || !platform || queue.some((job) => job.audioKey === audioKey)) return;
  const every = config.cache.recheckMs[platform];
  if (!every || (held.get(audioKey) ?? 0) > deps.now()) return;
  const row = audioCache.lookupByAudioKey(audioKey);
  if (row?.status !== "cached" || deps.now() - lastSeen(row, audioKey) < every) return;
  queue.push({ audioKey, audioUrl, title: track.title ?? null, guildId, platform });
  schedule(0);
}

/** 캐시 DB 의 재생 테스트: 간격 · 줄을 보지 않고 바로 묻고 결과대로 한다. 캐시 파일이 없거나 다시 확인하지 않는 출처면 null */
async function recheckNow(audioKey: string, audioUrl: string): Promise<Recheck | null> {
  const platform = platformOf(audioUrl);
  const row = audioCache.lookupByAudioKey(audioKey);
  if (!platform || audioKeyOf(audioUrl) !== audioKey || row?.status !== "cached") return null;
  const at = queue.findIndex((job) => job.audioKey === audioKey);
  if (at >= 0) queue.splice(at, 1);
  held.delete(audioKey);
  lastAsked[platform] = deps.now();
  const result = await deps.recheck(audioUrl, { version: row.audio_version, durationSec: row.duration_sec });
  await apply({ audioKey, audioUrl, title: null, guildId: null, platform }, row, result);
  return result;
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void step();
  }, ms);
  timer.unref();
}

async function step() {
  const job = queue[0];
  if (running || !job) return;
  const wait = lastAsked[job.platform] + GAP_MS[job.platform] - deps.now();
  if (wait > 0) return schedule(wait);
  if (job.platform !== "direct") {
    const load = ytdlpLoad();
    if (load.lookup.waiting > 0 || load.background.waiting > 0 || load.nearLimit) return schedule(BUSY_RETRY_MS);
  }
  queue.shift();
  running = true;
  lastAsked[job.platform] = deps.now();
  try {
    const row = audioCache.lookupByAudioKey(job.audioKey);
    if (row?.status === "cached") {
      const stored: Stored = { version: row.audio_version, durationSec: row.duration_sec };
      // 유튜브 · 사운드클라우드는 yt-dlp 의 뒤 줄로(곡 찾기 · 재생을 막지 않게)
      const ask = () => deps.recheck(job.audioUrl, stored);
      const result = job.guildId && job.platform !== "direct" ? await inGuild(job.guildId, ask, "prefetch") : await ask();
      await apply(job, row, result);
    }
  } catch (error) {
    log.debug(`원본 다시 확인 실패(${logTitle(job.title)}): ${messageOf(error)}`);
  } finally {
    running = false;
    if (queue.length) schedule(0);
  }
}

const WHAT_CHANGED = (result: Extract<Recheck, { kind: "changed" }>) => (result.durationChanged === true ? "길이가 바뀜" : result.durationChanged === false ? "길이는 같음" : "음원 파일이 바뀜");

async function apply(job: Job, row: audioCache.AudioRow, result: Recheck) {
  const at = deps.now();
  const where = `"${logTitle(job.title ?? row.title)}" | ${job.audioUrl}`;
  if (result.kind === "same") {
    sourceChecks.recordCheck(job.audioKey, { ok: true, at, version: result.version });
    log.debug(`원본 다시 확인: 같음 ${where}`);
    return;
  }
  if (result.kind === "uncompared") {
    sourceChecks.recordCheck(job.audioKey, { ok: true, at });
    log.debug(`원본 다시 확인: 열림, 견주지 못함(${result.reason}) ${where}`);
    return;
  }
  if (result.kind === "gone") {
    sourceChecks.recordCheck(job.audioKey, { ok: false, code: result.code, at });
    log.info(`캐시한 곡의 원본을 더 틀 수 없습니다(${result.code}). 캐시는 그대로 틉니다: ${where}`);
    return;
  }
  if (result.kind === "unknown") {
    held.set(job.audioKey, at + UNKNOWN_HOLD_MS);
    log.debug(`원본 다시 확인: 모름(${result.reason}), 하루 뒤에 다시 ${where}`);
    return;
  }
  sourceChecks.recordCheck(job.audioKey, { ok: true, at, version: result.version });
  if (job.platform === "youtube") {
    log.info(`캐시한 곡의 원본이 바뀌었습니다(${WHAT_CHANGED(result)}). 캐시는 그대로 두고 캐시 DB 에 알립니다: ${where}`);
    return;
  }
  log.info(`캐시한 곡의 원본이 바뀌었습니다(${WHAT_CHANGED(result)}). 캐시를 지우고 다음 재생 때 새로 받습니다: ${where}`);
  replacing.set(job.audioKey, { expect: row.downloaded_at, title: job.title ?? row.title });
  await replace(job.audioKey);
}

// 바뀐 캐시를 지운다(다음 재생이 새로 받는다). 쓰는 중이면 나중에 다시, 그새 새로 받았거나 없어졌으면 그만
async function replace(audioKey: string) {
  const pending = replacing.get(audioKey);
  if (!pending) return;
  const removed = await audioCache.removeCached(audioKey, pending.expect);
  if (!removed.ok && (removed.code === "in-use" || removed.code === "downloading" || removed.code === "failed")) {
    if (!retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        for (const key of [...replacing.keys()]) void replace(key);
      }, IN_USE_RETRY_MS);
      retryTimer.unref();
    }
    return;
  }
  replacing.delete(audioKey);
  if (removed.ok) log.info(`바뀐 원본의 캐시를 지웠습니다. 다음 재생 때 새로 받습니다: "${logTitle(pending.title)}"`);
}

/** 테스트: 줄 · 기억을 비우고 원본에 묻는 함수 · 시계를 바꾼다(없으면 원래대로) */
function _reset(over: Partial<typeof deps> = {}) {
  queue.length = 0;
  held.clear();
  replacing.clear();
  Object.assign(lastAsked, { youtube: 0, soundcloud: 0, direct: 0 });
  running = false;
  if (timer) clearTimeout(timer);
  if (retryTimer) clearTimeout(retryTimer);
  timer = retryTimer = null;
  Object.assign(deps, { recheck, now: () => Date.now() }, over);
}

/** 테스트: 줄이 빌 때까지 돌린다(간격 · 바쁨은 보지 않는다) */
async function _drain() {
  while (queue.length) {
    Object.assign(lastAsked, { youtube: 0, soundcloud: 0, direct: 0 });
    await step();
  }
}

export { notePlayedFromCache, recheckNow, _reset, _drain };
