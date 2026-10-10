// 구르는 칸이 넘치는가(세로 스크롤바가 생기는가). 칸이 생길 때 · 크기가 바뀔 때 · 안의 줄이 바뀔 때 다시 잰다.
// 넘치면 오른쪽 안쪽 여백을 왼쪽보다 3 줄여, 스크롤바 칸 안의 투명 테두리 3 과 합쳐 내용과 막대 사이가 왼쪽 여백과 같아지게 쓴다

import { onBeforeUnmount, ref, watch, type Ref } from "vue";

export function useOverflowing(el: Ref<HTMLElement | null>) {
  const overflowing = ref(false);
  let resize: ResizeObserver | null = null;
  let mutate: MutationObserver | null = null;

  const measure = () => {
    const box = el.value;
    overflowing.value = !!box && box.scrollHeight > box.clientHeight + 1;
  };
  const stop = () => {
    resize?.disconnect();
    mutate?.disconnect();
  };

  // v-if 로 열고 닫는 칸도 있어 칸이 바뀔 때마다 다시 붙인다
  watch(
    el,
    (box) => {
      stop();
      if (!box) return;
      resize = new ResizeObserver(measure);
      resize.observe(box);
      mutate = new MutationObserver(measure);
      mutate.observe(box, { childList: true, subtree: true });
      measure();
    },
    { flush: "post" },
  );
  onBeforeUnmount(stop);
  return overflowing;
}
