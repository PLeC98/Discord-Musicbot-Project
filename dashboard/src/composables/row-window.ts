// 긴 목록을 보이는 만큼만 받고 그린다(행 높이가 정해진 목록). 서버가 거른 수(total)와 받은 구간(have)을 주면,
// 스크롤 위치로 보이는 행을 셈해 위아래 한 화면씩 덤으로 그리고, 나머지는 위 · 아래 빈 칸으로 높이만 채운다.
// 보이는 행이 받은 구간을 벗어나면 100ms 쉬었다 그 둘레를 받는다(request). 아직 받지 못한 자리는 화면이 빈 행 모양으로 그린다

import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { LIST_WINDOW_MAX, type Span } from "../../../src/dashboard/contract/admin.ts";

type Rows = { first: number; last: number };

/** 보이는 행 [first, last). 영역 높이가 0 이면(숨은 탭) null */
export function visibleRows(scrollTop: number, viewHeight: number, rowHeight: number, total: number): Rows | null {
  if (viewHeight <= 0 || rowHeight <= 0) return null;
  const first = Math.min(Math.max(0, Math.floor(scrollTop / rowHeight)), total);
  return { first, last: Math.min(total, Math.ceil((scrollTop + viewHeight) / rowHeight)) };
}

/** 보이는 행 위아래로 한 화면씩 덤을 붙인 구간(total 안, 개수는 LIST_WINDOW_MAX 까지) */
export function aroundRows({ first, last }: Rows, total: number): Span {
  const screen = Math.max(1, last - first);
  const from = Math.max(0, first - screen);
  return { from, count: Math.min(LIST_WINDOW_MAX, Math.min(total, last + screen) - from) };
}

/** 받은 구간이 보이는 행을 다 덮나. 받은 구간은 목록 끝에서 짧다 */
export function covers(have: Span, { first, last }: Rows) {
  return have.from <= first && last <= have.from + have.count;
}

/**
 * el: 스크롤 영역. rowHeight: 행 높이(px). total: 거른 수. have: 받은 구간(시작 · 받은 행 수). request: 그 구간을 받게 한다.
 * 영역이 숨어 높이가 0 이면(v-show 로 숨은 탭) 셈하지도 받게 하지도 않는다.
 * 돌려주는 것: 그릴 구간 [from, to), 위 · 아래 빈 칸 높이, 맨 위로(거르기 · 정렬을 바꿨을 때)
 */
export function useRowWindow(opts: { el: Ref<HTMLElement | null>; rowHeight: () => number; total: () => number; have: () => Span; request: (span: Span) => void }) {
  const scrollTop = ref(0);
  const viewHeight = ref(0);
  const measure = () => {
    scrollTop.value = opts.el.value?.scrollTop ?? 0;
    viewHeight.value = opts.el.value?.clientHeight ?? 0;
  };
  let resize: ResizeObserver | null = null;
  let attached: HTMLElement | null = null;
  const detach = () => {
    attached?.removeEventListener("scroll", measure);
    resize?.disconnect();
    attached = null;
  };
  // v-if 로 늦게 생기는 영역도 있어 영역이 바뀔 때마다 다시 붙인다
  watch(
    opts.el,
    (box) => {
      detach();
      if (!box) return;
      attached = box;
      box.addEventListener("scroll", measure, { passive: true });
      resize = new ResizeObserver(measure);
      resize.observe(box);
      measure();
    },
    { flush: "post", immediate: true },
  );

  const rows = computed(() => visibleRows(scrollTop.value, viewHeight.value, opts.rowHeight(), opts.total()));
  // 숨은 동안은 받은 행을 그대로 그린다(셈할 높이가 없다)
  const range = computed(() => {
    const total = opts.total();
    const vis = rows.value;
    if (!vis) {
      const have = opts.have();
      return { from: Math.min(have.from, total), to: Math.min(total, have.from + have.count) };
    }
    const around = aroundRows(vis, total);
    return { from: around.from, to: around.from + around.count };
  });
  const top = computed(() => range.value.from * opts.rowHeight());
  const bottom = computed(() => Math.max(0, opts.total() - range.value.to) * opts.rowHeight());

  let timer: number | undefined;
  const stopTimer = () => window.clearTimeout(timer);
  watch(
    () => {
      const vis = rows.value;
      return vis && !covers(opts.have(), vis) ? aroundRows(vis, opts.total()) : null;
    },
    (want) => {
      stopTimer();
      if (want) timer = window.setTimeout(() => opts.request(want), 100);
    },
  );
  onBeforeUnmount(() => {
    stopTimer();
    detach();
  });

  function toTop() {
    if (opts.el.value) opts.el.value.scrollTop = 0;
    scrollTop.value = 0;
  }
  return { range, top, bottom, toTop };
}
