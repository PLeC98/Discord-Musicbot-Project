<!--
  두 점으로 잡는 구간 슬라이더.

  양 끝까지 벌리면 "구간 없음"이다. 그때는 null 을 올려 설정에서 아예 뺀다.
  슬라이더로는 빈 값을 나타낼 수 없으니, 끝까지 벌린 상태를 그 뜻으로 삼는다.

  range 입력 둘을 겹쳐 쓴다. 겹친 채로 두면 아래 칸을 못 잡으므로 손잡이만 눌리게 하고(pointer-events),
  둘이 한자리에 모였을 때는 앞쪽 손잡이를 위로 올린다.

  histogram 을 주면 막대로 그린다. 값이 고르게 퍼져 있지 않은 칸에서는 이것이 있어야
  사용자가 고른 구간에 후보가 몇 곡이나 남는지 짐작할 수 있다.
-->
<template>
  <div>
    <div class="flex items-center justify-between mb-1">
      <span class="text-[0.78rem] text-fg-soft tabular-nums">{{ text }}</span>
      <button v-if="from != null || to != null" type="button" :class="clearBtn" @click="emit('update', { from: null, to: null })">초기화</button>
    </div>

    <div v-if="bars.length" class="flex items-end gap-px h-8 mb-0.5" aria-hidden="true">
      <div v-for="(bar, i) in bars" :key="i" class="flex-1 rounded-t-[1px] bg-white/10" :style="{ height: `${bar.height}%`, backgroundImage: bar.paint }"></div>
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
  // min 부터 한 칸씩의 개수. 길이가 범위와 달라도 비율로 맞춰 그린다
  histogram: { type: Array, default: () => [] },
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

// 막대 수. 다섯의 배수로 둔다. 다섯 칸마다 세면 눈짐작이 빠르다.
// 막대가 너무 많으면 화면에서 1픽셀도 안 되므로 상한을 둔다.
// 칠하는 색. 배경색 위에 그림으로 얹는 것이라 bg-accent/55 같은 클래스로는 안 된다
const BAR_ON = "color-mix(in srgb, var(--accent) 55%, transparent)";
const BARS_MAX = 50;
const BARS_STEP = 5;

const bars = computed(() => {
  const raw = (props.histogram || []).map((v) => Number(v) || 0);
  if (raw.length < 2) return [];
  const count = Math.max(BARS_STEP, Math.floor(Math.min(BARS_MAX, raw.length) / BARS_STEP) * BARS_STEP);

  // 칸 수가 막대 수로 나누어떨어지지 않으므로 막대마다 폭이 조금씩 다르다.
  const groups = [];
  for (let i = 0; i < count; i += 1) {
    const at = Math.floor((i * raw.length) / count);
    const end = Math.max(at + 1, Math.floor(((i + 1) * raw.length) / count));
    groups.push({ sum: raw.slice(at, end).reduce((a, b) => a + b, 0), at, end });
  }

  // 한 칸이 압도적으로 크면 나머지가 다 납작해진다. 제곱근으로 눌러 모양이 보이게 한다
  const top = Math.max(...groups.map((g) => Math.sqrt(g.sum)));
  // 고른 구간을 칸 번호로 옮긴 것. 끝은 포함이라 1 을 더한다
  const pickFrom = lo.value - props.min;
  const pickTo = hi.value - props.min + 1;

  return groups.map((g) => {
    const width = g.end - g.at;
    // 구간이 막대 중간에 걸리면 걸린 만큼만 칠한다
    const from = Math.min(Math.max((pickFrom - g.at) / width, 0), 1) * 100;
    const to = Math.min(Math.max((pickTo - g.at) / width, 0), 1) * 100;
    return {
      height: top > 0 ? Math.max(2, (Math.sqrt(g.sum) / top) * 100) : 2,
      paint: to > from ? `linear-gradient(to right, transparent ${from}%, ${BAR_ON} ${from}%, ${BAR_ON} ${to}%, transparent ${to}%)` : "none",
    };
  });
});

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
