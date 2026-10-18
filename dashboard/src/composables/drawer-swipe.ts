// 휴대폰 서랍을 손가락으로 여닫는다. 끄는 동안 서랍이 손가락을 따라오고(progress 0~1), 놓으면 빠르기 · 연 정도로 열지 닫을지 정한다.
// 열기: 화면 왼쪽 끝 48px 안에서 시작해 오른쪽으로 쓸기(아무 데서나 받으면 너무 쉽게 열린다. 맨 끝은 안드로이드 · 브라우저의 "뒤로" 제스처가 먼저 가져가니 끝 바로 안쪽이 실제로 받는 영역이다).
//   가로로 끄는 것(입력 · 막대 · 순서 바꾸기 핸들 · 알림 밀기 · 가로로 스크롤되는 영역) 위에서 시작하면 받지 않는다.
// 닫기: 열린 동안 아무 데서나 왼쪽으로 쓸기(서랍 · 뒤 막).

import { ref, onMounted, onUnmounted, type Ref } from "vue";

// 이 안에서 시작한 끌기는 서랍 것이 아니다
const OWN_DRAG = "input, textarea, select, [role=slider], [data-reorder], [data-no-swipe], .touch-none, [role=status]";
const SLOP = 8; // 이만큼 움직여야 방향을 정한다
const FLING = 0.35; // px/ms 이상으로 놓으면 방향대로
const OPEN_ZONE = 48; // 닫힌 서랍은 왼쪽 끝에서 이만큼(px) 안에서 시작한 쓸기만 받는다(누를 영역 48 과 같은 폭)

/** el 에서 위로 올라가며 가로로 스크롤되는 영역이 있는지 */
function inHorizontalScroller(el: Element | null): boolean {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth) return true;
  }
  return false;
}

/**
 * open: 서랍이 열렸는지. drawer: 서랍 면(폭을 잰다). enabled: 지금 서랍을 쓰는 화면인지(휴대폰).
 * 돌려주는 drag 는 끄는 동안의 연 정도(아니면 null). 화면은 drag ?? (open ? 1 : 0) 으로 그린다
 */
export function useDrawerSwipe(open: Ref<boolean>, drawer: Ref<HTMLElement | null>, enabled: () => boolean) {
  const drag = ref<number | null>(null);
  let start: { id: number; x: number; y: number; from: number } | null = null;
  let engaged = false;
  let last = { x: 0, t: 0, v: 0 };

  function down(e: PointerEvent) {
    if (e.pointerType === "mouse" || !enabled() || start) return;
    const target = e.target as Element;
    if (!open.value && (e.clientX > OPEN_ZONE || target.closest(OWN_DRAG) || inHorizontalScroller(target))) return;
    start = { id: e.pointerId, x: e.clientX, y: e.clientY, from: open.value ? 1 : 0 };
    engaged = false;
    last = { x: e.clientX, t: e.timeStamp, v: 0 };
  }

  function move(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!engaged) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      // 세로로 스크롤하는 중이거나, 닫힌 채 왼쪽으로 · 열린 채 오른쪽으로면 서랍 것이 아니다
      if (Math.abs(dy) > Math.abs(dx) || (start.from === 0 && dx < 0) || (start.from === 1 && dx > 0)) {
        start = null;
        return;
      }
      engaged = true;
    }
    const width = drawer.value?.offsetWidth || 288;
    drag.value = Math.min(1, Math.max(0, start.from + dx / width));
    const dt = e.timeStamp - last.t;
    if (dt > 0) last = { x: e.clientX, t: e.timeStamp, v: (e.clientX - last.x) / dt };
  }

  function up(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return;
    if (engaged && drag.value !== null) {
      open.value = last.v > FLING ? true : last.v < -FLING ? false : drag.value > 0.5;
      // 손을 떼며 오는 누름(뒤 막 닫기 · 링크)은 막는다
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);
    }
    drag.value = null;
    start = null;
  }

  function cancel(e: PointerEvent) {
    if (start && e.pointerId === start.id) {
      drag.value = null;
      start = null;
    }
  }

  function swallow(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  onMounted(() => {
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  });
  onUnmounted(() => {
    window.removeEventListener("pointerdown", down);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
  });

  return { drag };
}
