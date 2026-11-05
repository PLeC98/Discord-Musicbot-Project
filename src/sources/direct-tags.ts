// 음원 파일 태그의 곡 정보(제목, 가수, 앨범)를 곡에 반영하고 링크 데이터에 적는다. 태그를 읽는 곳(곡 추가 때 헤더 읽기, 캐시 파일 읽기)이 모두 이것을 지난다.
// 어느 곡에 쓰고 무엇이 바뀌나는 rules/track-tags 가 정한다. 태그 제목은 음원에서 나온 것이라 확인된 제목으로 적는다:
// 재생 시작 때 적는 확인 안 된 제목이 덮지 못하게. 앨범은 링크 데이터에 열이 없어 곡, 세션 사본, 캐시 파일 태그에만 남는다

import { tagPatch, takesTags, type TagInfo } from "../rules/track-tags.ts";
import type { TrackInfo } from "../player/track.ts";
import * as trackLookup from "../store/track-lookup.ts";
import { logTitle } from "../infra/log/title.ts";
import { messageOf } from "../rules/error-kind.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "track" });

/** 태그를 곡에 반영한다. 바뀐 필드 이름을 돌려준다(쓰지 않는 곡이거나 바뀐 것이 없으면 빈 배열) */
function applyTags(track: Pick<TrackInfo, "title" | "artist" | "album" | "requestKey" | "audioUrl" | "audioFoundBy"> & Partial<TrackInfo>, tags: TagInfo): string[] {
  if (!takesTags(track)) return [];
  const patch = tagPatch(track, tags);
  if (patch.title) log.debug(`제목 교정(파일 태그): "${logTitle(track.title)}" → "${patch.title}"`);
  Object.assign(track, patch);
  const changed = Object.keys(patch);
  if (tags.title || changed.length > 0) {
    try {
      trackLookup.recordTrackLookup(track, { verified: Boolean(tags.title) });
    } catch (error) {
      log.warn(`링크 데이터 기록 실패("${logTitle(track.title)}"): ${messageOf(error)}`);
    }
  }
  return changed;
}

export { applyTags };
