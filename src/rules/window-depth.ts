// 곡이 많은 출처에서 몇 번째 곡까지 보는지. 봇(autoplay/sources)과 대시보드 출처 편집기가 같은 셈을 쓴다

/** 곡이 많을 때 고르는 범위. 정렬 순서의 앞 depth 곡에서만 고르고, narrow 의 칸을 채우면 더 앞쪽(narrowDepth)에서 */
type Window = { depth: number; narrow: string[]; narrowDepth: number };

/** 이 설정으로 몇 번째 곡까지 보는지 */
function windowDepth(win: Window, source: Record<string, unknown>) {
  const filled = (v: unknown) => (Array.isArray(v) ? v : [v]).some((one) => one != null && String(one).trim() !== "");
  return win.narrow.some((key) => filled(source[key])) ? win.narrowDepth : win.depth;
}

export { windowDepth };
export type { Window };
