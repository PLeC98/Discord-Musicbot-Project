// 스포티파이 곡의 유튜브 동등물 찾기. 찾은 영상을 트랙의 음원 주소로 적는다.

import * as YouTube from "./index.ts";
import * as trackLookup from "../../store/track-lookup.ts";
import * as pinnedSources from "../../store/pinned-sources.ts";
import * as links from "../../rules/links.ts";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "track" });
import { currentJob } from "../../infra/guild-context.ts";
import { rankCandidates, searchCandidates, type Target } from "./match.ts";
import { logTitle } from "../../infra/log/title.ts";
import type { AudioFoundBy } from "../../rules/audio-found-by.ts";

/** 동등물을 찾을 곡. 찾으면 audioUrl · audioFoundBy 를 적는다 */
type Seeking = { title?: string | null; artist?: string | null; duration?: unknown; requestKey?: string | null; audioUrl?: string | null; audioFoundBy?: AudioFoundBy; [field: string]: unknown };
/** 유튜브 검색. 여기서 읽는 필드만 */
type Search = (query: string, limit: number) => Promise<Array<{ id?: string | number | null; audioUrl?: string | null; title?: string | null; artist?: string | null; duration?: number | null; isLive?: boolean }> | null | undefined>;

// 같은 곡(요청 키)을 같은 yt-dlp 줄에서 찾는 중이면 그 답을 같이 받는다(끝나면 버린다. 찾은 것은 링크 데이터가 기억한다).
// 줄을 넘어 붙지 않는다: 미리 받기(뒤 줄)가 찾는 곡을 지금 틀면 따로 찾는다(붙으면 사용자가 뒤 줄을 기다린다)
const seeking = new Map<string, Promise<string | null>>();

/** 찾은 것 중 가장 맞는 영상의 주소. 없으면 null */
async function bestOf(target: Target, search: Search): Promise<string | null> {
  const candidates = await searchCandidates(target, search, "exact");
  if (!candidates.length) return null;
  return rankCandidates(candidates, target).best?.url || null;
}

/** 합치는 열쇠: 줄(미리 받기인가)과 요청 키. 요청 키가 없으면 합치지 않는다 */
const seekKey = (track: Seeking) => (track.requestKey ? `${currentJob() === "prefetch" ? "prefetch" : "now"}|${track.requestKey}` : null);

/** key 로 찾는 중인 것이 있으면 그 답, 없으면 새로 찾는다. joined: 남이 찾던 답이다 */
function sharedBest(key: string | null, find: () => Promise<string | null>): { url: Promise<string | null>; joined: boolean } {
  const going = key ? seeking.get(key) : undefined;
  if (going) return { url: going, joined: true };
  if (!key) return { url: find(), joined: false };
  const url = find().finally(() => seeking.delete(key));
  seeking.set(key, url);
  return { url, joined: false };
}

/**
 * 음원 주소가 없는 곡(스포티파이)의 YouTube 동등물 검색. 점수제 선택(src/sources/youtube/match.ts).
 * 유튜브 순위 + 스포티파이 길이 일치를 지배 신호로, 채널일치·정크를 타이브레이커로 삼아
 * 원곡/커버/리믹스/TV size 등을 올바로 구분한다. 성공 시 track.audioUrl 과 audioFoundBy 를
 * 설정하고 그 주소를 반환, 실패 시 null. 이미 음원 주소가 있으면 그대로 돌려준다.
 */
// search: 유튜브 검색 함수. 생략하면 진짜
// skipPin: 직접 지정한 음원을 붙이지 않는다(죽은 지정 음원을 건너뛰고 다시 찾을 때. 아니면 죽은 것을 다시 붙인다)
async function findYouTubeEquivalent(track: Seeking, { search = (query, limit) => YouTube.search(query, limit), skipPin = false }: { search?: Search; skipPin?: boolean } = {}): Promise<string | null> {
  if (track.audioUrl) return track.audioUrl;

  // 운영자가 직접 지정한 음원이 먼저다(유튜브가 아니어도 된다: 사운드클라우드 · 직접 링크)
  if (!skipPin && pinnedSources.applyPin(track)) {
    log.debug(`직접 지정한 음원(검색 생략): "${logTitle(track.title)}" → ${track.audioUrl}`);
    return track.audioUrl ?? null;
  }

  // Tier-1: 링크 데이터에 이 요청의 영상이 있으면 유튜브 검색을 건너뛴다(파일 존재 여부 무관).
  // 그 영상이 내려간 경우는 소비(다운로드) 시점에서 감지해 reresolveYouTube로 재검색한다.
  const known = track.requestKey && trackLookup.getAudioUrl(track.requestKey);
  if (known && links.isYouTubeURL(known)) {
    track.audioUrl = known;
    track.audioFoundBy = "ledger"; // 소비 시 unavailable이면 재검색 트리거
    log.debug(`유튜브 동등물(링크 데이터 재사용, 검색 생략): "${logTitle(track.title)}" → ${known}`);
    return known;
  }

  // 타겟: 스포티파이 duration(초)을 durationSec로 넘겨야 길이 신호가 동작한다
  const target = { title: track.title, artist: track.artist, durationSec: Number(track.duration) || 0 };
  const { url: found, joined } = sharedBest(seekKey(track), () => bestOf(target, search));
  const url = await found;
  if (!url) return null;

  track.audioUrl = url;
  track.audioFoundBy = "search";
  if (joined) log.debug(`유튜브 동등물(같은 곡을 찾던 답을 같이 받음): "${logTitle(track.title)}" → ${url}`);
  else log.info(`유튜브 동등물(검색): "${logTitle(track.title)}" → ${url}`);
  return url;
}

/**
 * 링크 데이터에서 가져온 유튜브 영상이 내려간 경우: 그 행을 삭제하고 새로 검색한다.
 * 재검색 결과는 링크 데이터에서 온 것이 아니므로(audioFoundBy "search"), 다시 실패해도 이 경로가 재발동하지 않는다(무한루프 방지).
 */
async function reresolveYouTube(track: Seeking, deps?: { search?: Search }): Promise<string | null> {
  if (track.requestKey) trackLookup.removeResolution(track.requestKey);
  track.audioUrl = null;
  track.audioFoundBy = undefined;
  return findYouTubeEquivalent(track, deps);
}

export { findYouTubeEquivalent, reresolveYouTube };

export type { Seeking, Search };
