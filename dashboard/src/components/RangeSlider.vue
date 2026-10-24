<!--
  두 점으로 잡는 구간 슬라이더.

  양 끝까지 벌리면 "구간 없음"이다. 그때는 null 을 올려 설정에서 아예 뺀다.
  슬라이더로는 빈 값을 나타낼 수 없으니, 끝까지 벌린 상태를 그 뜻으로 삼는다.

  range 입력 둘을 겹쳐 쓴다. 겹친 채로 두면 아래 슬라이더를 못 잡으므로 핸들만 눌리게 하고(pointer-events),
  둘이 한자리에 모였을 때는 앞쪽 핸들을 위로 올린다.

  histogram 을 주면 막대로 그린다. 값이 고르게 퍼져 있지 않은 항목에서는 이것이 있어야
  사용자가 선택한 구간에 후보가 몇 곡이나 남는지 짐작할 수 있다.
-->
<template>
  <div>
    <div class="flex items-center justify-between mb-1">
      <span class="text-xs text-on-surface-variant nums">{{ rangeText }}</span>
      <button v-if="from != null || to != null" type="button" :class="clearBtn" @click="emit('update', { from: null, to: null })">{{ text.common.reset }}</button>
    </div>

    <div v-if="bars.length" class="flex items-end gap-px h-8 mb-1" aria-hidden="true">
      <div v-for="(bar, i) in bars" :key="i" class="flex-1 rounded-t-[1px] bg-on-surface/12" :style="{ height: `${bar.height}%`, backgroundImage: bar.paint }"></div>
    </div>

    <div class="relative h-5 select-none">
      <div class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-secondary-container"></div>
      <div class="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-primary" :style="fill"></div>
      <input type="range" :min="min" :max="max" :step="step" :value="lo" :class="loOnTop ? 'z-20' : 'z-10'" :aria-label="text.fields.rangeStart(label)" @input="set(+valueOf($event), hi)" />
      <input type="range" :min="min" :max="max" :step="step" :value="hi" class="z-10" :aria-label="text.fields.rangeEnd(label)" @input="set(lo, +valueOf($event))" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { valueOf } from "../utils/dom.ts";
import { text } from "../text/index.ts";

const props = withDefaults(
  defineProps<{
    min?: number;
    max?: number;
    step?: number;
    from?: number | null;
    to?: number | null;
    label?: string;
    /** min 부터 한 칸씩의 개수. 길이가 범위와 달라도 비율로 맞춰 그린다 */
    histogram?: number[];
  }>(),
  { min: 0, max: 100, step: 1, from: null, to: null, label: "", histogram: () => [] },
);
/** 선택한 구간. 전체면 둘 다 null */
const emit = defineEmits<{ update: [range: { from: number | null; to: number | null }] }>();

const clearBtn = "text-xs text-on-surface-variant cursor-pointer hover:text-on-surface transition-colors duration-150";

// 설정에 적힌 값이 범위 밖일 수 있다(저쪽 자료가 늘거나 손으로 적었거나).
// 보이기만 맞춰 두고 값은 건드리지 않는다. 핸들을 옮길 때 비로소 바뀐다.
const clamp = (v: number) => Math.min(props.max, Math.max(props.min, v));
const lo = computed(() => clamp(props.from ?? props.min));
const hi = computed(() => Math.max(lo.value, clamp(props.to ?? props.max)));

const whole = computed(() => lo.value <= props.min && hi.value >= props.max);
const rangeText = computed(() => (whole.value ? text.common.all : `${lo.value} ~ ${hi.value}`));

// 앞쪽 핸들이 오른쪽 끝에 가면 뒤쪽 핸들에 깔려 잡히지 않는다
const loOnTop = computed(() => lo.value > (props.min + props.max) / 2);

const pct = (v: number) => ((v - props.min) / Math.max(1, props.max - props.min)) * 100;
const fill = computed(() => ({ left: `${pct(lo.value)}%`, right: `${100 - pct(hi.value)}%` }));

// 막대 수. 다섯의 배수로 둔다. 다섯 칸마다 세면 눈짐작이 빠르다.
// 막대가 너무 많으면 화면에서 1픽셀도 안 되므로 상한을 둔다.
// 칠하는 색. 배경색 위에 그림으로 얹는 것이라 bg-primary/55 같은 클래스로는 안 된다
const BAR_ON = "color-mix(in srgb, var(--md-primary) 55%, transparent)";
const BARS_MAX = 50;
const BARS_STEP = 5;

const bars = computed(() => {
  const raw = (props.histogram || []).map((v) => Number(v) || 0);
  if (raw.length < 2) return [];
  const count = Math.max(BARS_STEP, Math.floor(Math.min(BARS_MAX, raw.length) / BARS_STEP) * BARS_STEP);

  // 칸 수가 막대 수로 나누어떨어지지 않으므로 막대마다 폭이 조금씩 다르다.
  const groups: Array<{ sum: number; at: number; end: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const at = Math.floor((i * raw.length) / count);
    const end = Math.max(at + 1, Math.floor(((i + 1) * raw.length) / count));
    groups.push({ sum: raw.slice(at, end).reduce((a, b) => a + b, 0), at, end });
  }

  // 한 칸이 압도적으로 크면 나머지가 다 납작해진다. 제곱근으로 눌러 모양이 보이게 한다
  const top = Math.max(...groups.map((g) => Math.sqrt(g.sum)));
  // 선택한 구간을 칸 번호로 옮긴 것. 끝은 포함이라 1 을 더한다
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

function set(a: number, b: number) {
  // 핸들이 서로를 지나치면 붙여 세운다
  const next = { from: Math.min(a, b), to: Math.max(a, b) };
  emit("update", next.from <= props.min && next.to >= props.max ? { from: null, to: null } : next);
}
</script>

<style scoped>
/* 겹쳐 놓은 두 슬라이더. 슬라이더 전체가 아니라 핸들만 눌려야 아래 슬라이더도 잡을 수 있다 */
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
  width: 4px;
  height: 16px;
  border: 0;
  border-radius: 999px;
  background: var(--md-primary);
  cursor: grab;
}

input[type="range"]::-moz-range-track {
  background: transparent;
}

input[type="range"]::-moz-range-thumb {
  pointer-events: auto;
  width: 4px;
  height: 16px;
  border: 0;
  border-radius: 999px;
  background: var(--md-primary);
  cursor: grab;
}

input[type="range"]:focus-visible::-webkit-slider-thumb {
  outline: 3px solid var(--md-secondary);
  outline-offset: 2px;
}

input[type="range"]:focus-visible::-moz-range-thumb {
  outline: 3px solid var(--md-secondary);
  outline-offset: 2px;
}
</style>
