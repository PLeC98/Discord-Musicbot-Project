// 대기열에서 여러 곡 고르기. 곡은 대기열 ID로 기억한다(목록이 바뀌어도 그 곡, 목록에서 사라지면 뺀다).
// 마우스는 Ctrl(맥은 Cmd)+클릭으로 더하고 빼고, Shift+클릭으로 기준 곡부터 그 곡까지 더한다. 손가락은 길게 눌러 고르기를 시작한다.
// 고르는 동안에는 그냥 눌러도 더하고 뺀다. 뺄 수 없는 곡(남이 넣은 곡 등)은 고르지 않는다

import { computed, ref, watch } from "vue";

/** 길게 누르기로 보는 시간(ms) */
const LONG_PRESS_MS = 500;
/** 누른 채 이만큼(px) 움직이면 스크롤로 보고 길게 누르기를 그만둔다 */
const SLOP_PX = 8;

type Row = { entry: number | null };

export function useQueueSelect<T extends Row>({ rows, selectable }: { rows: () => T[]; selectable: (row: T) => boolean }) {
  const picked = ref(new Set<number>());
  // Shift+클릭 구간의 시작 곡. 마지막으로 하나를 더하거나 뺀 곡
  let anchor: number | null = null;
  const selecting = computed(() => picked.value.size > 0);
  const count = computed(() => picked.value.size);
  const isPicked = (row: T) => row.entry !== null && picked.value.has(row.entry);

  watch(rows, (list) => {
    if (!selecting.value) return;
    const have = new Set(list.map((r) => r.entry));
    const kept = [...picked.value].filter((e) => have.has(e));
    if (kept.length !== picked.value.size) picked.value = new Set(kept);
    if (anchor !== null && !have.has(anchor)) anchor = null;
  });

  function toggle(row: T) {
    if (row.entry === null || !selectable(row)) return;
    const next = new Set(picked.value);
    if (next.has(row.entry)) next.delete(row.entry);
    else next.add(row.entry);
    picked.value = next;
    anchor = row.entry;
  }

  function extendTo(row: T) {
    const list = rows();
    const from = list.findIndex((r) => r.entry === anchor);
    const to = list.indexOf(row);
    if (from < 0 || to < 0) return toggle(row);
    const next = new Set(picked.value);
    for (const r of list.slice(Math.min(from, to), Math.max(from, to) + 1)) if (r.entry !== null && selectable(r)) next.add(r.entry);
    picked.value = next;
  }

  function clear() {
    picked.value = new Set();
    anchor = null;
  }

  // 행 안의 버튼(빼기, 옮기기 손잡이)을 누른 것은 그 버튼이 받는다. 행 바깥의 조상은 보지 않는다(휴대폰 시트는 펼치기 전에 목록째 touch-none 이다)
  function ownControl(e: Event) {
    const row = e.currentTarget;
    const own = e.target instanceof Element ? e.target.closest("button, a, .touch-none") : null;
    return Boolean(own && row instanceof Element && own !== row && row.contains(own));
  }

  // 길게 누르기. 누른 손가락이 놓이면 브라우저가 click 을 보내므로 그 click 은 한 번 버린다(고른 곡을 바로 빼지 않게)
  let press: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  let swallowClick = false;
  // 마지막으로 누른 것이 손가락인가(길게 누르면 휴대폰이 띄우는 메뉴를 막을지)
  let lastTouch = false;
  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }
  function pressStart(e: PointerEvent, row: T) {
    lastTouch = e.pointerType !== "mouse";
    if (!lastTouch || selecting.value || !selectable(row) || ownControl(e)) return;
    cancelPress();
    press = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press = null;
        swallowClick = true;
        toggle(row);
      }, LONG_PRESS_MS),
    };
  }
  function pressMove(e: PointerEvent) {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP_PX) cancelPress();
  }

  /** 행을 눌렀다 */
  function rowClick(e: MouseEvent, row: T) {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    if (ownControl(e)) return;
    if (e.shiftKey && anchor !== null) extendTo(row);
    else if (e.shiftKey || e.ctrlKey || e.metaKey || selecting.value) toggle(row);
  }

  /** 길게 누르면 휴대폰이 띄우는 메뉴(복사 등)를 막는다 */
  function rowContextMenu(e: MouseEvent) {
    if (lastTouch) e.preventDefault();
  }

  /** 고른 곡의 대기열 ID(목록 차례) */
  const entries = () => rows().flatMap((r) => (r.entry !== null && picked.value.has(r.entry) ? [r.entry] : []));

  return { selecting, count, isPicked, entries, clear, rowClick, rowContextMenu, pressStart, pressMove, cancelPress };
}
