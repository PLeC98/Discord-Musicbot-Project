// 재생목록 "더 넣기"의 위치와 선택지. 디스코드 메뉴(usecases/playlist-more)와 대시보드가 같이 쓴다

/** 이어 받을 수 있는 출처: 유튜브 재생목록 · 스포티파이 재생목록 · 스포티파이 앨범 · 사운드클라우드 세트 · 사운드클라우드 믹스 */
type Kind = "ytp" | "spp" | "spa" | "scs" | "scd";
/** 이어 받을 위치. 메뉴의 custom_id 에 싣는다 */
type MoreState = { kind: Kind; listId: string; offset: number; anchorId: string; insertFirst: boolean; requesterId: string | null };
/** 띄울 메뉴. 위치에 전체 · 남은 곡 수와 한 번에 넣는 묶음(batch)을 더한다 */
type More = MoreState & { total: number; remaining: number; batch?: number };

/** 한 번에 적어 넣을 수 있는 곡 수 상한 */
const MAX_COUNT = 10_000;

// 선택지. 한 번에 넣는 묶음 단위로, 남은 곡 · 남은 자리 · 출처의 한 번 상한(perClick) 중 가장 작은 쪽(cap)을 넘지 않게
function moreChoices({ remaining, room, batch, perClick = Infinity }: { remaining: number; room: number; batch: number; perClick?: number }) {
  const cap = Math.max(0, Math.min(remaining, room, perClick));
  return { cap, steps: cap > 0 ? [batch, batch * 2].filter((n) => n < cap) : [] };
}

/** 적어 넣은 곡 수. 1 ~ MAX_COUNT 의 정수가 아니면 null */
function parseCount(raw: unknown) {
  const text = String(raw ?? "").trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= MAX_COUNT ? n : null;
}

export { MAX_COUNT, moreChoices, parseCount };
export type { Kind, MoreState, More };
