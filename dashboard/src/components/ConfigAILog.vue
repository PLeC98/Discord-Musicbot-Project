<!--
  AI 보조 · 리퀘스트 로그: AI 보조가 모델에게 보낸 요청 하나가 한 줄(재시도는 따로). 상태는 composables/ai-log, 모양은 contract/ai-log.
  위에서부터 설명 · 필터(출처 · 결과, 접힘) · 찾기 · 건수와 저장 용량 · 목록(펼치면 소요 · 토큰 · 비용 · 원문). 기록 설정(운영 조절값 ailog 그룹)은 고급 설정(ConfigAIAdvanced).
  새 기록은 실시간으로 온다: 맨 위를 보고 있고 펼친 줄이 없으면 바로 붙고, 아니면 "새 기록 n건" 알약을 누르면 붙는다.
-->
<template>
  <BaseCard icon="history" :title="T.title">
    <template #actions>
      <span class="flex items-center gap-1 text-xs text-on-surface-variant" v-tooltip="connected ? '' : T.liveOff"><span class="size-2 rounded-full" :class="connected ? 'bg-(--ok-ink)' : 'bg-outline'"></span>{{ T.live }}</span>
      <button type="button" :class="[ICON_BTN, 'size-8']" :disabled="loading" :aria-label="T.refresh" v-tooltip="T.refresh" @click="reload()"><Icon name="refresh" :size="20" :class="loading && 'animate-spin'" /></button>
      <button type="button" :class="[ICON_BTN, 'size-8']" class="hover:text-error" :disabled="!total || clearing" :aria-label="T.clear" v-tooltip="T.clear" @click="asking = true"><Icon name="delete_sweep" :size="20" /></button>
    </template>
    <div class="@container/log flex flex-col gap-3">
      <p class="text-sm text-on-surface-variant">{{ T.desc }}</p>

      <!-- 필터: 접어 둔다. 켠 것이 있으면 몇 개인지 -->
      <div>
        <button type="button" class="tap inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface" :aria-expanded="filtersOpen" @click="filtersOpen = !filtersOpen">
          <Icon name="filter_list" :size="18" />{{ T.filters }}<Icon name="expand_more" :size="18" class="transition-transform duration-150" :class="filtersOpen && 'rotate-180'" /><span v-if="filterCount" class="text-xs text-primary">{{ T.filterActive(filterCount) }}</span>
        </button>
        <div v-if="filtersOpen" class="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
          <span class="text-xs text-on-surface-variant">{{ T.source }}</span>
          <div class="flex flex-wrap gap-2">
            <button v-for="one in AI_LOG_SOURCES" :key="one" type="button" :aria-pressed="query.sources.includes(one)" :class="[FILTER_CHIP, query.sources.includes(one) ? FILTER_CHIP_ON : FILTER_CHIP_OFF]" @click="toggleSource(one)">{{ T.sources[one] }}</button>
          </div>
          <span class="text-xs text-on-surface-variant">{{ T.result }}</span>
          <div class="flex flex-wrap items-center gap-2">
            <button v-for="one in RESULTS" :key="one" type="button" :aria-pressed="query.result === one" :class="[FILTER_CHIP, query.result === one ? FILTER_CHIP_ON : FILTER_CHIP_OFF]" @click="toggleResult(one)">{{ T[one] }}</button>
            <BaseButton v-if="filterCount" variant="ghost" size="sm" class="ml-auto" @click="clearFilters">{{ T.filterClear }}</BaseButton>
          </div>
        </div>
      </div>

      <SearchInput v-model="query.q" type="text" :placeholder="T.search" :aria-label="T.search" :input-class="[SEARCH_FIELD, 'w-full pl-10!']">
        <template #leading><Icon name="search" :size="20" class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" /></template>
      </SearchInput>

      <NoticeBox v-if="storage && !storage.enabled" variant="note" tone="notice" icon="info" class="mt-0!">{{ T.off }}</NoticeBox>
      <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>

      <p class="text-xs text-on-surface-variant nums">
        {{ T.count(entries.length, matched) }}<template v-if="storage"> · {{ T.storage(formatBytes(storage.bytes), formatBytes(storage.maxBytes)) }}</template>
      </p>

      <!-- 목록. 맨 위 마커가 보이면 새 기록을 바로 붙인다 -->
      <div class="relative flex flex-col rounded-(--r-inner) border border-outline-variant/40 overflow-hidden">
        <div ref="topMark" class="h-px -mb-px"></div>
        <button v-if="fresh.length" type="button" class="tap sticky top-2 z-10 self-center -mb-8 inline-flex items-center gap-1 h-8 px-3 rounded-full bg-primary text-on-primary text-xs font-medium shadow-md" @click="showFresh"><Icon name="arrow_upward" :size="16" />{{ T.newCount(fresh.length) }}</button>
        <p v-if="!entries.length && !loading" class="py-10 flex flex-col items-center gap-1 text-center text-sm text-on-surface-variant">
          <Icon name="history" :size="32" /><span class="text-on-surface">{{ total ? T.emptyFiltered : T.empty }}</span
          ><span v-if="!total" class="text-xs">{{ T.emptyDesc }}</span>
        </p>
        <div v-for="entry in entries" :key="entry.id" class="border-b border-outline-variant/30 last:border-b-0">
          <button type="button" class="tap state-layer w-full flex items-center gap-2 px-3 py-2 text-left" :aria-expanded="open.has(entry.id)" @click="toggle(entry.id)">
            <span class="shrink-0 min-w-11 h-6 px-1.5 inline-flex items-center justify-center rounded-xs text-xs font-semibold nums" :class="entry.ok ? 'border border-outline-variant text-on-surface' : 'bg-error-container text-on-error-container'">{{ statusText(entry) }}</span>
            <span class="shrink-0 text-xs text-on-surface-variant nums" v-tooltip="formatDateTime(entry.at)">{{ formatClock(entry.at, { seconds: true }) }}</span>
            <span class="min-w-0 flex-1 truncate text-sm text-on-surface" v-tooltip="entry.url">{{ titleOf(entry) }}</span>
            <span v-if="entry.tokens" class="shrink-0 hidden @xl/log:inline text-xs text-on-surface-variant nums">{{ T.tokenPair(formatTokens(entry.tokens.input), formatTokens(entry.tokens.output)) }}</span>
            <span class="shrink-0 text-xs text-on-surface-variant nums">{{ formatMs(entry.tookMs) }}</span>
            <span v-if="entry.attempt > 1" class="shrink-0 h-6 px-2 inline-flex items-center rounded-xs bg-tertiary-container text-on-tertiary-container text-xs">{{ T.retry(entry.attempt) }}</span>
            <span class="shrink-0 hidden @md/log:inline-flex h-6 px-2 items-center rounded-xs border border-outline-variant text-xs text-on-surface-variant">{{ T.sources[entry.source] }}</span>
            <Icon name="expand_more" :size="18" class="shrink-0 text-on-surface-variant transition-transform duration-150" :class="open.has(entry.id) && 'rotate-180'" />
          </button>

          <!-- 펼친 줄: 요약 한 줄과 원문 영역(원문은 펼칠 때 불러온다) -->
          <div v-if="open.has(entry.id)" class="flex flex-col gap-3 px-3 pt-1 pb-3 bg-surface-container-low/60">
            <p class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-surface-variant">
              <span v-for="one in factsOf(entry)" :key="one.label"
                ><span class="opacity-70">{{ one.label }}:</span> <span class="text-on-surface nums" v-tooltip="one.tip ?? ''">{{ one.value }}</span></span
              >
              <span v-if="entry.truncated" class="h-5 px-1.5 inline-flex items-center rounded-xs bg-secondary-container text-on-secondary-container">{{ T.truncated }}</span>
            </p>
            <p v-if="details[entry.id] === 'loading'" class="text-xs text-on-surface-variant">{{ T.loading }}</p>
            <p v-else-if="details[entry.id] === 'error'" class="text-xs text-error">{{ T.detailFailed }}</p>
            <div v-for="box in boxesOf(entry)" :key="box.title" class="flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold" :class="box.error ? 'text-error' : 'text-on-surface'">{{ box.title }}</span>
                <button type="button" :class="[ICON_BTN, 'size-7']" :aria-label="T.copy" v-tooltip="T.copy" @click="copy(box.text)"><Icon name="content_copy" :size="16" /></button>
              </div>
              <pre :class="[CODE_BOX, box.error && 'text-error']">{{ box.text }}</pre>
            </div>
          </div>
        </div>
      </div>
      <BaseButton v-if="more" variant="ghost" class="self-center" :disabled="loading" @click="loadMore()">{{ loading ? T.loading : T.loadMore }}</BaseButton>
    </div>
  </BaseCard>

  <ConfirmDialog v-model="asking" icon="delete_sweep" :title="T.clearTitle" :body="T.clearBody" :confirm-label="T.clearConfirm" :busy="clearing" @confirm="confirmClear" />
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useIntersectionObserver } from "@vueuse/core";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import SearchInput from "./SearchInput.vue";
import { ICON_BTN } from "../utils/icon-button.ts";
import { CODE_BOX, SEARCH_FIELD } from "../utils/field.ts";
import { FILTER_CHIP, FILTER_CHIP_OFF, FILTER_CHIP_ON } from "../utils/filter-chip.ts";
import { formatClock, formatDateTime } from "../utils/locale.ts";
import { formatMs, formatTokens, formatUsd, prettyJson, shortUrl } from "../utils/ai-usage-format.ts";
import { notifyDone } from "../composables/toasts.ts";
import { useAiLog } from "../composables/ai-log.ts";
import { formatBytes } from "../../../src/ui/format.ts";
import { AI_LOG_SOURCES, type AiLogEntry } from "../../../src/dashboard/contract/ai-log.ts";
import { text } from "../text/index.ts";
const T = text.ai.log;

/** active: 이 화면이 보이는가(보일 때만 읽고 실시간 연결을 연다) */
const props = defineProps<{ active: boolean }>();

const RESULTS = ["ok", "failed"] as const;
const filtersOpen = ref(false);
const asking = ref(false);
const topMark = ref<HTMLElement | null>(null);

const { entries, total, matched, storage, loading, loadError, query, more, filterCount, toggleSource, toggleResult, clearFilters, open, details, toggle, fresh, atTop, connected, showFresh, clearing, reload, loadMore, clearAll } = useAiLog(() => props.active);

useIntersectionObserver(topMark, ([one]) => (atTop.value = one?.isIntersecting ?? true));

const statusText = (entry: AiLogEntry) => entry.status ?? (entry.aborted ? T.timeout : T.unreached);
/** 모델 이름(프로필 이름 → ID), 모델이 없는 요청(모델 목록)은 짧은 주소 */
const titleOf = (entry: AiLogEntry) => entry.name || entry.model || shortUrl(entry.url);

/** 펼친 줄의 요약: 있는 것만 */
function factsOf(entry: AiLogEntry) {
  const out: Array<{ label: string; value: string; tip?: string }> = [{ label: T.took, value: formatMs(entry.tookMs) }];
  if (entry.firstMs != null) out.push({ label: T.first, value: formatMs(entry.firstMs) });
  if (entry.tokens) out.push({ label: T.tokens, value: T.tokenPair(formatTokens(entry.tokens.input), formatTokens(entry.tokens.output)), tip: T.tokenTip(formatTokens(entry.tokens.cached), formatTokens(entry.tokens.reasoning)) });
  out.push({ label: T.cost, value: entry.costUsd == null ? T.costUnknown : formatUsd(entry.costUsd) });
  out.push({ label: T.provider, value: entry.model ? `${entry.provider} · ${entry.model}` : entry.provider });
  if (entry.guildName) out.push({ label: T.guild, value: entry.guildName });
  if (entry.genre) out.push({ label: T.genre, value: entry.candidates ? `${entry.genre} · ${T.candidates(entry.candidates)}` : entry.genre });
  if (entry.attempt > 1) out.push({ label: T.attempt, value: T.attemptNth(entry.attempt) });
  return out;
}

/** 원문 영역: URL · 오류는 목록에 있고, 헤더 · 본문 · 응답은 불러온 뒤에 */
function boxesOf(entry: AiLogEntry) {
  const out: Array<{ title: string; text: string; error?: boolean }> = [{ title: T.url, text: entry.url }];
  if (entry.error) out.push({ title: T.error, text: entry.error, error: true });
  const one = details.value[entry.id];
  if (!one || typeof one === "string") return out;
  return [...out, { title: T.headers, text: prettyJson(one.requestHeaders) }, { title: T.body, text: prettyJson(one.requestBody) }, { title: T.response, text: prettyJson(one.response) }];
}

// 안전하지 않은 출처처럼 못 쓰는 환경이면 복사만 안 될 뿐이다
function copy(value: string) {
  navigator.clipboard
    ?.writeText(value)
    .then(() => notifyDone(T.copied))
    .catch(() => {
      /* 복사만 안 된다 */
    });
}

async function confirmClear() {
  await clearAll();
  asking.value = false;
}
</script>
