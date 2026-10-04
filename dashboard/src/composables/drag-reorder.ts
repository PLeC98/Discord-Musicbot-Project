// 카드 목록을 손잡이로 끌어 차례를 바꾼다. 장르 · 상태 문구 · AI 프롬프트 편집기가 같이 쓴다.
//
// 카드를 늘 draggable 로 두면 입력칸의 글자를 끌어 고를 수 없다(브라우저가 카드 드래그로 가로챈다).
// 그렇다고 dragstart 에서 가릴 수도 없다. dragstart 는 draggable 인 요소에서 나므로 target 이 언제나 카드다.
// 그래서 손잡이를 누르고 있는 동안에만 draggable 을 켠다(armDrag).

import { ref, type Ref } from "vue";
import { reordered } from "../utils/reorder.ts";

/** list: 차례를 바꿀 목록. moved(order): 바꾼 뒤 옛 번호의 새 차례(접어 둔 기억 등을 따라 옮길 때) */
export function useDragReorder<T>(list: Ref<T[]>, moved?: (order: number[]) => void) {
  const draggedIndex = ref<number | null>(null);
  const dragOverIndex = ref<number | null>(null);
  const dragReady = ref(false);

  const disarmDrag = () => (dragReady.value = false);

  function armDrag() {
    dragReady.value = true;
    // 누르기만 하고 끌지 않은 경우까지 풀어 준다. 안 풀면 다음에 입력칸을 끌 때 카드가 따라온다
    window.addEventListener("mouseup", disarmDrag, { once: true });
  }

  function onDragStart(e: DragEvent, i: number) {
    // dragstart 는 위로 퍼진다. 칸 안의 글자를 끄는 것도 여기까지 올라온다.
    // 카드 자신이 끌리기 시작한 것만 받는다(글자 드래그는 target 이 그 칸이다).
    if (e.target !== e.currentTarget) return;
    draggedIndex.value = i;
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  // 카드가 draggable 이 아니어도 dragover · drop 은 지나가는 모든 드래그에 반응한다.
  // 칸 안의 글자를 끌면 그것도 여기로 들어와 엉뚱한 자리에 삽입선이 뜬다. 우리 것만 받는다.
  const ours = () => draggedIndex.value != null;

  function onDragOver(e: DragEvent, i: number) {
    if (!ours()) return;
    e.preventDefault(); // 여기에 놓을 수 있다고 알린다
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOverIndex.value = e.clientY < rect.top + rect.height / 2 ? i : i + 1;
  }

  function onDrop(e: DragEvent) {
    if (!ours()) return;
    e.preventDefault();
    const from = draggedIndex.value;
    const to = dragOverIndex.value;
    if (from != null && to != null) {
      const order = reordered(
        list.value.map((_, i) => i),
        from,
        to,
      );
      list.value = reordered(list.value, from, to);
      moved?.(order);
    }
    onDragEnd();
  }

  function onDragEnd() {
    disarmDrag();
    draggedIndex.value = null;
    dragOverIndex.value = null;
  }

  return { draggedIndex, dragOverIndex, dragReady, armDrag, onDragStart, onDragOver, onDrop, onDragEnd };
}
