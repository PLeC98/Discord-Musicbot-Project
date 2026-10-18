// 디스코드에 거는 곡 그림. 디스코드는 눌러서 크게 보여 주므로 큰 그림을 건다.
// 유튜브 maxresdefault 는 옛 영상에 없어(404) 영상마다 한 번 물어 본다. 없거나 물어 보지 못하면 늘 있는 hqdefault(480×360).
// 물어 보기는 prepare 가 하고(재생 패널을 그리기 전), 그리는 쪽은 urlOf 로 아는 답만 쓴다(모르면 hqdefault)

import { artOf, youtubeArt, youtubeIdOf } from "../rules/track-art.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });

const TIMEOUT_MS = 3000;
/** 기억할 영상 수. 넘으면 오래된 것부터 잊는다 */
const KEEP = 1000;

type Head = (url: string) => Promise<{ ok: boolean; status: number }>;
let head: Head = (url) => globalThis.fetch(url, { method: "HEAD", signal: AbortSignal.timeout(TIMEOUT_MS) });

/** 영상 id → 큰 그림이 있나 */
const known = new Map<string, boolean>();
const asking = new Map<string, Promise<void>>();

/** 이 그림의 큰 것이 있는지 물어 둔다. 유튜브가 아니거나 이미 알면 바로 끝난다 */
function prepare(url: string | null | undefined): Promise<void> {
  const videoId = youtubeIdOf(url);
  if (!videoId || known.has(videoId)) return Promise.resolve();
  let pending = asking.get(videoId);
  if (!pending) {
    pending = head(youtubeArt(videoId, "large"))
      .then((res) => remember(videoId, res.ok))
      .catch((error: unknown) => {
        log.debug(`큰 그림 확인 실패(hqdefault 로): ${videoId}`, error);
        remember(videoId, false);
      })
      .finally(() => asking.delete(videoId));
    asking.set(videoId, pending);
  }
  return pending;
}

function remember(videoId: string, large: boolean) {
  known.set(videoId, large);
  if (known.size > KEEP) known.delete(known.keys().next().value as string);
}

/** 디스코드에 걸 그림 주소(없으면 null) */
function urlOf(url: string | null | undefined): string | null {
  const videoId = youtubeIdOf(url);
  if (!videoId) return artOf(url, "large");
  return youtubeArt(videoId, known.get(videoId) ? "large" : "standard");
}

export { prepare, urlOf };
export const _internals = {
  useHead(fake: Head) {
    head = fake;
    known.clear();
  },
};
