<!--
  AI 사용량의 날짜별 막대(사용량 통계 화면). 빈 날도 0 으로 자리를 지켜 간격이 날짜와 맞는다. 기간이 길면(92일 넘게) 이레씩 묶는다.
  지표: 토큰(입력 · 캐시 · 출력을 쌓는다. 입력은 캐시를 뺀 몫) · 요청(성공 · 실패를 쌓는다) · 비용. 막대 칸 전체가 마우스를 받고 그날 값을 툴팁으로 보인다.
  계열 색은 테마와 무관한 고정 색(style.css 의 --usage-*)이고 범례 · 툴팁이 이름을 함께 적어 색만으로 가르지 않는다.
-->
<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-on-surface-variant">
      <span v-for="one in legend" :key="one.key" class="inline-flex items-center gap-1.5"><span class="size-2.5 rounded-full" :class="one.cls"></span>{{ one.label }}</span>
      <span class="ml-auto nums">{{ T.peak(formatValue(peak)) }}</span>
    </div>
    <div class="flex items-end gap-0.5 h-40 border-b border-outline-variant/60">
      <div v-for="bar in bars" :key="bar.key" class="group flex-1 min-w-0 h-full flex flex-col justify-end" v-tooltip="bar.tip">
        <div class="flex flex-col-reverse gap-0.5 rounded-t-sm overflow-hidden transition-opacity group-hover:opacity-80" :style="{ height: `${(bar.total / (peak || 1)) * 100}%` }">
          <div v-for="seg in bar.shown" :key="seg.key" :class="seg.cls" :style="{ flexGrow: seg.value, flexBasis: 0 }"></div>
        </div>
      </div>
    </div>
    <div class="flex gap-0.5 text-2xs text-on-surface-variant nums">
      <span v-for="(bar, i) in bars" :key="bar.key" class="flex-1 min-w-0 text-center whitespace-nowrap overflow-visible" :class="i % labelEvery ? 'invisible' : ''">{{ bar.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { formatTokens, formatUsd, dayLabel } from "../utils/ai-usage-format.ts";
import type { AiUsageBucket } from "../../../src/dashboard/contract/ai-log.ts";
import { text } from "../text/index.ts";
const T = text.ai.usage.chart;

type Metric = "tokens" | "requests" | "cost";
type Day = AiUsageBucket & { day: string };
const props = defineProps<{ daily: Day[]; metric: Metric }>();

/** 이보다 많은 날이면 이레씩 묶는다 */
const MAX_DAYS = 92;
/** 아래 날짜 글은 열 개 남짓만 */
const LABELS = 10;

const SERIES: Record<Metric, Array<{ key: string; cls: string; pick: (one: Day) => number }>> = {
  tokens: [
    { key: "input", cls: "bg-(--usage-input)", pick: (one) => one.input - one.cached },
    { key: "cached", cls: "bg-(--usage-cached)", pick: (one) => one.cached },
    { key: "output", cls: "bg-(--usage-output)", pick: (one) => one.output },
  ],
  requests: [
    { key: "ok", cls: "bg-(--usage-input)", pick: (one) => one.requests - one.failed },
    { key: "failed", cls: "bg-(--usage-failed)", pick: (one) => one.failed },
  ],
  cost: [{ key: "cost", cls: "bg-(--usage-input)", pick: (one) => one.costUsd }],
};

const formatValue = (value: number) => (props.metric === "cost" ? formatUsd(value) : formatTokens(value));
const seriesLabel = (key: string) => T.series[key as keyof typeof T.series];
const legend = computed(() => SERIES[props.metric].map((one) => ({ key: one.key, cls: one.cls, label: seriesLabel(one.key) })));

/** 여러 날을 하나로 더한다(막대에 쓰는 칸만) */
function sum(days: Day[]): Day {
  const add = (pick: (one: Day) => number) => days.reduce((n, one) => n + pick(one), 0);
  return { ...days[0], requests: add((one) => one.requests), failed: add((one) => one.failed), input: add((one) => one.input), cached: add((one) => one.cached), output: add((one) => one.output), reasoning: add((one) => one.reasoning), costUsd: add((one) => one.costUsd), unpriced: add((one) => one.unpriced) };
}
const groups = computed(() => {
  if (props.daily.length <= MAX_DAYS) return props.daily.map((one) => ({ days: [one], bucket: one }));
  const out: Array<{ days: Day[]; bucket: Day }> = [];
  for (let i = 0; i < props.daily.length; i += 7) {
    const days = props.daily.slice(i, i + 7);
    out.push({ days, bucket: sum(days) });
  }
  return out;
});

const bars = computed(() =>
  groups.value.map(({ days, bucket }) => {
    const segments = SERIES[props.metric].map((one) => ({ key: one.key, cls: one.cls, value: Math.max(0, one.pick(bucket)) }));
    const label = dayLabel(days[0].day);
    const when = days.length > 1 ? T.range(label, dayLabel(days[days.length - 1].day)) : label;
    const tip = [when, ...segments.map((one) => `${seriesLabel(one.key)} ${formatValue(one.value)}`)].join("\n");
    // 0 인 칸은 그리지 않는다(칸 사이 틈만 남는다)
    return { key: days[0].day, label, shown: segments.filter((one) => one.value > 0), total: segments.reduce((n, one) => n + one.value, 0), tip };
  }),
);
const peak = computed(() => Math.max(0, ...bars.value.map((one) => one.total)));
const labelEvery = computed(() => Math.max(1, Math.ceil(bars.value.length / LABELS)));
</script>
