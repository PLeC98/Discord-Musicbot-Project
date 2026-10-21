// 직접 지정한 음원이 죽었을 때. 그 재생은 지정을 건너뛰고 다시 찾는다. 지정은 사람이 해제할 때까지 그대로 두고,
// 실패는 그 음원의 재생 테스트 결과로 남겨 캐시 DB 에 빨갛게 보인다. 일시 오류는 건너뛰지 않는다(dead-source).
//
//   원래 요청이 유튜브 · 사운드클라우드 · 직접 링크   원래 링크로(직접 링크는 그 링크로 담은 곡만. 자동재생 곡의 요청 키는 출처의 웹 페이지다)
//   스포티파이                                       링크 데이터 · 검색으로(지정은 붙이지 않는다. 아니면 죽은 것을 다시 붙인다)
//   자동재생 곡                                      후보는 이미 지나갔다. 링크 데이터가 기억하는 유튜브 영상, 없으면 실패로 둔다(자동재생이 다음 후보를 선택한다)
// 링크 데이터는 삭제하지 않는다. 지정한 음원을 쓰는 동안 링크 데이터를 쓰지 않았으므로 그 자동 결과가 그대로 다시 찾기의 첫 길이다

import * as sourceChecks from "../store/source-checks.ts";
import * as trackLookup from "../store/track-lookup.ts";
import { deadSourceCode } from "./dead-source.ts";
import { audioKeyOf } from "../rules/audio-key-of.ts";
import { canonicalUrl } from "../rules/canonical-url.ts";
import { inputKind } from "../rules/input-kind.ts";
import * as links from "../rules/links.ts";
import { messageOf } from "../rules/error-kind.ts";
import logger from "../infra/log/logger.ts";
import { logTitle } from "../infra/log/title.ts";
import type { Seeking } from "./youtube/equivalent.ts";
const log = logger.child({ category: "track" });

/** 스포티파이 곡을 다시 찾는 것. 여기서 부르는 것만 */
type Refind = { findYouTubeEquivalent(track: Seeking, opts?: { skipPin?: boolean }): Promise<string | null> };

/**
 * 직접 지정한 음원으로 트는 곡이 사라진 음원 때문에 실패했으면 지정을 건너뛰고 다시 찾는다. 찾았으면 새 음원 주소(곡에 적었다), 아니면 null(원래 오류를 던질 것).
 * 지정한 곡이 아니거나 일시 오류면 아무것도 하지 않고 null
 */
async function leaveDeadPin(track: Seeking, error: unknown, equivalent: Refind): Promise<string | null> {
  if (track.audioFoundBy !== "pinned") return null;
  const code = deadSourceCode(error);
  if (!code) return null;
  const key = audioKeyOf(track.audioUrl);
  try {
    if (key) sourceChecks.recordCheck(key, { ok: false, code, at: Date.now() });
  } catch (recordError) {
    log.debug(`재생 테스트 결과를 남기지 못했습니다: ${messageOf(recordError)}`);
  }
  log.warn(`직접 지정한 음원을 재생할 수 없어 이번에는 다시 찾습니다(지정은 그대로): "${logTitle(track.title)}" | ${track.audioUrl ?? "없음"} | ${code}`);

  const requestKey = track.requestKey ?? "";
  const kind = inputKind(requestKey);
  if (kind === "youtube" || kind === "soundcloud" || (kind === "direct" && track.platform === "direct")) {
    track.audioUrl = canonicalUrl(requestKey);
    track.audioFoundBy = "given";
    return track.audioUrl;
  }
  track.audioUrl = null;
  track.audioFoundBy = undefined;
  if (kind === "spotify") return equivalent.findYouTubeEquivalent(track, { skipPin: true });
  const known = trackLookup.getAudioUrl(requestKey);
  if (!known || !links.isYouTubeURL(known)) return null;
  track.audioUrl = known;
  track.audioFoundBy = "ledger";
  return known;
}

export { leaveDeadPin };
