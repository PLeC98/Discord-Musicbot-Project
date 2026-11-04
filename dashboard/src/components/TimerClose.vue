<template>
  <!-- 닫기. 둘레의 고리가 남은 시간만큼 줄어들고, 다 줄면 저절로 닫는다(디스코드 메뉴처럼). 고리는 남은 시간이라 움직임 줄이기에도 돈다(data-keep-motion) -->
  <button type="button" :class="iconButton(32, 'plain')" :disabled="paused" v-tooltip="paused && pausedTip ? pausedTip : text.common.closeIn(secondsLeft)" :aria-label="text.common.close" @click="emit('close')">
    <svg class="absolute inset-0 -rotate-90 pointer-events-none" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2" class="opacity-15" />
      <circle :key="timerKey" cx="16" cy="16" r="14" fill="none" stroke="var(--md-primary)" stroke-width="2" stroke-linecap="round" :stroke-dasharray="RING" stroke-dashoffset="0" class="ring-drain" data-keep-motion :style="{ animationDuration: `${ms}ms`, animationPlayState: paused ? 'paused' : 'running' }" />
    </svg>
    <Icon name="close" :size="20" />
  </button>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import Icon from "./BaseIcon.vue";
import { iconButton } from "../utils/icon-button.ts";
import { text } from "../text/index.ts";

/**
 * ms: 저절로 닫히기까지(ms). round 가 바뀌면 처음부터 다시 센다(같은 자리에 새 내용이 왔을 때).
 * paused: 그동안 멈추고 누를 수 없다(끝나면 멈춘 시점부터 이어 센다). pausedTip 은 그동안의 툴팁
 */
const props = withDefaults(defineProps<{ ms: number; round?: unknown; paused?: boolean; pausedTip?: string }>(), { round: undefined, paused: false, pausedTip: "" });
/** close: 눌렀거나 시간이 다 됐다 */
const emit = defineEmits<{ close: [] }>();

const RING = 2 * Math.PI * 14;
const timerKey = ref(0);
const secondsLeft = ref(Math.ceil(props.ms / 1000));
let deadline = 0;
let pausedLeft = 0;
let tick: ReturnType<typeof setInterval> | null = null;

function stop() {
  if (tick !== null) clearInterval(tick);
  tick = null;
}

function run(ms: number) {
  stop();
  deadline = Date.now() + ms;
  const step = () => {
    const left = deadline - Date.now();
    secondsLeft.value = Math.max(0, Math.ceil(left / 1000));
    if (left <= 0) {
      stop();
      emit("close");
    }
  };
  step();
  tick = setInterval(step, 250);
}

function restart() {
  timerKey.value++; // 고리 애니메이션을 처음부터
  pausedLeft = 0;
  if (!props.paused) run(props.ms);
}

watch(() => props.round, restart, { immediate: true });
watch(
  () => props.paused,
  (paused) => {
    if (paused) {
      pausedLeft = Math.max(0, deadline - Date.now());
      stop();
    } else if (tick === null) {
      run(pausedLeft || props.ms);
    }
  },
);
onBeforeUnmount(stop);
</script>

<style scoped>
.ring-drain {
  animation-name: ring-drain;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
@keyframes ring-drain {
  to {
    stroke-dashoffset: 87.965; /* 2π × 14. RING과 같다 */
  }
}
</style>
