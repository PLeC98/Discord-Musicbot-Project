<!--
  두 점으로 잡는 구간 슬라이더.

  양 끝까지 벌리면 "구간 없음"이다. 그때는 null 을 올려 설정에서 아예 뺀다.
  슬라이더로는 빈 값을 나타낼 수 없으니, 끝까지 벌린 상태를 그 뜻으로 삼는다.

  range 입력 둘을 겹쳐 쓴다. 겹친 채로 두면 아래 칸을 못 잡으므로 손잡이만 눌리게 하고(pointer-events),
  둘이 한자리에 모였을 때는 앞쪽 손잡이를 위로 올린다.
-->
<template>
  <div>
    <div class="flex items-center justify-between mb-1">
      <span class="text-[0.78rem] text-fg-soft tabular-nums">{{ text }}</span>
      <button v-if="from != null || to != null" type="button" :class="clearBtn" @click="emit('update', { from: null, to: null })">초기화</button>
    </div>

    <div class="relative h-5 select-none">
      <div class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/10"></div>
      <div class="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-accent/70" :style="fill"></div>
      <input type="range" :min="min" :max="max" :step="step" :value="lo" :class="loOnTop ? 'z-20' : 'z-10'" :aria-label="`${label} 시작`" @input="set(+$event.target.value, hi)" />
      <input type="range" :min="min" :max="max" :step="step" :value="hi" class="z-10" :aria-label="`${label} 끝`" @input="set(lo, +$event.target.value)" />
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  from: { type: Number, default: null },
  to: { type: Number, default: null },
  label: { type: String, default: "" },
});
const emit = defineEmits(["update"]);

const clearBtn = "text-[0.72rem] text-muted cursor-pointer hover:text-fg-soft transition-colors duration-150";

// 설정에 적힌 값이 범위 밖일 수 있다(저쪽 자료가 늘거나 손으로 적었거나).
// 보이기만 맞춰 두고 값은 건드리지 않는다. 손잡이를 옮길 때 비로소 바뀐다.
const clamp = (v) => Math.min(props.max, Math.max(props.min, v));
const lo = computed(() => clamp(props.from ?? props.min));
const hi = computed(() => Math.max(lo.value, clamp(props.to ?? props.max)));

const whole = computed(() => lo.value <= props.min && hi.value >= props.max);
const text = computed(() => (whole.value ? "전체" : `${lo.value} ~ ${hi.value}`));

// 앞쪽 손잡이가 오른쪽 끝에 가면 뒤쪽 손잡이에 깔려 잡히지 않는다
const loOnTop = computed(() => lo.value > (props.min + props.max) / 2);

const pct = (v) => ((v - props.min) / Math.max(1, props.max - props.min)) * 100;
const fill = computed(() => ({ left: `${pct(lo.value)}%`, right: `${100 - pct(hi.value)}%` }));

function set(a, b) {
  // 손잡이가 서로를 지나치면 붙여 세운다
  const next = { from: Math.min(a, b), to: Math.max(a, b) };
  emit("update", next.from <= props.min && next.to >= props.max ? { from: null, to: null } : next);
}
</script>

<style scoped>
/* 겹쳐 놓은 두 칸. 칸 전체가 아니라 손잡이만 눌려야 아래 칸도 잡을 수 있다 */
input[type="range"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  background: none;
  pointer-events: none;
  appearance: none;
  -webkit-appearance: none;
}

input[type="range"]::-webkit-slider-runnable-track {
  background: transparent;
}

input[type="range"]::-webkit-slider-thumb {
  pointer-events: auto;
  appearance: none;
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent-hover);
  border: 2px solid rgba(255, 255, 255, 0.85);
  cursor: grab;
}

input[type="range"]::-moz-range-track {
  background: transparent;
}

input[type="range"]::-moz-range-thumb {
  pointer-events: auto;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent-hover);
  border: 2px solid rgba(255, 255, 255, 0.85);
  cursor: grab;
}

input[type="range"]:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 3px var(--accent-glow);
}

input[type="range"]:focus-visible::-moz-range-thumb {
  box-shadow: 0 0 0 3px var(--accent-glow);
}
</style>
