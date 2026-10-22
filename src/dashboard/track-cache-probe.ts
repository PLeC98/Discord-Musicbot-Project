// 캐시 DB 화면의 재생 테스트. 누르면 줄에 세우고 곧바로 돌아오며, 봇이 하나씩 차례로 묻는다.
// 캐시 파일이 있는 음원은 원본 다시 확인(media/recheck-queue: 버전을 견주고 결과대로 한다), 없거나 견주지 못하면 열어 본다(sources/source-probe).
// 결과는 음원 키로 source_checks 에 남는다(그 쓰기가 확인 번호를 올린다: cache-db 의 트리거). 줄은 메모리에만 있다(다시 시작하면 사라진다).

import { TRACK_CACHE_PAGE_MAX, TRACK_CACHE_PROBE_MAX, type TrackCacheChecks, type TrackCacheProbeQueued, type TrackCacheRevision } from "./contract/track-cache.ts";
import { checkOf, sourceOf, type Refusal } from "./track-cache.ts";
import { checkPinAudio } from "../rules/pin-source.ts";
import { audioKeyOf } from "../rules/audio-key-of.ts";
import { messageOf } from "../rules/error-kind.ts";
import { cacheRevision } from "../store/cache-db.ts";
import * as sourceChecks from "../store/source-checks.ts";
import * as audioCache from "../store/audio-cache.ts";
import { probeSource } from "../sources/source-probe.ts";
import { recheckNow } from "../media/recheck-queue.ts";
import { bestEffort } from "../infra/best-effort.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });

const queue: Array<{ key: string; url: string }> = [];
let running: string | null = null;
let probe = probeSource;

// 하나씩 차례로. 이미 도는 중이면 그 줄이 이어 한다
async function drain() {
  if (running !== null) return;
  for (let next = queue.shift(); next; next = queue.shift()) {
    running = next.key;
    try {
      // 결과는 다시 확인이 남기고 로그에 적는다
      const rechecked = await recheckNow(next.key, next.url);
      if (rechecked && rechecked.kind !== "unknown") continue;
      const result = await probe(next.url);
      log.debug({ sub: "track-cache" }, `재생 테스트: ${next.url} | ${result.ok ? "됨" : result.code}`);
      sourceChecks.recordCheck(next.key, result.ok ? { ok: true, at: Date.now() } : { ok: false, code: result.code, at: Date.now() });
    } catch (error) {
      log.debug({ sub: "track-cache" }, `재생 테스트를 끝내지 못했습니다(${next.url}): ${messageOf(error)}`);
    }
  }
  running = null;
}

/** 음원 키. 지정할 수 있는 주소면 다듬은 주소로 열고, 아니면 받은 그대로(키가 없으면 빈 문자열이라 세우지 않는다) */
function targetOf(url: string): { key: string; url: string } {
  const audio = checkPinAudio(url);
  return audio.ok ? { key: audio.audioKey, url: audio.canonical } : { key: audioKeyOf(url) ?? "", url };
}

/**
 * 재생 테스트 줄에 세운다. keys 는 주소마다의 음원 키(쓰기 전 주소도 checking · checks 와 맞춰 보게)
 * @param by  로그에 남길 실행한 사람
 */
function enqueue(audioUrls: string[], by: string): { ok: true; queued: TrackCacheProbeQueued } | Refusal {
  if (!audioUrls.length) return { ok: false, code: "nothing-to-save" };
  if (audioUrls.length > TRACK_CACHE_PROBE_MAX) return { ok: false, code: "too-many-items", params: { max: TRACK_CACHE_PROBE_MAX } };
  const targets = audioUrls.map(targetOf);
  let queued = 0;
  let already = 0;
  for (const target of targets) {
    if (!target.key) continue;
    if (target.key === running || queue.some((one) => one.key === target.key)) already++;
    else {
      queue.push(target);
      queued++;
    }
  }
  if (queued) log.info({ sub: "admin" }, `대시보드에서 재생 테스트 ${queued}개. 실행 ${by}`);
  bestEffort(log, drain(), "재생 테스트");
  return { ok: true, queued: { queued, already, keys: targets.map((target) => target.key) } };
}

/** 확인을 기다리거나 하는 중인 음원 키 */
const checking = () => [...(running ? [running] : []), ...queue.map((one) => one.key)];

/** 리비전 번호와 확인 중인 것(탭이 보이는 동안의 3초 읽기) */
const revision = (): TrackCacheRevision => ({ ...cacheRevision(), checking: checking() });

/** 이 음원 키들의 확인 결과 · 캐시 파일의 원본. 결과가 없는 키는 빠진다 */
function checks(audioKeys: string[]): { ok: true; checks: TrackCacheChecks } | Refusal {
  if (audioKeys.length > TRACK_CACHE_PAGE_MAX) return { ok: false, code: "too-many-items", params: { max: TRACK_CACHE_PAGE_MAX } };
  const found = sourceChecks.checksOf(audioKeys);
  const sources: TrackCacheChecks["sources"] = {};
  for (const [key, check] of found) {
    const row = audioCache.lookupByAudioKey(key);
    const source = row ? sourceOf(row, check) : null;
    if (source) sources[key] = source;
  }
  return { ok: true, checks: { checks: Object.fromEntries([...found].map(([key, check]) => [key, checkOf(check)!])), sources, checkRevision: cacheRevision().checkRevision } };
}

/** 테스트: 여는 쪽을 바꾼다(생략하면 진짜) */
function _setProbe(next: typeof probeSource = probeSource) {
  probe = next;
}
/** 테스트: 줄이 빌 때까지 */
async function _idle() {
  while (running !== null || queue.length) await new Promise((resolve) => setTimeout(resolve, 5));
}

export { enqueue, revision, checks, _setProbe, _idle };
