// 화면이 본 값(expect)을 WHERE 에 넣은 쓰기의 결과. 캐시 DB 화면의 조작이 쓴다(그사이 봇이 바꾼 행을 덮지 않게)

/** changed: 지금 값이 본 값과 다르다(current 는 지금 값) · gone: 가리킨 행이 없다 */
type Guarded<T> = { ok: true } | { ok: false; code: "changed"; current: T } | { ok: false; code: "gone" };

const DONE: Guarded<never> = { ok: true };
const GONE: Guarded<never> = { ok: false, code: "gone" };
const changedTo = <T>(current: T): Guarded<T> => ({ ok: false, code: "changed", current });

export { DONE, GONE, changedTo };
export type { Guarded };
