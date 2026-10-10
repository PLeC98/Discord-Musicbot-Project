<template>
  <!-- 진행 막대(기존 대시보드와 같은 곧은 막대). 지나온 쪽 · SponsorBlock 구간(카테고리 색) · 하이라이트 표시 · 손잡이.
       손잡이는 올리거나 끄는 동안 보이고, 손가락으로 쓰는 기기에서는 늘 보인다. 위치 계산 · 끌기는 부모(seek-bar)가 한다 -->
  <div ref="root" class="group/seek relative flex items-center w-full @container" :style="{ height: `${height}px` }">
    <!-- 막대 · 지나온 쪽 · 구간. 손잡이가 보이는 동안은 손잡이 양옆을 비운다(음량 막대와 같은 틈) -->
    <span class="absolute inset-0 flex items-center" :class="handle && [dragging ? 'mask-(--hole)' : 'group-hover/seek:mask-(--hole) pointer-coarse:mask-(--hole)']" :style="{ '--hole': hole }">
      <span class="absolute inset-x-0 rounded-full bg-on-surface/15" :style="{ height: `${thick}px` }"></span>
      <!-- 지나온 쪽과 손잡이는 transform 으로만 옮긴다(폭 · 위치를 바꾸면 배치 · 그리기를 다시 한다).
           손잡이는 막대 폭(cqw)만큼만 옮긴다. 막대만 한 상자를 옮기면 그 상자가 오른쪽으로 삐져나가 화면이 옆으로 구른다 -->
      <span class="absolute inset-x-0 rounded-full overflow-hidden" :style="{ height: `${thick}px` }"><span class="block size-full rounded-full bg-primary" :style="{ transform: `translateX(${shown - 100}%)` }"></span></span>
      <span v-for="(m, i) in markers" :key="i" v-tooltip="m.label" class="absolute rounded-full opacity-85 hover:opacity-100" :style="{ left: `${m.left}%`, width: `${m.width}%`, height: `${thick}px`, backgroundColor: m.color }"></span>
    </span>
    <span v-if="highlight !== null" v-tooltip="'하이라이트'" class="absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full" :style="{ left: `${highlight}%`, height: `${thick * 3}px`, backgroundColor: 'var(--category-highlight-color)' }"></span>
    <span v-if="handle" class="absolute left-0 top-1/2 pointer-events-none" :style="{ transform: `translate(calc(${shown / 100} * 100cqw - 50%), -50%)` }">
      <span class="block rounded-full bg-primary transition-[opacity,width] duration-150 pointer-coarse:opacity-100" :class="dragging ? 'w-0.5 opacity-100' : 'w-1 opacity-0 group-hover/seek:opacity-100'" :style="{ height: `${thick * 3}px` }"></span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useElementSize } from "@vueuse/core";

type Marker = { left: number; width: number; color: string; label: string };

// value 는 0~100(%). rate 는 재생 중일 때 1초에 나아가는 %(멈췄으면 0). highlight 도 %(없으면 null). thick 은 막대 두께, height 는 누르는 자리의 높이
const props = withDefaults(defineProps<{ value: number; rate?: number; markers?: Marker[]; highlight?: number | null; handle?: boolean; dragging?: boolean; thick?: number; height?: number }>(), {
  rate: 0,
  markers: () => [],
  highlight: null,
  handle: false,
  dragging: false,
  thick: 4,
  height: 16,
});

// 부드럽게 보이되 화면은 적게 그린다: 막대가 1px 나아갈 때마다 한 번 옮긴다(넘김 효과는 매 프레임 그린다).
// 3~4분 곡 · 900px 막대면 1초에 4번쯤. 아주 짧은 곡 · 넓은 막대여도 1초에 20번까지
const MIN_STEP_MS = 50;
const root = ref<HTMLElement | null>(null);
const { width } = useElementSize(root);
const shown = ref(props.value);
let anchor = { value: props.value, at: performance.now() };
// 손잡이 양옆을 비우는 마스크. 손잡이는 음량 막대처럼 세로 막대(폭 4 · 높이 두께의 3배, 끄는 동안 폭 2), 가운데에서 4 까지 비운다(음량 막대와 같은 틈)
const hole = computed(() => {
  const x = `${shown.value}%`;
  return `linear-gradient(to right, #000 calc(${x} - 4px), transparent calc(${x} - 4px), transparent calc(${x} + 4px), #000 calc(${x} + 4px))`;
});

let timer: ReturnType<typeof setTimeout> | undefined;

function step() {
  clearTimeout(timer);
  const moving = props.rate > 0 && !props.dragging;
  shown.value = moving ? Math.min(100, anchor.value + (props.rate * (performance.now() - anchor.at)) / 1000) : props.value;
  if (!moving || shown.value >= 100 || width.value <= 0) return;
  const msPerPx = 100_000 / (props.rate * width.value);
  timer = setTimeout(step, Math.min(1000, Math.max(MIN_STEP_MS, msPerPx)));
}
watch(
  () => props.value,
  (value) => (anchor = { value, at: performance.now() }),
);
watch([() => props.value, () => props.rate, () => props.dragging, width], step, { immediate: true });
onUnmounted(() => clearTimeout(timer));
</script>
