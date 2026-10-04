// 후보 목록을 방향키로 오르내리는 자리. 칩 입력(ChipInput)과 태그 고르기(TagPicker)가 같이 쓴다.
// 방향키로 내려간 줄이 잘려 있으면 고를 수가 없어 눈에 들어오게 밀어 준다

import { ref, watch, nextTick, type Ref } from "vue";

/**
 * panel: 줄이 자식으로 늘어선 목록 요소. count(): 지금 줄 수.
 * unset: 고른 줄이 없는 자리(-1 이면 고른 것 없이 시작해 Enter 가 친 말을 그대로 넣는다, 0 이면 첫 줄부터)
 */
export function useListCursor(panel: Readonly<Ref<HTMLElement | null>>, count: () => number, unset: -1 | 0) {
  const at = ref<number>(unset);

  watch(at, () => nextTick(() => panel.value?.children[at.value]?.scrollIntoView({ block: "nearest" })));

  /** 위(-1) · 아래(+1)로. 끝에서는 돌아간다. 고른 것이 없으면 위는 마지막 줄, 아래는 첫 줄이다 */
  function move(by: number) {
    const n = count();
    if (!n) return;
    at.value = at.value < 0 ? (by > 0 ? 0 : n - 1) : (at.value + by + n) % n;
  }

  /** 목록이 바뀌었다. 고른 자리를 처음으로 */
  const reset = () => (at.value = unset);

  return { at, move, reset };
}
