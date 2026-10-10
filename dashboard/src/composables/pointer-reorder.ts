// 손잡이를 눌러 끌어 목록의 차례를 바꾼다(마우스 · 터치 · 펜 모두, 포인터 이벤트).
// 브라우저 기본 끌어 놓기(HTML5 drag and drop)는 터치에서 기기마다 되기도 안 되기도 하고(크롬 모바일 시뮬레이션은 아예 시작되지 않는다),
// 손잡이로만 시작하게 하려면 mousedown 으로 켜 둬야 하는데 터치는 그 신호가 손을 뗀 뒤에 온다. 그래서 포인터 이벤트로 직접 셈한다.
//
// 모양은 안드로이드 앱들의 방식(M3 목록의 dragged 상태): 끄는 줄이 들려(그림자 Level 4 · 모서리 16 · 상태 레이어 16%) 손가락을 따라오고,
// 다른 줄은 미끄러지며 자리를 비켜 준다. 넣을 자리를 줄로 긋지 않는다. 놓으면 목록을 바꾸고 그린 위치를 걷는다(이미 그 자리라 튀지 않는다).
//
// 줄마다 data-reorder 를 단다(같은 부모 아래의 형제끼리 차례를 본다). 손잡이에는 touch-none 을 줘 끄는 손가락이 화면을 굴리지 않게 한다.
// 끄는 동안 목록(구르는 가장 가까운 조상) 위아래 끝 48px 안에 들면 그쪽으로 저절로 굴린다(아래 끝은 떠 있는 재생 바가 덮으면 그 윗선).

import { ref } from "vue";

type Options = {
  /** 지금 끌 수 있는지(거절되면 시작하지 않는다) */
  enabled?: () => boolean;
  /** 끌기를 시작했다 */
  start?: () => void;
  /** 끌기가 끝났다(놓음 · 취소 모두, drop 뒤에) */
  end?: () => void;
  /** 놓았다. from 번째를 to 틈(0 ~ 길이)으로(utils/reorder 의 reordered 와 같은 셈) */
  drop: (from: number, to: number) => void;
};

const EDGE = 48; // 저절로 굴리기 시작하는 끝 거리
const SPEED = 14; // 한 프레임에 굴리는 최대 거리
const SLIDE = "transform 200ms cubic-bezier(0.2, 0, 0, 1)"; // 비켜서는 줄(M3 standard)
// 들린 줄: M3 elevation Level 4 그림자 · 모서리 large · dragged 상태 레이어(on-surface 16%)
const LIFTED: Partial<CSSStyleDeclaration> = {
  position: "relative",
  zIndex: "10",
  borderRadius: "16px",
  boxShadow: "0 4px 8px 3px rgb(0 0 0 / 0.15), 0 1px 3px rgb(0 0 0 / 0.3)",
  backgroundColor: "color-mix(in srgb, var(--md-on-surface) 16%, var(--md-surface-container-high))",
  transition: "none",
};

// 끄는 동안 저절로 굴릴 칸. data-reorder-scroller 를 단 칸은 지금 손으로 못 굴리게 막혀 있어도(휴대폰 대기열 판을 반만 열었을 때) 굴린다
function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  for (let p = el; p; p = p.parentElement) {
    if (p.hasAttribute("data-reorder-scroller") && p.scrollHeight > p.clientHeight) return p;
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export function usePointerReorder({ enabled, start, end, drop }: Options) {
  const draggedIndex = ref<number | null>(null);

  let rows: HTMLElement[] = [];
  let scroller: HTMLElement | null = null;
  // 줄마다 끌기 시작 때의 위 · 높이(굴린 거리를 빼 목록 기준으로)
  let tops: number[] = [];
  let heights: number[] = [];
  let shift = 0; // 비켜서는 줄이 움직이는 거리(들린 줄 높이 + 줄 사이)
  let from = 0;
  let pos = 0; // 들린 줄이 지금 갈 자리(새 목록에서의 번호)
  let startY = 0;
  let startScroll = 0;
  let lastY = 0;
  let frame = 0;

  const scrolled = () => (scroller ? scroller.scrollTop : 0) - startScroll;

  // 들린 줄을 손가락에 붙이고, 그 가운데가 넘어선 줄들을 비켜 세운다
  function layout() {
    const dy = lastY - startY + scrolled();
    rows[from].style.transform = `translateY(${dy}px)`;
    const center = tops[from] + heights[from] / 2 + dy;
    let next = from;
    for (let i = from + 1; i < rows.length && center > tops[i] + heights[i] / 2; i++) next = i;
    for (let i = from - 1; i >= 0 && center < tops[i] + heights[i] / 2; i--) next = i;
    pos = next;
    rows.forEach((row, i) => {
      if (i === from) return;
      const move = pos > from && i > from && i <= pos ? -shift : pos < from && i < from && i >= pos ? shift : 0;
      row.style.transform = move ? `translateY(${move}px)` : "";
    });
  }

  // 끝에 가까우면 굴리고, 굴린 만큼 다시 그린다
  function tick() {
    if (draggedIndex.value == null) return;
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      const top = Math.max(box.top, 0);
      // 떠 있는 재생 바가 목록 아래를 덮으면 그 윗선이 아래 끝이다(바 뒤에서는 손가락이 닿기 어렵다)
      const dock = document.querySelector("[data-dock]")?.getBoundingClientRect();
      const bottom = Math.min(box.bottom, window.innerHeight, dock && dock.top < box.bottom ? dock.top : Infinity);
      const dy = lastY < top + EDGE ? -SPEED * (1 - Math.max(0, lastY - top) / EDGE) : lastY > bottom - EDGE ? SPEED * (1 - Math.max(0, bottom - lastY) / EDGE) : 0;
      if (dy) {
        scroller.scrollTop += dy;
        layout();
      }
    }
    frame = requestAnimationFrame(tick);
  }

  function onMove(e: PointerEvent) {
    lastY = e.clientY;
    layout();
  }

  function finish(dropped: boolean) {
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    const moved = rows;
    const target = pos;
    // 그린 위치를 한 번에 걷는다(움직임 없이). 목록을 바꾸면 줄이 이미 그 자리에 있다
    for (const row of moved) {
      row.style.transition = "none";
      row.style.transform = "";
      for (const key of Object.keys(LIFTED)) row.style.removeProperty(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
      row.style.transition = "none";
    }
    requestAnimationFrame(() => requestAnimationFrame(() => moved.forEach((row) => row.style.removeProperty("transition"))));
    draggedIndex.value = null;
    rows = [];
    scroller = null;
    if (dropped && target !== from) drop(from, target > from ? target + 1 : target);
    end?.();
  }
  const onUp = () => finish(true);
  const onCancel = () => finish(false);

  /** 손잡이의 pointerdown 에 단다 */
  function startDrag(e: PointerEvent, i: number) {
    if (draggedIndex.value != null || (e.pointerType === "mouse" && e.button !== 0) || (enabled && !enabled())) return;
    const row = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-reorder]");
    if (!row?.parentElement) return;
    e.preventDefault(); // 글자 고르기 · 화면 굴리기를 막는다
    rows = [...row.parentElement.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute("data-reorder"));
    scroller = scrollerOf(row.parentElement);
    startScroll = scroller ? scroller.scrollTop : 0;
    const rects = rows.map((r) => r.getBoundingClientRect());
    tops = rects.map((r) => r.top);
    heights = rects.map((r) => r.height);
    from = pos = i;
    // 줄 사이: 들린 줄과 이웃 줄의 틈(이웃이 없으면 0)
    const gap = i + 1 < rects.length ? rects[i + 1].top - rects[i].bottom : i > 0 ? rects[i].top - rects[i - 1].bottom : 0;
    shift = heights[i] + Math.max(0, gap);
    rows.forEach((r, at) => (at === i ? Object.assign(r.style, LIFTED) : (r.style.transition = SLIDE)));
    draggedIndex.value = i;
    startY = lastY = e.clientY;
    start?.();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    frame = requestAnimationFrame(tick);
  }

  return { draggedIndex, startDrag };
}
