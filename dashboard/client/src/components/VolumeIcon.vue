<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true" class="volume-icon inline-block shrink-0">
    <path d="M3 9v6h4l5 5V4L7 9H3z" fill="currentColor" />
    <g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
      <path class="part" :class="{ on: waves >= 1 }" d="M14 9.2a4 4 0 0 1 0 5.6" />
      <path class="part" :class="{ on: waves >= 2 }" d="M16.1 7.05a7 7 0 0 1 0 9.9" />
      <path class="part" :class="{ on: waves >= 3 }" d="M18.2 4.9a10 10 0 0 1 0 14.2" />
      <path class="part mute" :class="{ on: level <= 0 }" d="M15.5 9.5l5 5m0-5-5 5" />
    </g>
  </svg>
</template>

<script setup>
import { computed } from "vue";

// 음량 단계별 아이콘. 0 은 음소거 표시, 1~33 · 34~66 · 67~100 은 물결 하나 · 둘 · 셋.
// 단계가 바뀌면 물결과 음소거 표시가 커지며 나타나고 줄며 사라진다
const props = defineProps({
  level: { type: Number, default: 100 },
  size: { type: [Number, String], default: 18 },
});

const waves = computed(() => (props.level <= 0 ? 0 : props.level <= 33 ? 1 : props.level <= 66 ? 2 : 3));
</script>

<style scoped>
.part {
  opacity: 0;
  transform: scale(0.6);
  transform-box: view-box;
  transform-origin: 11px 12px;
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.mute {
  transform-origin: 18px 12px;
}
.part.on {
  opacity: 1;
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .part {
    transition: none;
  }
}
</style>
