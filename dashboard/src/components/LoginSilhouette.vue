<template>
  <!-- 로그인 화면의 실루엣(운영자 패널의 미리보기 화면). 실제 LoginView 의 배치를 그 기기의 CSS 크기(vw × vh)로 그린 뒤 틀에 맞춰 줄인다.
       위 막대 섬 셋(가운데 "locked" 는 폭 768 이상) · 화면 높이 18% 의 시계 · 정가운데에서 3% 올린 그림 · 이름 · 로그인 버튼 그룹 · Enter 안내(마우스 기기) · 아래 소스 섬.
       크기는 LoginView 의 클래스 값(md 768 기준으로 두 벌). 낮은 화면(높이 512 이하)의 모양은 그리지 않는다 -->
  <div ref="hostEl" class="absolute inset-0 pointer-events-none overflow-hidden">
    <div class="absolute left-0 top-0 origin-top-left" :style="{ width: `${vw}px`, height: `${vh}px`, transform: `scale(${k})` }">
      <!-- 위 막대 -->
      <span :class="ISLAND" class="left-3 top-3 w-[5.5rem] h-10"></span>
      <span v-if="wide" :class="ISLAND" class="left-1/2 -translate-x-1/2 top-3 w-[6.5rem] h-10"></span>
      <span :class="ISLAND" class="right-3 top-3 w-[12rem] h-10"></span>
      <!-- 시계 -->
      <span class="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-on-surface/55" :style="{ top: '18%', width: wide ? '19rem' : '13rem', height: wide ? '5rem' : '3.5rem' }"></span>
      <!-- 그룹: 정가운데에서 화면 높이 3% 위 -->
      <div class="absolute left-1/2 top-1/2 flex flex-col items-center" :style="{ transform: `translate(-50%, calc(-50% - ${vh * 0.03}px))` }">
        <span class="rounded-full p-0.75 bg-[linear-gradient(45deg,var(--md-primary),var(--md-tertiary))]" :class="wide ? 'size-48' : 'size-44'"><span class="block size-full rounded-full bg-primary-container/80 ring-3 ring-surface"></span></span>
        <span class="mt-4 rounded-full bg-on-surface/55" :class="wide ? 'w-36 h-7' : 'w-32 h-6'"></span>
        <span class="mt-4 flex items-center justify-end rounded-full pane pr-2" :class="wide ? 'w-72 h-13' : 'w-56 h-11'"><span class="rounded-full bg-primary" :class="wide ? 'size-9' : 'size-8'"></span></span>
        <span v-if="mouse" class="mt-3 h-7 w-44 rounded-full pane"></span>
      </div>
      <!-- 아래 소스 섬 -->
      <span :class="ISLAND" class="left-1/2 -translate-x-1/2 bottom-3" :style="{ width: wide ? '14rem' : '12.5rem', height: wide ? '2rem' : '1.75rem' }"></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

/** vw · vh: 그 기기의 CSS 크기(px). mouse: 마우스 기기(Enter 안내가 보인다) */
const props = defineProps<{ vw: number; vh: number; mouse: boolean }>();

/** waybar 섬(LoginView 의 ISLAND 와 같은 재료) */
const ISLAND = "absolute rounded-full pane";
/** LoginView 의 md(폭 768 이상) */
const wide = computed(() => props.vw >= 768);

const hostEl = ref<HTMLElement | null>(null);
const width = ref(0);
const k = computed(() => (width.value ? width.value / props.vw : 0));
let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => (width.value = entry.contentRect.width));
  if (hostEl.value) observer.observe(hostEl.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>
