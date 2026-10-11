<!--
  AI 보조 · 사용량 통계: 기간(7 · 30 · 90일 · 전체) · 출처 거르기, 합계 칸 다섯(요청 · 입력 · 출력 · 비용 · 응답 시간), 날짜별 막대(UsageChart), 모델별 · 출처별 · 서버별 표.
  통계는 리퀘스트 로그와 따로 남는다(로그를 지워도 줄지 않는다). 비용은 기록할 때의 값표로 센 추정이고 값표에 없는 모델은 "가격 모름"으로 따로 센다.
  상태는 composables/ai-usage, 모양은 contract/ai-log.
-->
<template>
  <BaseCard icon="bar_chart" :title="T.title">
    <template #actions>
      <button type="button" :class="[ICON_BTN, 'size-8']" :disabled="loading" :aria-label="T.refresh" v-tooltip="T.refresh" @click="load()"><Icon name="refresh" :size="20" :class="loading && 'animate-spin'" /></button>
      <button type="button" :class="[ICON_BTN, 'size-8']" class="hover:text-error" :disabled="!report?.total.requests || clearing" :aria-label="T.clear" v-tooltip="T.clear" @click="asking = true"><Icon name="delete_sweep" :size="20" /></button>
    </template>
    <div class="@container/usage flex flex-col gap-4">
      <p class="text-sm text-on-surface-variant">{{ T.desc }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <button v-for="one in AI_USAGE_PERIODS" :key="one" type="button" :aria-pressed="period === one" :class="[FILTER_CHIP, period === one ? FILTER_CHIP_ON : FILTER_CHIP_OFF]" @click="period = one">{{ T.periods[one] }}</button>
        <span class="mx-1 h-5 w-px bg-outline-variant" aria-hidden="true"></span>
        <button v-for="one in AI_LOG_SOURCES" :key="one" type="button" :aria-pressed="sources.includes(one)" :class="[FILTER_CHIP, sources.includes(one) ? FILTER_CHIP_ON : FILTER_CHIP_OFF]" @click="toggleSource(one)">{{ T.sources[one] }}</button>
      </div>
      <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>

      <template v-if="report">
        <!-- 합계: 큰 수 하나와 그 밑 한 줄 -->
        <div class="grid grid-cols-2 @2xl/usage:grid-cols-5 gap-2">
          <!-- 2열이면 다섯째(응답 시간)는 한 줄을 다 쓴다 -->
          <div v-for="tile in tiles" :key="tile.label" class="rounded-(--r-inner) bg-surface-container-highest px-4 py-3 min-w-0 last:col-span-2 @2xl/usage:last:col-span-1">
            <p class="text-xs text-on-surface-variant">{{ tile.label }}</p>
            <p class="mt-1 text-2xl @2xl/usage:text-xl @4xl/usage:text-2xl font-round font-semibold text-on-surface nums truncate">{{ tile.value }}</p>
            <p class="mt-0.5 text-xs nums truncate" :class="tile.alert ? 'text-error' : 'text-on-surface-variant'">{{ tile.sub }}</p>
          </div>
        </div>

        <section class="flex flex-col gap-3 rounded-(--r-inner) border border-outline-variant/40 p-4">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="flex-1 text-sm font-semibold text-on-surface">{{ T.chart.title }}</h3>
            <button v-for="(label, one) in T.chart.metrics" :key="one" type="button" :aria-pressed="metric === one" :class="[FILTER_CHIP, metric === one ? FILTER_CHIP_ON : FILTER_CHIP_OFF]" @click="metric = one">{{ label }}</button>
          </div>
          <p v-if="!report.total.requests" class="py-10 text-center text-sm text-on-surface-variant">{{ T.empty }}</p>
          <UsageChart v-else :daily="report.daily" :metric="metric" />
        </section>

        <!-- 표 셋. 좁으면 표 안에서 옆으로 구른다 -->
        <section v-for="table in tables" :key="table.title" class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-on-surface">{{ table.title }}</h3>
          <p v-if="!table.rows.length" class="text-xs text-on-surface-variant">{{ table.empty }}</p>
          <div v-else class="overflow-x-auto rounded-(--r-inner) border border-outline-variant/40">
            <table class="w-full min-w-xl text-xs nums">
              <thead class="text-on-surface-variant">
                <tr class="border-b border-outline-variant/40">
                  <th class="px-3 py-2 text-left font-medium">{{ table.head }}</th>
                  <th v-for="col in COLUMNS" :key="col.key" class="px-3 py-2 text-right font-medium">{{ TT[col.key] }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in table.rows" :key="row.key" class="border-b border-outline-variant/20 last:border-b-0">
                  <td class="px-3 py-2 text-left max-w-64">
                    <span class="block truncate text-on-surface" v-tooltip="row.sub">{{ row.title }}</span>
                    <span v-if="row.sub" class="block truncate text-2xs text-on-surface-variant font-mono">{{ row.sub }}</span>
                  </td>
                  <td v-for="col in COLUMNS" :key="col.key" class="px-3 py-2 text-right text-on-surface whitespace-nowrap">{{ col.show(row.bucket) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </div>
  </BaseCard>

  <ConfirmDialog v-model="asking" icon="delete_sweep" :title="T.clearTitle" :body="T.clearBody" :confirm-label="T.clearConfirm" :busy="clearing" @confirm="confirmClear" />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import BaseCard from "./BaseCard.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import UsageChart from "./UsageChart.vue";
import { ICON_BTN } from "../utils/icon-button.ts";
import { FILTER_CHIP, FILTER_CHIP_OFF, FILTER_CHIP_ON } from "../utils/filter-chip.ts";
import { formatMs, formatTokens, formatUsd } from "../utils/ai-usage-format.ts";
import { useAiUsage } from "../composables/ai-usage.ts";
import { AI_LOG_SOURCES, AI_USAGE_PERIODS, type AiUsageBucket } from "../../../src/dashboard/contract/ai-log.ts";
import { text } from "../text/index.ts";
const T = text.ai.usage;
const TC = T.cards;
const TT = T.tables;

/** active: 이 화면이 보이는가(보일 때 읽는다) */
const props = defineProps<{ active: boolean }>();

const asking = ref(false);
const metric = ref<"tokens" | "requests" | "cost">("tokens");
const { period, sources, report, loading, loadError, clearing, load, toggleSource, clearAll } = useAiUsage(() => props.active);

/** 비용 칸: 값을 아는 것의 합. 가격 모름이 섞였으면 "+" 를 붙이고, 전부 가격 모름이면 그렇게 적는다 */
const costText = (one: AiUsageBucket) => (one.unpriced && one.unpriced === one.requests ? TT.unknown : `${formatUsd(one.costUsd)}${one.unpriced ? "+" : ""}`);

const tiles = computed(() => {
  const all = report.value?.total;
  if (!all) return [];
  return [
    { label: TC.requests, value: formatTokens(all.requests), sub: TC.failed(formatTokens(all.failed)), alert: all.failed > 0 },
    { label: TC.input, value: formatTokens(all.input), sub: TC.cached(formatTokens(all.cached)) },
    { label: TC.output, value: formatTokens(all.output), sub: TC.reasoning(formatTokens(all.reasoning)) },
    { label: TC.cost, value: formatUsd(all.costUsd), sub: all.unpriced ? TC.unpriced(formatTokens(all.unpriced)) : "" },
    { label: TC.latency, value: formatMs(all.avgMs), sub: all.p95Ms == null ? "" : TC.p95(formatMs(all.p95Ms)) },
  ];
});

const COLUMNS: Array<{ key: "requests" | "input" | "output" | "cached" | "cost" | "avg"; show: (one: AiUsageBucket) => string }> = [
  { key: "requests", show: (one) => (one.failed ? `${formatTokens(one.requests)} (${formatTokens(one.failed)})` : formatTokens(one.requests)) },
  { key: "input", show: (one) => formatTokens(one.input) },
  { key: "output", show: (one) => formatTokens(one.output) },
  { key: "cached", show: (one) => formatTokens(one.cached) },
  { key: "cost", show: costText },
  { key: "avg", show: (one) => formatMs(one.avgMs) },
];

const tables = computed(() => {
  const got = report.value;
  if (!got) return [];
  return [
    { title: TT.byModel, head: TT.model, empty: T.empty, rows: got.byModel.map((one) => ({ key: `${one.provider}/${one.model}`, title: one.name || one.model, sub: `${one.provider} · ${one.model}`, bucket: one })) },
    { title: TT.bySource, head: TT.source, empty: T.empty, rows: got.bySource.map((one) => ({ key: one.source, title: T.sources[one.source], sub: "", bucket: one })) },
    { title: TT.byGuild, head: TT.guild, empty: TT.noGuild, rows: got.byGuild.map((one) => ({ key: one.guildId, title: one.guildName, sub: "", bucket: one })) },
  ];
});

async function confirmClear() {
  await clearAll();
  asking.value = false;
}
</script>
