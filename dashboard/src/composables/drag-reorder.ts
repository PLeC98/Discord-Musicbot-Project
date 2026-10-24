// 카드 목록을 핸들로 끌어 순서를 바꾼다. 장르 · 상태 문구 · AI 프롬프트 편집기가 같이 쓴다(끌기 자체는 pointer-reorder).
// 핸들로만 시작하므로 행 안의 입력란에서 글자를 끌어 선택하는 것과 부딪치지 않는다.

import { type Ref } from "vue";
import { reordered } from "../utils/reorder.ts";
import { usePointerReorder } from "./pointer-reorder.ts";

/** list: 순서를 바꿀 목록. moved(order): 바꾼 뒤 옛 번호의 새 순서(접어 둔 기억 등을 따라 옮길 때) */
export function useDragReorder<T>(list: Ref<T[]>, moved?: (order: number[]) => void) {
  return usePointerReorder({
    drop(from, to) {
      const order = reordered(
        list.value.map((_, i) => i),
        from,
        to,
      );
      list.value = reordered(list.value, from, to);
      moved?.(order);
    },
  });
}
