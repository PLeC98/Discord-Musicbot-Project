// 가상 스크롤: 긴 목록을 보이는 만큼만 받고 그린다(행 높이가 정해진 목록). 서버가 필터링한 수(total)와 받은 구간(have)을 주면,
// 스크롤 위치로 보이는 행을 계산해 위아래 한 화면씩 오버스캔으로 그리고, 나머지는 위, 아래 스페이서로 높이만 채운다.
// 보이는 행이 받은 구간을 벗어나면 100ms 쉬었다 그 둘레를 받는다(request). 아직 받지 못한 자리는 화면이 스켈레톤 행으로 그린다

import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { LIST_WINDOW_MAX, type Span } from "../../../src/dashboard/contract/admin.ts";

type Rows = { first: number; last: number };

/** 보이는 행 [first, last). 영역 높이가 0 이면(숨은 탭) null */
export function visibleRows(scrollTop: number, viewHeight: number, rowHeight: number, total: number): Rows | null {
  if (viewHeight <= 0 || rowHeight <= 0) return null;
  const first = Math.min(Math.max(0, Math.floor(scrollTop / rowHeight)), total);
  return { first, last: Math.min(total, Math.ceil((scrollTop + viewHeight) / rowHeight)) };
}

/** 보이는 행 위아래로 한 화면씩 오버스캔을 붙인 구간(total 안, 개수는 LIST_WINDOW_MAX 까지) */
export function aroundRows({ first, last }: Rows, total: number): Span {
  const screen = Math.max(1, last - first);
  const from = Math.max(0, first - screen);
  return { from, count: Math.min(LIST_WINDOW_MAX, Math.min(total, last + screen) - from) };
}

/** 받은 구간이 보이는 행을 다 덮나. 받은 구간은 목록 끝에서 짧다 */
export function covers(have: Span, { first, last }: Rows) {
  return have.from <= first && last <= have.from + have.count;
}

/** 그릴 구간 [from, to): 보이는 행 위아래 한 화면씩, keep(드래그 중인 행)이 밖이면 거기까지 이어서. 숨었으면(vis 가 null) 비운다(at 에서 스페이서만) */
export function drawnRows(vis: Rows | null, total: number, keep: number | null, at: number) {
  if (!vis) return { from: Math.min(at, total), to: Math.min(at, total) };
  const around = aroundRows(vis, total);
  const to = around.from + around.count;
  return keep === null || keep >= total ? { from: around.from, to } : { from: Math.min(around.from, keep), to: Math.max(to, keep + 1) };
}

/** 그릴 구간의 자리마다 번호와 받은 행(받지 못한 자리는 row 가 null 이라 화면이 스켈레톤 행으로 그린다). from, rows: 받은 구간 */
export function slotsOf<T>(range: { from: number; to: number }, from: number, rows: readonly T[], keyOf: (row: T, index: number) => string | number) {
  return Array.from({ length: range.to - range.from }, (_, k) => {
    const index = range.from + k;
    const row = rows[index - from];
    return row ? { key: keyOf(row, index), row, index } : { key: `slot-${index}`, row: null, index };
  });
}

/**
 * el: 스크롤 영역. rowHeight: 행 높이(px). total: 필터링된 수. have: 받은 구간(시작, 받은 행 수). request: 그 구간을 받게 한다(다 받아 둔 목록은 없다).
 * keep: 구간 밖이어도 그려 둘 행(드래그 중인 행. 드래그하는 동안 자동 스크롤로 구간이 옮겨 가도 그 행까지 이어 그린다).
 * 영역이 숨어 높이가 0 이면(v-show 로 숨은 탭) 행을 그리지도 받게 하지도 않는다(스페이서로 높이만).
 * 돌려주는 것: 그릴 구간 [from, to), 위, 아래 스페이서 높이, 맨 위로(필터링, 정렬을 바꿨을 때)
 */
export function useRowWindow(opts: { el: Ref<HTMLElement | null>; rowHeight: () => number; total: () => number; have: () => Span; request?: (span: Span) => void; keep?: () => number | null }) {
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
  // 필터링된 수가 줄면(나가기, 필터링으로 서버가 구간을 당겼다) 브라우저가 스크롤 위치를 당긴다. 스크롤 알림에 기대지 않고 그린 뒤 다시 읽는다
  watch(() => [opts.total(), opts.rowHeight()], measure, { flush: "post" });

  const rows = computed(() => visibleRows(scrollTop.value, viewHeight.value, opts.rowHeight(), opts.total()));
  const range = computed(() => drawnRows(rows.value, opts.total(), opts.keep?.() ?? null, opts.have().from));
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
      if (want && opts.request) timer = window.setTimeout(() => opts.request?.(want), 100);
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
