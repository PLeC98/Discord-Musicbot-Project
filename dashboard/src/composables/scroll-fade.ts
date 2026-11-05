// 스크롤 영역의 가장자리를 페이드로 지운다. 더 볼 것이 있는 쪽만(맨 위면 위는 그대로, 맨 끝이면 끝은 그대로).
// 바탕이 단색이 아니라(배경화면이 비치는 막) 곧은 선으로 잘리면 어색해 마스크로 투명하게 사라지게 한다

import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";

/** 페이드 길이(px). 영역마다 바꿀 수 있다 */
const FADE = 24;

/** again: 영역 크기, 자식 목록 밖에서 스크롤 길이가 바뀌는 신호(가상 스크롤 목록의 스페이서 높이). 바뀌면 다시 잰다 */
export function useScrollFade(el: Ref<HTMLElement | null>, vertical: () => boolean, fade = FADE, again?: () => unknown) {
  const start = ref(false);
  const end = ref(false);

  function measure() {
    const box = el.value;
    if (!box) return;
    const [pos, view, full] = vertical() ? [box.scrollTop, box.clientHeight, box.scrollHeight] : [box.scrollLeft, box.clientWidth, box.scrollWidth];
    start.value = pos > 1;
    end.value = pos + view < full - 1;
  }

  // 영역 크기, 안의 내용(서버가 늘거나 줄면)이 바뀔 때도 다시 잰다. v-if 로 늦게 생기는 영역도 있어 영역이 바뀔 때마다 다시 붙인다
  let resize: ResizeObserver | null = null;
  let mutate: MutationObserver | null = null;
  let attached: HTMLElement | null = null;
  const detach = () => {
    attached?.removeEventListener("scroll", measure);
    resize?.disconnect();
    mutate?.disconnect();
    attached = null;
  };
  watch(
    el,
    (box) => {
      detach();
      if (!box) return;
      attached = box;
      box.addEventListener("scroll", measure, { passive: true });
      resize = new ResizeObserver(measure);
      resize.observe(box);
      mutate = new MutationObserver(measure);
      mutate.observe(box, { childList: true });
      measure();
    },
    { flush: "post", immediate: true },
  );
  if (again) watch(again, measure, { flush: "post" });
  onBeforeUnmount(detach);

  const style = computed(() => {
    const a = start.value ? fade : 0;
    const b = end.value ? fade : 0;
    if (!a && !b) return {};
    const mask = `linear-gradient(${vertical() ? "to bottom" : "to right"}, transparent 0, #000 ${a}px, #000 calc(100% - ${b}px), transparent 100%)`;
    return { maskImage: mask, WebkitMaskImage: mask };
  });
  return style;
}
