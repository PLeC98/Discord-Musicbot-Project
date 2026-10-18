<template>
  <!-- 작은 흐름 그래프. 세로축은 0 부터 max 까지 고정(값이 작아도 크게 부풀지 않게), 가로축은 minutes 분 전부터 지금까지.
       기준(warn)이 있으면 점선으로 긋고 오른쪽 끝에 그 값을 적는다. 올리면 그 때의 시각 · 값을 보여 준다 -->
  <div class="relative select-none" role="img" :aria-label="summary" @pointermove="onMove" @pointerleave="hover = null">
    <div class="relative h-20">
      <span class="absolute left-0 top-1 text-2xs leading-none text-on-surface-variant nums">{{ fmt(max) }}{{ unit }}</span>
      <!-- 경고 기준 숫자: 점선 오른쪽 끝 바로 위 -->
      <span v-if="warn !== undefined" class="absolute right-0 -translate-y-full pb-0.5 text-2xs leading-none text-(--warn-ink) nums" :style="{ top: `${(y(warn) / 40) * 100}%` }">{{ fmt(warn) }}{{ unit }}</span>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" class="absolute inset-0 w-full h-full overflow-visible">
        <!-- 위 끝(왼쪽 위 숫자가 가리키는 선) · 바닥(0) -->
        <line x1="0" x2="100" y1="2" y2="2" class="stroke-outline-variant" stroke-opacity="0.5" stroke-width="1" vector-effect="non-scaling-stroke" />
        <line x1="0" x2="100" y1="40" y2="40" class="stroke-outline-variant" stroke-width="1" vector-effect="non-scaling-stroke" />
        <line v-if="warn !== undefined" x1="0" x2="100" :y1="y(warn)" :y2="y(warn)" class="stroke-(--warn-ink)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" />
        <!-- 봇을 막 시작해 모은 값이 없으면 선을 긋지 않는다 -->
        <template v-for="(s, i) in n ? all : []" :key="i">
          <path v-if="i === 0" :d="area(s)" class="fill-current opacity-15" :class="tone" />
          <path :d="line(s)" fill="none" stroke="currentColor" :stroke-width="i === 0 ? 1.5 : 1" :stroke-opacity="i === 0 ? 1 : 0.55" vector-effect="non-scaling-stroke" stroke-linejoin="round" :class="tone" />
        </template>
        <line v-if="hover !== null" :x1="x(hover)" :x2="x(hover)" y1="0" y2="40" class="stroke-on-surface-variant" stroke-width="1" vector-effect="non-scaling-stroke" />
      </svg>
      <div v-if="hover !== null && n" class="absolute -top-7 z-10 px-2 py-1 rounded-xs bg-inverse-surface text-inverse-on-surface text-xs leading-4 nums whitespace-nowrap -translate-x-1/2" :style="{ left: `${Math.min(85, Math.max(15, x(hover)))}%` }">
        {{ timeAt(hover) }} · {{ fmt(values[hover]) }}{{ unit }}<template v-if="second"> / {{ fmt(second[hover]) }}{{ unit }}</template>
      </div>
    </div>
    <div class="flex justify-between mt-1 text-2xs text-on-surface-variant nums">
      <span>{{ T.minutesAgo(minutes) }}</span
      ><span>{{ T.now }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { formatClock, formatNumber } from "../utils/locale.ts";
import { text } from "../text/index.ts";
const T = text.status;

const props = defineProps<{
  /** 첫째 줄(굵게 · 면 채움) */
  values: number[];
  /** 둘째 줄(옅게). 예: 시스템 CPU 와 봇 CPU */
  second?: number[];
  max: number;
  warn?: number;
  unit: string;
  /** 그래프가 덮는 시간(분) */
  minutes: number;
  /** 지금 시각(가로축 끝) */
  now: Date;
  tone: string;
}>();

const hover = ref<number | null>(null);
const all = computed(() => (props.second ? [props.values, props.second] : [props.values]));
const n = computed(() => props.values.length);
/** 점의 가로 위치(0~100). 점이 하나뿐이면(봇을 시작한 뒤 첫 샘플) 오른쪽 끝 */
const x = (i: number, count = n.value) => (count > 1 ? (i / (count - 1)) * 100 : 100);
const y = (v: number) => 40 - (Math.min(props.max, Math.max(0, v)) / props.max) * 38;
// 점이 하나뿐이면 그 값으로 가로질러 긋는다(점 하나로는 선이 보이지 않는다)
const line = (s: number[]) => {
  const points = s.length === 1 ? [s[0], s[0]] : s;
  return `M${points.map((v, i) => `${x(i, points.length).toFixed(2)},${y(v).toFixed(2)}`).join(" L")}`;
};
const area = (s: number[]) => `${line(s)} L100,40 L0,40 Z`;
// 읽는 사람(화면 낭독기)에게는 그래프 대신 한 줄로
const summary = computed(() => (!n.value ? T.chartEmpty : T.chartSummary({ minutes: props.minutes, min: `${fmt(Math.min(...props.values))}${props.unit}`, max: `${fmt(Math.max(...props.values))}${props.unit}`, axisMax: `${fmt(props.max)}${props.unit}` })));
const fmt = (v: number) => (v >= 100 || Number.isInteger(v) ? formatNumber(Math.round(v)) : v.toFixed(v < 10 ? 2 : 1));

function onMove(e: PointerEvent) {
  if (!n.value) return;
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  hover.value = Math.round(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * (n.value - 1));
}
function timeAt(i: number) {
  const ms = props.now.getTime() - (1 - x(i) / 100) * props.minutes * 60_000;
  return formatClock(ms);
}
</script>
