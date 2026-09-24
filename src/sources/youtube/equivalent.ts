// 스포티파이 곡의 유튜브 동등물 찾기. 찾은 영상을 트랙의 음원 주소로 적는다.

import * as YouTube from "./index.ts";
import * as trackLookup from "../../store/trackLookup.ts";
import * as links from "../../rules/links.ts";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "track" });
import { buildSearchQueries, mergeCandidateLists, rankCandidates } from "./match.ts";
import type { Candidate } from "./match.ts";

/** 동등물을 찾을 곡. 찾으면 audioUrl · audioFoundBy 를 적는다 */
type Seeking = { title?: string | null; artist?: string | null; duration?: unknown; requestKey?: string | null; audioUrl?: string | null; audioFoundBy?: "given" | "ledger" | "search"; [field: string]: unknown };
/** 유튜브 검색. 여기서 읽는 칸만 */
type Search = (query: string, limit: number) => Promise<Array<{ id?: string | number | null; audioUrl?: string | null; title?: string | null; artist?: string | null; duration?: number | null; isLive?: boolean }> | null | undefined>;

/**
 * 음원 주소가 없는 곡(스포티파이)의 YouTube 동등물 검색. 점수제 선택(src/sources/youtube/match.ts).
 * 유튜브 순위 + 스포티파이 길이 일치를 지배 신호로, 채널일치·정크를 타이브레이커로 삼아
 * 원곡/커버/리믹스/TV size 등을 올바로 구분한다. 성공 시 track.audioUrl 과 audioFoundBy 를
 * 설정하고 그 주소를 반환, 실패 시 null. 이미 음원 주소가 있으면 그대로 돌려준다.
 */
// search: 유튜브 검색 함수. 생략하면 진짜
async function findYouTubeEquivalent(track: Seeking, { search = (query, limit) => YouTube.search(query, limit) }: { search?: Search } = {}): Promise<string | null> {
  if (track.audioUrl) return track.audioUrl;

  // Tier-1: 장부에 이 요청의 영상이 있으면 유튜브 검색을 건너뛴다(파일 존재 여부 무관).
  // 그 영상이 내려간 경우는 소비(다운로드) 시점에서 감지해 reresolveYouTube로 재검색한다.
  const known = track.requestKey && trackLookup.getAudioUrl(track.requestKey);
  if (known && links.isYouTubeURL(known)) {
    track.audioUrl = known;
    track.audioFoundBy = "ledger"; // 소비 시 unavailable이면 재검색 트리거
    log.debug(`유튜브 동등물(매핑 재사용, 검색 생략): "${track.title}" → ${known}`);
    return known;
  }

  // 타겟: 스포티파이 duration(초)을 durationSec로 넘겨야 길이 신호가 동작한다
  const target = { title: track.title, artist: track.artist, durationSec: Number(track.duration) || 0 };
  const { primary, secondary } = buildSearchQueries(target);

  const runGroup = async (queries: string[]) => {
    const lists: Candidate[][] = [];
    for (const query of queries) {
      try {
        const results = await search(query, 6);
        lists.push(
          (results || []).map((r) => ({
            id: r.id,
            url: r.audioUrl || (r.id ? `https://www.youtube.com/watch?v=${r.id}` : null),
            title: r.title,
            channel: r.artist, // YouTube.search는 채널명을 artist 필드에 담는다
            durationSec: r.duration,
            isLive: r.isLive,
          })),
        );
      } catch {
        lists.push([]); // 한 쿼리 실패가 전체를 막지 않게
      }
    }
    return lists;
  };

  // 라이브 방송은 후보에서 제외한다. 동등물로서 언제나 오답인 데다(원곡이 라이브일 리 없다),
  // 일단 선택되면 캐시 다운로드가 끝나지 않아 ffmpeg가 무한히 파일을 불린다.
  // 제목이 기호뿐인 곡처럼 신호가 약한 경우 duration 0인 라이브가 우승하는 일이 실제로 있었다.
  const candidates = mergeCandidateLists(await runGroup(primary), await runGroup(secondary)).filter((c) => c.url && !c.isLive);
  if (!candidates.length) return null;

  const { best } = rankCandidates(candidates, target);
  if (!best || !best.url) return null;

  track.audioUrl = best.url;
  track.audioFoundBy = "search";
  log.info(`유튜브 동등물(검색): "${track.title}" → ${best.url}`);
  return track.audioUrl;
}

/**
 * 장부에서 가져온 유튜브 영상이 내려간 경우: 그 줄을 지우고 새로 검색한다.
 * 재검색 결과는 장부에서 온 것이 아니므로(audioFoundBy "search"), 다시 실패해도 이 경로가 재발동하지 않는다(무한루프 방지).
 */
async function reresolveYouTube(track: Seeking, deps?: { search?: Search }): Promise<string | null> {
  if (track.requestKey) trackLookup.removeResolution(track.requestKey);
  track.audioUrl = null;
  track.audioFoundBy = undefined;
  return findYouTubeEquivalent(track, deps);
}

export { findYouTubeEquivalent, reresolveYouTube };

export type { Seeking, Search };
