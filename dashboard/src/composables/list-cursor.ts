// 후보 목록을 방향키로 오르내리는 기능. 칩 입력(ChipInput)과 태그 선택(TagPicker)이 같이 쓴다.
// 방향키로 내려간 항목이 잘려 있으면 선택할 수가 없어 눈에 들어오게 밀어 준다

import { ref, watch, nextTick, type Ref } from "vue";

/**
 * panel: 항목이 자식으로 늘어선 목록 요소. count(): 지금 항목 수.
 * unset: 선택한 항목이 없는 위치(-1 이면 선택한 것 없이 시작해 Enter 가 입력한 말을 그대로 추가한다, 0 이면 첫 항목부터)
 */
export function useListCursor(panel: Readonly<Ref<HTMLElement | null>>, count: () => number, unset: -1 | 0) {
  const at = ref<number>(unset);

  watch(at, () => nextTick(() => panel.value?.children[at.value]?.scrollIntoView({ block: "nearest" })));

  /** 위(-1) · 아래(+1)로. 끝에서는 돌아간다. 선택한 것이 없으면 위는 마지막 항목, 아래는 첫 항목이다 */
  function move(by: number) {
    const n = count();
    if (!n) return;
    at.value = at.value < 0 ? (by > 0 ? 0 : n - 1) : (at.value + by + n) % n;
  }

  /** 목록이 바뀌었다. 선택 위치를 처음으로 */
  const reset = () => (at.value = unset);

  return { at, move, reset };
}
