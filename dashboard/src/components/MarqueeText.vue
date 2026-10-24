<template>
  <!-- 영역보다 긴 글은 천천히 흘려 보여 준다. 기본은 좌우로 오가고, loop 면 뉴스 티커처럼 한 방향으로 흐르며 같은 글 사본이 간격(3em)을 두고 뒤따라 이어진다(스포티파이 재생 화면).
       짧으면 그대로, 움직임 줄이기를 켰으면 "…" 로 자른다.
       양끝을 FADE 만큼 흐리게 지우되, 겉을 그만큼 바깥으로 넓혀(음수 여백) 멈춰 있는 글의 첫 글자는 흐려지지 않게 한다 -->
  <!-- tip: 넘칠 때(흐르거나 "…" 로 잘릴 때)만 전체 글을 툴팁으로 -->
  <span ref="box" class="block overflow-hidden whitespace-nowrap" :class="reduced && 'truncate'" :style="moving ? edge : undefined" v-tooltip="tip && cut ? text : null">
    <span ref="track" :class="reduced ? 'inline' : 'inline-flex'"
      ><span ref="line">{{ text }}</span
      ><span v-if="loop && moving" class="pl-[3em]" aria-hidden="true">{{ text }}</span></span
    >
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useMediaQuery, useResizeObserver } from "@vueuse/core";
import { rem } from "../utils/rem.ts";

/** loop: 한 방향으로 흘러 이어지게(아니면 오간다) */
const props = defineProps<{ text: string; tip?: boolean; loop?: boolean }>();

/** 흐리게 지우는 길이(rem). 글자 크기를 키우면 같이 넓어진다 */
const FADE_REM = 0.5;
/** 오가는 빠르기(rem/초, 가감속 없이 고르게. 기본 글자 크기면 18px/초)와 양끝에서 멈추는 시간(ms) */
const SPEED_REM = 1.125;
const REST = 2200;
/** loop 의 빠르기(rem/초, 40px/초). 글이 한 방향으로 계속 흘러 오갈 때보다 빠르게 */
const LOOP_SPEED_REM = 2.5;

const box = ref<HTMLElement | null>(null);
const line = ref<HTMLElement | null>(null);
const track = ref<HTMLElement | null>(null);
const moving = ref(false);
/** 영역보다 긴가(움직임 줄이기로 흐르지 않을 때도) */
const cut = ref(false);
const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
let run: Animation | null = null;

const mask = `linear-gradient(to right, transparent, #000 ${FADE_REM}rem, #000 calc(100% - ${FADE_REM}rem), transparent)`;
const edge = { marginInline: `-${FADE_REM}rem`, paddingInline: `${FADE_REM}rem`, maskImage: mask, WebkitMaskImage: mask };

// 넘치는 만큼만 옮긴다. transform 애니메이션이라 그리기는 합성기가 맡는다
function measure() {
  run?.cancel();
  run = null;
  const el = box.value;
  const text = line.value;
  const mover = track.value;
  if (!el || !text || !mover) return void (moving.value = cut.value = false);
  const view = el.clientWidth - (moving.value ? rem(FADE_REM) * 2 : 0);
  const over = text.scrollWidth - view;
  cut.value = over > 1;
  moving.value = cut.value && !reduced.value;
  if (!moving.value) return;
  if (props.loop) {
    // 첫 글과 간격만큼 옮기면 사본이 처음 위치에 와서, 처음으로 돌아가도 이어져 보인다. 처음에만 쉰다
    const gap = parseFloat(getComputedStyle(text).fontSize) * 3;
    const shift = text.scrollWidth + gap;
    const travel = (shift / rem(LOOP_SPEED_REM)) * 1000;
    const total = REST + travel;
    run = mover.animate(
      [
        { transform: "translateX(0)", offset: 0 },
        { transform: "translateX(0)", offset: REST / total },
        { transform: `translateX(-${shift}px)`, offset: 1 },
      ],
      { duration: total, iterations: Infinity },
    );
    return;
  }
  const travel = (over / rem(SPEED_REM)) * 1000;
  const total = REST * 2 + travel * 2;
  const at = (ms: number) => ms / total;
  run = mover.animate(
    [
      { transform: "translateX(0)", offset: 0 },
      { transform: "translateX(0)", offset: at(REST) },
      { transform: `translateX(-${over}px)`, offset: at(REST + travel) },
      { transform: `translateX(-${over}px)`, offset: at(REST * 2 + travel) },
      { transform: "translateX(0)", offset: 1 },
    ],
    { duration: total, iterations: Infinity },
  );
}

useResizeObserver(box, () => measure());
// 글이 바뀌면 그리기 전에 흐름을 먼저 멈춘다. 그러지 않으면 다음 프레임에 재기 전까지 앞 글의 상태(흐름 · 사본)로 새 글이 한 번 그려진다(짧은 제목 뒤에 사본이 붙어 보인다)
watch(
  () => props.text,
  () => {
    run?.cancel();
    run = null;
    moving.value = false;
  },
  { flush: "pre" },
);
watch([() => props.text, reduced, () => props.loop], () => requestAnimationFrame(measure), { immediate: true });
onBeforeUnmount(() => run?.cancel());
</script>
