// 받아 둔 유튜브 스트림 주소를 다시 써도 되나. 주소가 알려 준 만료 시각(expire=)이 남은 곡을 다 받고도 여유가 있을 때만.
// 같은 곡을 다시 열 때의 직전 주소(player/start-playback)와 받아 둔 영상 정보(sources/youtube/recent-info)가 같이 쓴다

/** 남은 곡을 다 받고도 만료까지 이만큼은 남아야 한다 */
const REUSE_MARGIN_MS = 60_000;

/** 주소가 알려 준 만료 시각(ms). 없으면 null */
function expireOf(url: string): number | null {
  try {
    const sec = Number(new URL(url).searchParams.get("expire"));
    return sec > 0 ? sec * 1000 : null;
  } catch {
    return null;
  }
}

/** unknown: 만료 시각을 모른다, expiring: 남은 곡(remainingMs)을 다 받기 전에 만료가 가깝다, ok: 다시 써도 된다 */
function reuseState(url: string, remainingMs: number, now = Date.now()): "unknown" | "expiring" | "ok" {
  const expireMs = expireOf(url);
  if (!expireMs) return "unknown";
  return expireMs - now < remainingMs + REUSE_MARGIN_MS ? "expiring" : "ok";
}

export { REUSE_MARGIN_MS, expireOf, reuseState };
