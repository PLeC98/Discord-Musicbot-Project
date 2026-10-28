// 큰 칸에 그릴 곡 그림. 곡의 그림 주소는 작은 칸용(유튜브 320×180, rules/track-art)이라 큰 칸에 그대로 쓰면 늘려 그린다.
// 출처가 더 큰 그림을 주면 그것을 쓴다(large: 유튜브 1280×720, standard: 480×360). 유튜브는 큰 그림이 없는 영상(옛 영상)에
// 120×90 대체 그림을 주므로, 받아 보고 그렇거나 못 불러오면 그 주소를 기억해 두고 standard · 지금 주소 차례로 돌아간다.
// 기억은 화면 전체가 같이 쓴다(옆 카드에서 확인한 것을 가운데 카드가 다시 시도하지 않게).

import { reactive } from "vue";
import { artOf, type ArtSize } from "../../../src/rules/track-art.ts";

type BigSize = Exclude<ArtSize, "small">;

// 큰 그림이 없다고 확인된 주소
const missing = reactive(new Set<string>());
// 이보다 좁으면 대체 그림이다
const PLACEHOLDER_MAX = 200;

/** 큰 칸에 그릴 주소. 없으면 null */
function bigArt(url: string | null | undefined, size: BigSize): string | null {
  if (!url) return null;
  const tries: BigSize[] = size === "large" ? ["large", "standard"] : ["standard"];
  for (const one of tries) {
    const big = artOf(url, one);
    if (big && big !== url && !missing.has(big)) return big;
  }
  return url;
}

/**
 * <img> 의 load · error 에서 부른다. url 은 곡의 그림 주소(bigArt 에 넘긴 것).
 * ok: 그렸다. retry: 큰 그림이 대체 그림이거나 못 불러와 기억했다(bigArt 가 다음 주소를 준다). broken: 원래 주소도 못 불러왔다
 */
function noteArt(event: Event, url: string | null | undefined): "ok" | "retry" | "broken" {
  const img = event.target as HTMLImageElement;
  const shown = img.getAttribute("src");
  if (!shown || shown === url) return event.type === "error" ? "broken" : "ok";
  if (event.type === "load" && img.naturalWidth >= PLACEHOLDER_MAX) return "ok";
  missing.add(shown);
  return "retry";
}

export { bigArt, noteArt };
export type { BigSize };
