// 카드 목록을 손잡이로 끌어 차례를 바꾼다. 장르 · 상태 문구 · AI 프롬프트 편집기가 같이 쓴다(끌기 자체는 pointer-reorder).
// 손잡이로만 시작하므로 줄 안의 입력칸에서 글자를 끌어 고르는 것과 부딪치지 않는다.

import { type Ref } from "vue";
import { reordered } from "../utils/reorder.ts";
import { usePointerReorder } from "./pointer-reorder.ts";

/** list: 차례를 바꿀 목록. moved(order): 바꾼 뒤 옛 번호의 새 차례(접어 둔 기억 등을 따라 옮길 때) */
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
