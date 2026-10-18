<template>
  <!-- 캐시 DB(운영자 패널 "캐시 DB" 탭). DB Browser for SQLite 의 데이터 보기를 본뜬 격자. 계약 contract/track-cache.
       위 줄(테이블 | 새로고침 · 필터 지우기 · 정렬 해제 | 새 행 · 행 삭제 | 재생 테스트 | 단축키 | 모든 열에서 필터) · 격자(행 번호 · 헤더 정렬 · 열마다 필터 · 이어 불러오기) ·
       오른쪽 셀 편집 창 · 아래 줄(페이지 이동 · 범위 · 상태 안내 · 행으로 이동). 변경은 모아 두었다가 운영자 패널의 저장 막대로 쓴다(재생 테스트만 바로) -->
  <section class="pane rounded-(--r-window) p-(--pad-window) flex flex-col gap-2 min-w-0" @click="closePopups()" @keydown.capture="onCardKey">
    <!-- 위 줄 -->
    <div class="relative flex flex-wrap items-center gap-1">
      <span class="text-xs text-on-surface-variant mr-1">{{ T.tableLabel }}</span>
      <SingleSelect :model-value="table" :options="tableOptions" small class="w-32" @update:model-value="switchTable($event as TrackCacheTable)" />
      <span class="mx-1 h-5 w-px bg-outline-variant"></span>
      <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="T.tools.refresh" v-tooltip="T.tools.refresh" @click="reload()"><Icon name="refresh" :size="18" :class="loading && 'animate-spin'" /></button>
      <button type="button" :class="[ICON_BTN, 'size-8']" :disabled="!hasFilters" :aria-label="T.tools.clearFilters" v-tooltip="T.tools.clearFilters" @click="clearFilters()"><Icon name="filter_list_off" :size="18" /></button>
      <button type="button" :class="[ICON_BTN, 'size-8']" :disabled="!sort.length" :aria-label="T.tools.clearSort" v-tooltip="T.tools.clearSort" @click="setSort([])"><Icon name="mobiledata_off" :size="18" /></button>
      <span class="mx-1 h-5 w-px bg-outline-variant"></span>
      <button type="button" :class="[ICON_BTN, 'size-8']" :disabled="table !== 'requests'" :aria-label="T.tools.newRow" v-tooltip="table === 'requests' ? T.tools.newRow : T.tools.newRowOff" @click="addNewRow()"><Icon name="add" :size="18" /></button>
      <button type="button" :class="[ICON_BTN, 'size-8']" class="hover:text-error" :disabled="!selectedKeys().length" :aria-label="T.tools.deleteRows" v-tooltip="T.tools.deleteRows" @click="deleteSelected()"><Icon name="delete" :size="18" /></button>
      <span class="mx-1 h-5 w-px bg-outline-variant"></span>
      <BaseButton variant="ghost" size="sm" :disabled="table === 'age' || !selectedKeys().length" v-tooltip="T.tools.probeTip" @click="probe(selectedKeys())"><Icon name="fact_check" :size="16" />{{ checking.length ? T.tools.probing(checking.length) : T.tools.probe }}</BaseButton>
      <button v-if="botChanged" type="button" class="tap h-8 px-3 rounded-full bg-primary text-on-primary text-xs font-medium" @click="reload()">{{ T.botChanged }}</button>
      <label class="relative ml-auto">
        <Icon name="search" :size="16" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
        <input ref="searchBox" v-model="q" type="text" :placeholder="T.tools.search" :aria-label="T.tools.search" :class="[FIELD, 'h-8! pl-8! text-xs! w-56', q && 'pr-8!', problems.q && 'border-error!']" v-tooltip="problems.q ?? ''" @keydown.esc="q ? ((q = ''), $event.stopPropagation()) : undefined" />
        <!-- 지우기: 입력란 안 오른쪽 끝 -->
        <button v-if="q" type="button" class="tap state-layer absolute right-1 top-1/2 -translate-y-1/2 size-6 rounded-full flex items-center justify-center cursor-pointer text-on-surface-variant" :aria-label="T.tools.clearFilter" v-tooltip="T.tools.clearFilter" @click.prevent="clearSearch()">
          <Icon name="close" :size="16" />
        </button>
      </label>
      <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="T.tools.shortcuts" :aria-expanded="showKeys" v-tooltip="T.tools.shortcuts" @click.stop="showKeys = !showKeys"><Icon name="help" :size="18" /></button>
      <!-- 단축키 -->
      <div v-if="showKeys" class="absolute right-0 top-10 z-150 w-md max-w-full p-3 rounded-(--r-inner) pane-menu text-xs" @click.stop>
        <p class="mb-2 text-sm font-medium text-on-surface">{{ T.tools.shortcuts }}</p>
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <template v-for="[keys, what] in T.shortcuts" :key="keys">
            <dt class="text-on-surface whitespace-nowrap">{{ keys }}</dt>
            <dd class="text-on-surface-variant">{{ what }}</dd>
          </template>
        </dl>
      </div>
    </div>

    <div class="flex flex-col lg:flex-row gap-2 min-w-0">
      <!-- 격자 -->
      <div ref="scroller" tabindex="0" class="relative min-w-0 lg:flex-1 overflow-auto h-128 rounded-(--r-inner) border border-outline-variant/40 outline-none focus-visible:border-primary" @scroll="onScroll" @keydown="onKey">
        <table class="text-xs nums border-separate border-spacing-0 table-fixed select-none" :style="{ width: `${tableWidth}px` }">
          <colgroup>
            <col :style="{ width: `${HEAD_W}px` }" />
            <col v-for="c in shown" :key="c" :style="{ width: `${widthOf(c)}px` }" />
          </colgroup>
          <thead class="sticky top-0 z-20 bg-surface-container">
            <tr>
              <th class="sticky left-0 z-30 bg-surface-container border-b border-r border-outline-variant/40 h-7"></th>
              <th v-for="(c, i) in shown" :key="c" class="relative px-2 h-7 text-left font-medium whitespace-nowrap border-b border-r border-outline-variant/40 cursor-pointer" :class="[frozenClass(i), editable(table, c) ? 'text-primary' : 'text-on-surface-variant']" :style="frozenStyle(i)" v-tooltip="T.columnTips[c] ?? ''" @click="toggleSort(c, $event)" @contextmenu.prevent.stop="openHeaderMenu($event, c, i)">
                <span class="inline-flex items-center gap-0.5 truncate"
                  ><Icon v-if="editable(table, c)" name="keep" :size="14" />{{ T.columns[c] }}<Icon v-if="sortOf(c)" :name="sortOf(c) === 'desc' ? 'arrow_downward' : 'arrow_upward'" :size="14" class="text-primary" /><span v-if="sortRank(c)" class="text-xs text-primary">{{ sortRank(c) }}</span></span
                >
                <span class="absolute right-0 top-0 h-full w-1.5 cursor-col-resize" @mousedown.stop.prevent="startResize($event, c)" @click.stop></span>
              </th>
            </tr>
            <tr>
              <th class="sticky left-0 z-30 bg-surface-container border-b border-r border-outline-variant/40"></th>
              <th v-for="(c, i) in shown" :key="c" class="relative p-0.5 border-b border-r border-outline-variant/40" :class="frozenClass(i)" :style="frozenStyle(i)">
                <input
                  :value="filters[table][c] ?? ''"
                  type="text"
                  :placeholder="T.filterPlaceholder"
                  :aria-label="`${T.columns[c]} ${T.filterPlaceholder}`"
                  class="w-full h-6 px-1.5 rounded-xs bg-surface-container-highest text-xs font-normal outline-none placeholder:text-on-surface-variant/60 focus:outline-1 focus:outline-primary"
                  :class="[filters[table][c] && 'pr-6', problems[c] && 'outline-1 outline-error']"
                  v-tooltip="problems[c] ?? ''"
                  @input="setFilter(c, ($event.target as HTMLInputElement).value)"
                  @contextmenu.prevent.stop="openFilterMenu($event, c)"
                  @keydown.stop="$event.key === 'Escape' && filters[table][c] && setFilter(c, '')"
                />
                <button v-if="filters[table][c]" type="button" class="tap state-layer absolute right-1 top-1/2 -translate-y-1/2 size-5 rounded-full flex items-center justify-center cursor-pointer text-on-surface-variant" :aria-label="T.tools.clearFilter" v-tooltip="T.tools.clearFilter" @click="clearFilter(c, $event)">
                  <Icon name="close" :size="14" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <!-- 새 행: 필터와 상관없이 맨 위 -->
            <tr v-for="(row, n) in changes.newRows" :key="`new${row.id}`" class="h-7">
              <th class="sticky left-0 z-10 px-1 text-right font-normal border-b border-r border-outline-variant/30 bg-secondary-container text-on-secondary-container">*</th>
              <td v-for="(c, i) in shown" :key="c" class="p-0 border-b border-r border-outline-variant/30 bg-secondary-container" :class="frozenClass(i, true, 'bg-')" :style="frozenStyle(i)">
                <input v-if="c === 'requestKey' || c === 'audioUrl'" v-model="row[c]" type="text" :data-new="`${row.id}:${c}`" class="w-full h-7 px-2 bg-transparent text-xs outline-none select-text focus:outline-1 focus:outline-primary" :class="newProblem(row.id, c) && 'text-error'" v-tooltip="newProblem(row.id, c)" :placeholder="T.columns[c]" @input="inspectNew(row, c)" @keydown.stop="onNewKey($event, n)" />
              </td>
            </tr>
            <tr v-if="topPad">
              <td :colspan="shown.length + 1" :style="{ height: `${topPad}px` }"></td>
            </tr>
            <tr v-for="r in visibleIndexes" :key="r" class="h-7" :class="isDeleted(r) && 'line-through'">
              <th class="sticky left-0 z-10 px-1 text-right font-normal border-b border-r border-outline-variant/30 cursor-pointer" :class="rowHeadClass(r)" @mousedown.prevent="pickRow(r, $event)" @mouseenter="dragRow(r, $event)">{{ r + 1 }}</th>
              <template v-if="rowAt(r)">
                <td v-for="(c, i) in shown" :key="c" class="px-2 h-7 truncate whitespace-nowrap border-b border-r border-outline-variant/30" :class="[cellClass(r, c), frozenClass(i, true, cellClass(r, c)), editable(table, c) ? 'cursor-text' : 'cursor-default']" :style="frozenStyle(i)" v-tooltip="tipOf(r, c)" @mousedown="pickCell(r, i, $event)" @mouseenter="dragTo(r, i, $event)" @dblclick="startEdit(r, c)" @contextmenu.prevent.stop="openCellMenu($event, r, i)">
                  <input v-if="editing && editing.r === r && editing.c === c" ref="inlineInput" v-model="editing.value" type="text" class="w-full h-6 -mx-1 px-1 bg-surface-container-highest outline-1 outline-primary select-text" @keydown.stop="onInlineKey" @blur="commitInline()" />
                  <template v-else><Icon v-if="c === 'audioUrl' && isPinned(r)" name="keep" :size="13" class="mr-0.5 text-primary align-[-2px]" />{{ shownText(r, c) }}</template>
                </td>
              </template>
              <td v-else :colspan="shown.length" class="px-2 border-b border-outline-variant/30 text-on-surface-variant/50">…</td>
            </tr>
            <tr v-if="bottomPad">
              <td :colspan="shown.length + 1" :style="{ height: `${bottomPad}px` }"></td>
            </tr>
          </tbody>
        </table>
        <p v-if="!loading && matched === 0 && !changes.newRows.length" class="py-10 text-center text-sm text-on-surface-variant">{{ T.values.noRows }}</p>
      </div>

      <!-- 셀 편집 창(DB4S 의 Edit Database Cell) -->
      <aside class="lg:w-80 shrink-0 flex flex-col gap-2 rounded-(--r-inner) border border-outline-variant/40 p-3">
        <template v-if="focusInfo">
          <p class="text-xs font-medium text-on-surface">{{ T.editPane.title(T.columns[focusInfo.column], focusInfo.label) }}</p>
          <textarea v-model="pane.value" rows="5" :readonly="!focusInfo.editable" :class="AREA" class="text-xs! break-all" @keydown.ctrl.enter.prevent="applyPane(true)" @keydown.esc.prevent="cancelPane()" @input="pane.dirty = true"></textarea>
          <p v-if="focusInfo.editable && pane.info" class="text-xs" :class="pane.info.ok ? 'text-on-surface-variant' : 'text-error'">{{ pane.info.text }}</p>
          <template v-if="focusInfo.editable">
            <p class="text-xs text-on-surface-variant">{{ T.editPane.pinNote }}</p>
            <p v-if="paneNote" class="text-xs text-on-surface-variant break-all">{{ paneNote }}</p>
          </template>
          <p v-else class="text-xs text-on-surface-variant">{{ T.editPane.readonly }}</p>
          <div class="flex flex-wrap justify-end gap-2">
            <BaseButton v-if="isLink(pane.value)" variant="ghost" size="sm" :href="pane.value"><Icon name="open_in_new" :size="16" />{{ T.editPane.open }}</BaseButton>
            <BaseButton v-if="focusInfo.editable" variant="ghost" size="sm" @click="clearCells([focus!])">{{ T.editPane.clear }}</BaseButton>
            <BaseButton v-if="focusInfo.editable" variant="secondary" size="sm" :disabled="!pane.dirty" v-tooltip="T.editPane.applyTip" @click="applyPane(true)">{{ T.editPane.apply }}</BaseButton>
          </div>
        </template>
        <p v-else class="text-xs text-on-surface-variant">{{ T.editPane.empty }}</p>
      </aside>
    </div>

    <!-- 아래 줄 -->
    <div class="flex flex-wrap items-center gap-1 text-xs text-on-surface-variant nums">
      <button v-for="b in PAGER" :key="b.label" type="button" :class="[ICON_BTN, 'size-7']" :aria-label="b.label" v-tooltip="b.label" @click="b.go()"><Icon :name="b.icon" :size="16" /></button>
      <span class="px-1">{{ rangeText }}</span>
      <span v-if="total !== matched" class="text-on-surface-variant/70">({{ total }})</span>
      <span class="ml-3 text-on-surface" role="status">{{ hint }}</span>
      <span class="ml-auto">{{ T.pager.goTo }}</span>
      <input v-model.number="goTo" type="number" min="1" :aria-label="T.pager.goTo" class="w-16 h-7 px-1.5 rounded-xs bg-surface-container-highest text-xs outline-none" @keydown.enter="jumpTo(goTo - 1)" />
    </div>

    <NoticeBox v-if="changeCount(changes)" variant="note" tone="notice" icon="info" class="mt-0!">{{ T.changes.summary(changeCount(changes), summaryOf(changes)) }}</NoticeBox>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-on-surface-variant">
      <span class="inline-flex items-center gap-1.5"><span class="size-3 rounded-xs bg-tertiary-container"></span>{{ T.legend.changed }}</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-3 rounded-xs bg-secondary-container"></span>{{ T.legend.newRow }}</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-3 rounded-xs bg-error-container"></span>{{ T.legend.deleted }}</span>
      <span class="inline-flex items-center gap-1.5"><span class="size-3 rounded-xs outline-2 -outline-offset-2 outline-error"></span>{{ T.legend.failed }}</span>
      <span v-if="table === 'requests'" class="inline-flex items-center gap-1"><Icon name="keep" :size="14" class="text-primary" />{{ T.legend.pinned }}</span>
    </div>

    <!-- 오른쪽 클릭 메뉴 -->
    <div v-if="menu" class="fixed z-150 min-w-56 py-1 rounded-(--r-inner) pane-menu text-sm text-on-surface" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @click.stop @mousedown.prevent>
      <template v-for="(item, k) in menu.items" :key="k">
        <div v-if="item === '-'" class="my-1 h-px bg-outline-variant/50"></div>
        <p v-else-if="!item.run" class="max-w-72 px-3 py-1.5 text-xs text-on-surface-variant">{{ item.label }}</p>
        <button v-else type="button" class="tap state-layer w-full flex items-center justify-between gap-6 px-3 h-8 text-left disabled:opacity-38" :class="item.danger && 'text-error'" :disabled="item.off" @click="runMenu(item)">
          <span>{{ item.label }}</span
          ><span class="text-xs text-on-surface-variant">{{ item.hint ?? "" }}</span>
        </button>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import axios from "axios";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import SingleSelect from "./SingleSelect.vue";
import { useSaveTarget } from "../composables/save-targets.ts";
import { notify, notifyDone, notifyProblem } from "../composables/toasts.ts";
import { noticeText } from "../utils/problem.ts";
import { replyOf } from "../utils/request.ts";
import { readStored, writeStored } from "../utils/storage.ts";
import { AREA, FIELD } from "../utils/field.ts";
import { ICON_BTN } from "../utils/icon-button.ts";
import type { IconName } from "../icons.ts";
import type { Code } from "../../../src/rules/problems.ts";
import { parseFilter, parseWords } from "../../../src/rules/track-cache-filter.ts";
import {
  TRACK_CACHE_COLUMNS,
  TRACK_CACHE_COLUMN_KINDS,
  TRACK_CACHE_DEFAULT_SORT,
  TRACK_CACHE_FILE_DELETES_MAX,
  TRACK_CACHE_OPS_MAX,
  TRACK_CACHE_PAGE_MAX,
  TRACK_CACHE_TABLES,
  trackCacheSearch,
  type TrackCacheChecks,
  type TrackCacheInspected,
  type TrackCacheOp,
  type TrackCacheOpResult,
  type TrackCachePage,
  type TrackCacheProbeQueued,
  type TrackCacheQuery,
  type TrackCacheRevision,
  type TrackCacheSort,
  type TrackCacheTable,
  type TrackCacheWritten,
  type TrackFileRow,
  type TrackRequestRow,
  type TrackAgeRow,
} from "../../../src/dashboard/contract/track-cache.ts";
import { cellText, changeCount, editable, emptyChanges, keyOf, opsOf, rawText, stamp, summaryOf, type AnyRow, type Changes, type NewRow } from "../cache-db/model.ts";
import { text } from "../text/index.ts";
const T = text.cacheDb;
const tableOptions = TRACK_CACHE_TABLES.map((one) => ({ value: one, label: T.tables[one] }));

const API = "/api/admin/track-cache";
const ROW_H = 28;
const HEAD_W = 44;
const BLOCK = 100;
const PROBE_POLL_MS = 1500;
const HINT_MS = 4000;
const DEFAULT_WIDTH: Record<string, number> = { requestKey: 260, audioUrl: 260, audioKey: 200, title: 180, artist: 120, channel: 120, platform: 90, pinnedAt: 136, file: 84, status: 84, size: 76, plays: 64, requests: 64, duration: 64, lastPlayedAt: 136, downloadedAt: 136, ageMarkedAt: 136, markedAt: 136, check: 88, videoId: 140 };

// ── 테이블 · 필터 · 정렬 · 열 모양(열 너비 · 숨김 · 고정은 브라우저에 사람마다) ──────

const table = ref<TrackCacheTable>("requests");
const filters = reactive<Record<TrackCacheTable, Record<string, string>>>({ requests: {}, files: {}, age: {} });
const sorts = reactive<Record<TrackCacheTable, TrackCacheSort>>({ requests: [...TRACK_CACHE_DEFAULT_SORT.requests], files: [...TRACK_CACHE_DEFAULT_SORT.files], age: [...TRACK_CACHE_DEFAULT_SORT.age] });
const q = ref("");
const sort = computed(() => sorts[table.value]);

type Layout = { widths: Record<string, number>; hidden: string[]; frozen: number };
const LAYOUT_KEY = "cacheDb.layout";
const layouts = reactive<Record<TrackCacheTable, Layout>>(readLayouts());
function readLayouts(): Record<TrackCacheTable, Layout> {
  const blank = (): Layout => ({ widths: {}, hidden: [], frozen: 1 });
  try {
    const saved = JSON.parse(readStored(LAYOUT_KEY) ?? "{}") as Partial<Record<TrackCacheTable, Layout>>;
    return { requests: { ...blank(), ...saved.requests }, files: { ...blank(), ...saved.files }, age: { ...blank(), ...saved.age } };
  } catch {
    return { requests: blank(), files: blank(), age: blank() };
  }
}
const saveLayouts = () => writeStored(LAYOUT_KEY, JSON.stringify(layouts));
const layout = computed(() => layouts[table.value]);
const shown = computed(() => (TRACK_CACHE_COLUMNS[table.value] as readonly string[]).filter((c) => !layout.value.hidden.includes(c)));
const widthOf = (c: string) => layout.value.widths[c] ?? DEFAULT_WIDTH[c] ?? 100;
const tableWidth = computed(() => HEAD_W + shown.value.reduce((sum, c) => sum + widthOf(c), 0));
// 고정한 열: 행 번호 오른쪽으로 붙는다
const frozenLeft = (i: number) => HEAD_W + shown.value.slice(0, i).reduce((sum, c) => sum + widthOf(c), 0);
const frozenStyle = (i: number) => (i < layout.value.frozen ? { left: `${frozenLeft(i)}px` } : undefined);
// 고정한 열은 스크롤할 때 뒤 셀이 비치지 않게 바탕을 깐다(셀에 바탕색이 따로 없으면)
const frozenClass = (i: number, body = false, cls = "") => (i < layout.value.frozen ? ["sticky", body ? "z-5" : "z-30", !body || !cls.includes("bg-") ? "bg-surface-container" : ""] : []);

let resizing: { c: string; x: number; w: number } | null = null;
function startResize(event: MouseEvent, c: string) {
  resizing = { c, x: event.clientX, w: widthOf(c) };
  const move = (e: MouseEvent) => {
    if (resizing) layout.value.widths[resizing.c] = Math.max(40, resizing.w + e.clientX - resizing.x);
  };
  const up = () => {
    resizing = null;
    saveLayouts();
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

// ── 행 읽기(이어 불러오기: 보이는 구간의 청크만 불러온다) ─────────────────────

const rows = reactive(new Map<number, AnyRow>());
const matched = ref(0);
const total = ref(0);
const loading = ref(false);
const loadedRevision = ref(0);
const botChanged = ref(false);
const problems = reactive<Record<string, string>>({});
const scroller = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewHeight = ref(512);
let generation = 0;
const pendingBlocks = new Set<number>();

const hasFilters = computed(() => Object.values(filters[table.value]).some(Boolean) || Boolean(q.value.trim()));
const queryOf = (offset: number, limit: number) => ({ table: table.value, filters: filters[table.value], q: q.value.trim(), sort: sort.value, offset, limit }) as TrackCacheQuery;

// 필터 식은 화면에서 먼저 읽어 입력란에 문제를 보인다(서버도 같은 규칙으로 다시 본다)
function checkFilters(): boolean {
  for (const key of Object.keys(problems)) delete problems[key];
  const kinds = TRACK_CACHE_COLUMN_KINDS[table.value] as Record<string, never>;
  for (const [c, expr] of Object.entries(filters[table.value])) {
    const parsed = parseFilter(kinds[c], expr);
    if (parsed && !parsed.ok) problems[c] = noticeText(parsed.code).title;
  }
  const words = parseWords(q.value);
  if (words && !words.ok) problems.q = noticeText(words.code).title;
  return Object.keys(problems).length === 0;
}

async function loadBlock(block: number, gen = generation) {
  if (pendingBlocks.has(block)) return;
  pendingBlocks.add(block);
  try {
    const { data } = await axios.get<TrackCachePage>(`${API}?${trackCacheSearch(queryOf(block * BLOCK, BLOCK))}`);
    if (gen !== generation) return;
    data.rows.forEach((row, i) => rows.set(data.offset + i, row));
    matched.value = data.matched;
    total.value = data.total;
    loadedRevision.value = data.revision;
    checkRevision.value = data.checkRevision;
  } catch (e) {
    if (gen === generation) notifyProblem(e, T.loadFailed);
  } finally {
    pendingBlocks.delete(block);
  }
}
/** 아직 불러오지 않은 청크를 모두 불러온다(모든 행 선택) */
async function loadAll() {
  const gen = generation;
  for (let b = 0; b * BLOCK < matched.value && gen === generation; b++) if (!rows.has(b * BLOCK)) await loadBlock(b, gen);
}

/** 처음부터 다시 읽는다(테이블 · 필터 · 정렬이 바뀌었거나 새로고침) */
async function reload() {
  if (!checkFilters()) return;
  generation++;
  rows.clear();
  pendingBlocks.clear();
  rowSel.clear();
  botChanged.value = false;
  loading.value = true;
  await loadBlock(Math.floor(scrollTop.value / ROW_H / BLOCK));
  loading.value = false;
  ensureVisible();
}

let filterTimer = 0;
function setFilter(c: string, value: string) {
  filters[table.value][c] = value;
  clearTimeout(filterTimer);
  filterTimer = window.setTimeout(() => void reload(), 300);
}
watch(q, () => {
  clearTimeout(filterTimer);
  filterTimer = window.setTimeout(() => void reload(), 300);
});
/** 열 하나의 필터 지우기(입력란 안 x). 입력란에 포커스를 돌려 이어 쓰게 */
function clearFilter(c: string, event: MouseEvent) {
  setFilter(c, "");
  ((event.currentTarget as HTMLElement).previousElementSibling as HTMLInputElement | null)?.focus();
}
const searchBox = ref<HTMLInputElement | null>(null);
function clearSearch() {
  q.value = "";
  searchBox.value?.focus();
}
function clearFilters() {
  filters[table.value] = {};
  q.value = "";
  void reload();
}
function setSort(next: TrackCacheSort) {
  sorts[table.value] = next;
  void reload();
}
const sortOf = (c: string) => sort.value.find((one) => one.column === c)?.dir;
const sortRank = (c: string) => (sort.value.length > 1 ? sort.value.findIndex((one) => one.column === c) + 1 || 0 : 0);
// 헤더 클릭: 오름 ↔ 내림. Ctrl 을 누르면 여러 열
function toggleSort(c: string, event: MouseEvent) {
  const now = sortOf(c);
  const dir = now === "asc" ? "desc" : "asc";
  const one = { column: c, dir } as TrackCacheSort[number];
  if (event.ctrlKey || event.metaKey) setSort(now ? sort.value.map((s) => (s.column === c ? one : s)) : [...sort.value, one]);
  else setSort([one]);
}
function switchTable(next: TrackCacheTable) {
  table.value = next;
  focus.value = null;
  anchor.value = null;
  rowAnchor.value = null;
  extra.clear();
  scroller.value?.scrollTo({ top: 0, left: 0 });
  scrollTop.value = 0;
  void reload();
}

// 보이는 구간
const visibleFrom = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - 10));
const visibleTo = computed(() => Math.min(matched.value, Math.ceil((scrollTop.value + viewHeight.value) / ROW_H) + 10));
const visibleIndexes = computed(() => Array.from({ length: Math.max(0, visibleTo.value - visibleFrom.value) }, (_, i) => visibleFrom.value + i));
const topPad = computed(() => visibleFrom.value * ROW_H);
const bottomPad = computed(() => Math.max(0, (matched.value - visibleTo.value) * ROW_H));
const rowAt = (r: number) => rows.get(r);
function ensureVisible() {
  for (let b = Math.floor(visibleFrom.value / BLOCK); b * BLOCK < visibleTo.value; b++) if (!rows.has(b * BLOCK)) void loadBlock(b);
}
function onScroll() {
  scrollTop.value = scroller.value?.scrollTop ?? 0;
  ensureVisible();
}
// 보이는 행(앞뒤 여유 행은 빼고)
const rangeText = computed(() => {
  if (!matched.value) return T.pager.range(0, 0, 0);
  const first = Math.floor(scrollTop.value / ROW_H);
  return T.pager.range(first + 1, Math.min(matched.value, first + Math.floor((viewHeight.value - 60) / ROW_H)), matched.value);
});
const goTo = ref(1);
function scrollToRow(r: number) {
  const target = Math.max(0, Math.min(matched.value - 1, r));
  scroller.value?.scrollTo({ top: target * ROW_H });
}
function jumpTo(r: number) {
  const target = Math.max(0, Math.min(matched.value - 1, r));
  scrollToRow(target);
  rowSel.clear();
  extra.clear();
  moveFocus({ r: target, i: focus.value?.i ?? 0 }, false);
  scroller.value?.focus({ preventScroll: true });
}
const pageRows = () => Math.max(1, Math.floor(viewHeight.value / ROW_H) - 3);
const PAGER: Array<{ icon: IconName; label: string; go: () => void }> = [
  { icon: "skip_previous", label: T.pager.first, go: () => scrollToRow(0) },
  { icon: "arrow_back", label: T.pager.prev, go: () => scrollToRow(Math.floor(scrollTop.value / ROW_H) - pageRows()) },
  { icon: "arrow_forward", label: T.pager.next, go: () => scrollToRow(Math.floor(scrollTop.value / ROW_H) + pageRows()) },
  { icon: "skip_next", label: T.pager.last, go: () => scrollToRow(matched.value - 1) },
];

// 상태 줄의 안내(잠깐)
const hint = ref("");
let hintTimer = 0;
function say(text: string) {
  hint.value = text;
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => (hint.value = ""), HINT_MS);
}
const refocus = () => void nextTick(() => scroller.value?.focus({ preventScroll: true }));

// ── 선택(셀 · 행). 행 번호로 든다 ──────────────────────────────────────────

type Pos = { r: number; i: number };
const focus = ref<Pos | null>(null);
const anchor = ref<Pos | null>(null);
const extra = reactive(new Set<string>());
const rowSel = reactive(new Set<number>());
const rowAnchor = ref<number | null>(null);
let dragging = false;
let rowDragging = false;
// Ctrl 을 누르고 행을 끌 때 그 전에 선택해 둔 행
let rowBase: number[] = [];

const inRange = (r: number, i: number) => {
  if (!focus.value || !anchor.value) return false;
  const [r0, r1] = [Math.min(focus.value.r, anchor.value.r), Math.max(focus.value.r, anchor.value.r)];
  const [i0, i1] = [Math.min(focus.value.i, anchor.value.i), Math.max(focus.value.i, anchor.value.i)];
  return r >= r0 && r <= r1 && i >= i0 && i <= i1;
};
const isSelected = (r: number, i: number) => rowSel.has(r) || inRange(r, i) || extra.has(`${r}:${i}`);

function pickCell(r: number, i: number, event: MouseEvent) {
  if (event.button !== 0) return;
  const ctrl = event.ctrlKey || event.metaKey;
  // Ctrl+클릭: 지금 선택한 것은 두고 더한다
  if (ctrl) for (const p of selectedCells()) extra.add(`${p.r}:${p.i}`);
  else if (!event.shiftKey) extra.clear();
  rowSel.clear();
  moveFocus({ r, i }, event.shiftKey && !ctrl);
  dragging = true;
  window.addEventListener("mouseup", () => (dragging = false), { once: true });
}
function dragTo(r: number, i: number, event: MouseEvent) {
  if (dragging && event.buttons === 1) moveFocus({ r, i }, true);
}
function selectRowRange(from: number, to: number) {
  rowSel.clear();
  for (const one of rowBase) rowSel.add(one);
  for (let k = Math.min(from, to); k <= Math.max(from, to); k++) rowSel.add(k);
}
function pickRow(r: number, event: MouseEvent) {
  if (event.button !== 0) return;
  const ctrl = event.ctrlKey || event.metaKey;
  rowBase = ctrl ? [...rowSel] : [];
  if (event.shiftKey && rowAnchor.value !== null) selectRowRange(rowAnchor.value, r);
  else {
    rowAnchor.value = r;
    if (ctrl && rowSel.has(r)) rowSel.delete(r);
    else selectRowRange(r, r);
  }
  extra.clear();
  moveFocus({ r, i: focus.value?.i ?? 0 }, false);
  rowDragging = true;
  window.addEventListener("mouseup", () => (rowDragging = false), { once: true });
  scroller.value?.focus({ preventScroll: true });
}
function dragRow(r: number, event: MouseEvent) {
  if (!rowDragging || event.buttons !== 1 || rowAnchor.value === null) return;
  selectRowRange(rowAnchor.value, r);
  moveFocus({ r, i: focus.value?.i ?? 0 }, false);
}
async function selectAll() {
  extra.clear();
  rowBase = [];
  rowAnchor.value = 0;
  if (rows.size < matched.value) {
    say(T.hints.loadingAll);
    await loadAll();
    hint.value = "";
  }
  selectRowRange(0, matched.value - 1);
}
/** 선택한 행의 키(행 번호로 선택한 행, 없으면 선택한 셀의 행) */
function selectedKeys(): string[] {
  const set = new Set<number>(rowSel);
  if (!set.size) for (const p of selectedCells()) set.add(p.r);
  return [...set]
    .sort((a, b) => a - b)
    .map((r) => rowAt(r))
    .filter((row): row is AnyRow => Boolean(row))
    .map((row) => keyOf(table.value, row));
}
function selectedCells(): Pos[] {
  const out: Pos[] = [];
  if (focus.value && anchor.value) {
    for (let r = Math.min(focus.value.r, anchor.value.r); r <= Math.max(focus.value.r, anchor.value.r); r++) for (let i = Math.min(focus.value.i, anchor.value.i); i <= Math.max(focus.value.i, anchor.value.i); i++) out.push({ r, i });
  }
  for (const one of extra) {
    const [r, i] = one.split(":").map(Number);
    if (!out.some((p) => p.r === r && p.i === i)) out.push({ r, i });
  }
  return out;
}

// ── 변경(저장 전). change() 로 감싸면 Ctrl+Z 로 되돌릴 수 있다 ───────────────────

const changes = reactive<Changes>(emptyChanges());
const failures = reactive(new Map<string, string>());
let nextNewId = 1;
const cellId = (key: string, column: string | null) => `${table.value}|${key}|${column ?? "*"}`;

const history: string[] = [];
const snapshot = () => JSON.stringify({ pins: [...changes.pins], unpins: [...changes.unpins], clears: [...changes.clears], deleteRequests: [...changes.deleteRequests], deleteFiles: [...changes.deleteFiles], clearAges: [...changes.clearAges], newRows: changes.newRows });
function change(run: () => void) {
  const before = snapshot();
  run();
  if (snapshot() !== before) history.push(before);
}
function undo() {
  const last = history.pop();
  if (!last) return say(T.hints.nothingToUndo);
  const one = JSON.parse(last);
  Object.assign(changes, { pins: new Map(one.pins), unpins: new Map(one.unpins), clears: new Map(one.clears), deleteRequests: new Map(one.deleteRequests), deleteFiles: new Map(one.deleteFiles), clearAges: new Map(one.clearAges), newRows: one.newRows });
  syncPane();
  say(T.hints.undone);
}

function setPin(row: TrackRequestRow, value: string) {
  const audioUrl = value.trim();
  const rk = row.requestKey;
  changes.unpins.delete(rk);
  changes.clears.delete(rk);
  if (!audioUrl || audioUrl === row.audioUrl) changes.pins.delete(rk);
  else changes.pins.set(rk, { audioUrl, expect: row.pinnedAt !== null ? row.audioUrl : null });
}
/** 셀 지우기: 열마다 정해진 조작 하나. 지울 것이 없으면 false */
function clearCell(row: AnyRow, column: string): boolean {
  if (table.value !== "requests") return false;
  const r = row as TrackRequestRow;
  if (column === "audioUrl") {
    const pending = changes.pins.delete(r.requestKey);
    if (r.pinnedAt !== null) changes.unpins.set(r.requestKey, r.audioUrl);
    else if (!r.sameAsRequest && r.ledgerAudioUrl) changes.clears.set(r.requestKey, r.ledgerAudioUrl);
    else return pending;
    return true;
  }
  if (column === "file" && r.audioKey && r.file !== "none") {
    changes.deleteFiles.set(r.audioKey, r.downloadedAt);
    return true;
  }
  if (column === "ageMarkedAt" && r.ageMarkedAt !== null && r.audioKey?.startsWith("yt:")) {
    changes.clearAges.set(r.audioKey.slice(3), r.ageMarkedAt);
    return true;
  }
  return false;
}
function clearCells(cells: Pos[]) {
  let cleared = false;
  change(() => {
    for (const p of cells) {
      const row = rowAt(p.r);
      if (row && !isDeleted(p.r) && clearCell(row, shown.value[p.i])) cleared = true;
    }
  });
  if (!cleared && cells.length) say(table.value === "requests" ? T.hints.cantClear(T.columns[shown.value[cells[0].i]]) : T.hints.cantClearRow);
  syncPane();
}
/** 행 삭제: 키로 */
function deleteRows(keys: string[]) {
  const max = table.value === "files" ? TRACK_CACHE_FILE_DELETES_MAX : TRACK_CACHE_OPS_MAX;
  if (keys.length > max) return say(T.hints.tooMany(max));
  change(() => {
    for (const key of keys) {
      const row = [...rows.values()].find((one) => keyOf(table.value, one) === key);
      if (!row) continue;
      if (table.value === "requests") {
        const r = row as TrackRequestRow;
        changes.deleteRequests.set(key, { ledgerAudioUrl: r.ledgerAudioUrl, pinned: r.pinnedAt !== null ? r.audioUrl : null });
      } else if (table.value === "files") changes.deleteFiles.set(key, (row as TrackFileRow).downloadedAt);
      else changes.clearAges.set(key, (row as TrackAgeRow).markedAt);
    }
  });
  syncPane();
}
function deleteSelected() {
  deleteRows(selectedKeys());
  refocus();
}
function addNewRow() {
  const id = nextNewId++;
  change(() => changes.newRows.unshift({ id, requestKey: "", audioUrl: "" }));
  void nextTick(() => scroller.value?.querySelector<HTMLInputElement>(`[data-new="${id}:requestKey"]`)?.focus());
}

const isDeleted = (r: number) => {
  const row = rowAt(r);
  if (!row) return false;
  const key = keyOf(table.value, row);
  return table.value === "requests" ? changes.deleteRequests.has(key) : table.value === "files" ? changes.deleteFiles.has(key) : changes.clearAges.has(key);
};
/** 재생 음원이 직접 지정한 것인가(저장 전 변경까지 셈한다) */
function isPinned(r: number): boolean {
  const row = rowAt(r) as TrackRequestRow | undefined;
  if (!row || table.value !== "requests") return false;
  if (changes.pins.has(row.requestKey)) return true;
  return row.pinnedAt !== null && !changes.unpins.has(row.requestKey);
}
// 재생 음원 셀의 바뀐 값(지정 · 해제 · 자동 검색 결과 삭제). 안 바뀌었으면 null
function changedAudio(one: TrackRequestRow): string | null {
  if (changes.pins.has(one.requestKey)) return changes.pins.get(one.requestKey)!.audioUrl;
  if (changes.unpins.has(one.requestKey)) return one.ledgerAudioUrl ?? T.values.none;
  if (changes.clears.has(one.requestKey)) return T.values.none;
  return null;
}
function changedText(r: number, c: string): string | null {
  const row = rowAt(r);
  if (!row || table.value !== "requests") return null;
  const one = row as TrackRequestRow;
  if (c === "audioUrl") return changedAudio(one);
  if (c === "pinnedAt" && changes.unpins.has(one.requestKey)) return "";
  if (c === "file" && one.audioKey && changes.deleteFiles.has(one.audioKey)) return T.values.file.none;
  if (c === "ageMarkedAt" && one.audioKey && changes.clearAges.has(one.audioKey.slice(3))) return "";
  return null;
}
const shownText = (r: number, c: string) => changedText(r, c) ?? cellText(table.value, rowAt(r)!, c);

// 셀의 저장 실패. 캐시 파일 삭제는 캐시 키로 든다(요청 테이블의 캐시 파일 셀도 그 키로 찾는다)
function failureOf(row: AnyRow, c: string): string | undefined {
  const key = keyOf(table.value, row);
  const audioKey = table.value === "requests" && c === "file" ? (row as TrackRequestRow).audioKey : null;
  return failures.get(cellId(key, c)) ?? failures.get(cellId(key, null)) ?? (audioKey ? failures.get(`requests|${audioKey}|file`) : undefined);
}
// 선택 색은 반투명이라, 고정한 열에서는 바탕을 깔고 그 위에 덧씌운다(스크롤하는 셀이 비치지 않게)
const SELECTED = "bg-primary/20";
const SELECTED_FROZEN = "bg-surface-container before:absolute before:inset-0 before:bg-primary/20 before:pointer-events-none";
function cellClass(r: number, c: string) {
  const i = shown.value.indexOf(c);
  const row = rowAt(r)!;
  const selected = i < layout.value.frozen ? SELECTED_FROZEN : SELECTED;
  if (failureOf(row, c)) return "outline-2 -outline-offset-2 outline-error " + (isSelected(r, i) ? selected : "");
  const changed = changedText(r, c) !== null;
  if (isSelected(r, i)) return changed ? "bg-tertiary-container text-on-tertiary-container outline-2 -outline-offset-2 outline-primary" : `${selected} text-on-surface`;
  if (changed) return "bg-tertiary-container text-on-tertiary-container";
  if (isDeleted(r)) return "text-on-surface-variant";
  return failing(row, c) ? "text-error" : "text-on-surface";
}
// 재생 테스트 실패인가. 라이브는 지정한 음원일 때만(라이브는 지정할 수 없어 틀 때 건너뛴다)
const checkFailed = (one: TrackRequestRow) => !!one.check && !one.check.ok && (one.check.code !== "live" || one.pinnedAt !== null);
// 빨갛게 보일 셀: 재생 테스트 실패와 그 음원 · 다운로드 실패
function failing(row: AnyRow, c: string): boolean {
  if (table.value === "files") return c === "status" && (row as TrackFileRow).status === "error";
  if (table.value !== "requests") return false;
  const one = row as TrackRequestRow;
  if (c === "check" || c === "audioUrl") return checkFailed(one);
  return c === "file" && one.file === "error";
}
function rowHeadClass(r: number) {
  if (isDeleted(r)) return "bg-error-container text-on-error-container";
  if (rowSel.has(r)) return "bg-primary text-on-primary";
  return "bg-surface-container text-on-surface-variant";
}
// 툴팁은 값만으로 알 수 없는 것에만: 저장 실패 · 재생 불가 까닭
function tipOf(r: number, c: string): string {
  const row = rowAt(r)!;
  const failure = failureOf(row, c);
  if (failure) return failure;
  if (table.value === "requests" && c === "check") {
    const one = row as TrackRequestRow;
    const check = one.check;
    if (check && !check.ok && checkFailed(one)) return T.tips.checkFailed(check.code === "live" ? T.tips.pinnedLive : noticeText(check.code).title, stamp(check.at));
  }
  return "";
}

// ── 셀 안 편집 · 셀 편집 창 ───────────────────────────────────────────────

const editing = ref<{ r: number; c: string; value: string } | null>(null);
const inlineInput = ref<HTMLInputElement[] | null>(null);
function startEdit(r: number, c: string) {
  const row = rowAt(r);
  if (!row || isDeleted(r)) return;
  if (!editable(table.value, c)) return say(T.hints.readonly(T.columns[c]));
  editing.value = { r, c, value: changedText(r, c) ?? rawText(row, c) };
  void nextTick(() => inlineInput.value?.[0]?.select());
}
function commitInline() {
  const one = editing.value;
  if (!one) return;
  editing.value = null;
  const row = rowAt(one.r) as TrackRequestRow | undefined;
  if (row) change(() => setPin(row, one.value));
  syncPane();
  refocus();
}
function onInlineKey(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    commitInline();
    if (event.key === "Tab") moveBy(event, { r: 0, i: event.shiftKey ? -1 : 1 });
  }
  if (event.key === "Escape") {
    event.preventDefault();
    editing.value = null;
    refocus();
  }
}

const pane = reactive<{ value: string; dirty: boolean; info: { ok: boolean; text: string } | null }>({ value: "", dirty: false, info: null });
const focusInfo = computed(() => {
  if (!focus.value) return null;
  const row = rowAt(focus.value.r);
  const column = shown.value[focus.value.i];
  if (!row || !column) return null;
  return { column, label: focus.value.r + 1, editable: editable(table.value, column) && !isDeleted(focus.value.r) };
});
// 재생 음원 셀: 지정을 해제하면 돌아갈 곳 · 요청 링크 그대로인지
const paneNote = computed(() => {
  if (!focus.value || table.value !== "requests") return "";
  const row = rowAt(focus.value.r) as TrackRequestRow | undefined;
  if (!row) return "";
  if (isPinned(focus.value.r)) return row.ledgerAudioUrl ? T.editPane.unpinTo(row.ledgerAudioUrl) : T.editPane.unpinToNone;
  return row.sameAsRequest ? T.editPane.sameAsRequest : "";
});
function syncPane() {
  if (!focus.value || !focusInfo.value) return;
  const row = rowAt(focus.value.r)!;
  pane.value = changedText(focus.value.r, focusInfo.value.column) ?? rawText(row, focusInfo.value.column);
  pane.dirty = false;
  pane.info = null;
  // 끌거나 방향키를 누르고 있으면 셀마다 묻지 않게 잠깐 기다린다
  clearTimeout(inspectTimer);
  if (focusInfo.value.editable) {
    const value = pane.value;
    inspectTimer = window.setTimeout(() => void inspect(value), 300);
  }
}
/** 선택한 셀을 옮긴다. 셀 편집 창에 적용하지 않은 편집이 있으면 먼저 적용한다(Ctrl+Z 로 되돌린다) */
function moveFocus(next: Pos, extend: boolean) {
  if (pane.dirty && focus.value && (focus.value.r !== next.r || focus.value.i !== next.i)) applyPane(false);
  focus.value = next;
  if (!extend) anchor.value = next;
  syncPane();
}
function applyPane(back: boolean) {
  if (!focus.value || !focusInfo.value?.editable) return;
  const row = rowAt(focus.value.r) as TrackRequestRow;
  const value = pane.value;
  change(() => setPin(row, value));
  pane.dirty = false;
  if (back) refocus();
}
function cancelPane() {
  syncPane();
  refocus();
}
let inspectTimer = 0;
watch(
  () => pane.value,
  (value) => {
    if (!pane.dirty) return;
    clearTimeout(inspectTimer);
    inspectTimer = window.setTimeout(() => void inspect(value), 300);
  },
);
async function inspect(audioUrl: string) {
  if (!audioUrl.trim()) return (pane.info = null);
  const { data } = await axios.post<TrackCacheInspected>(`${API}/inspect`, { audioUrl });
  const audio = data.audio;
  if (!audio) return;
  pane.info = audio.ok ? { ok: true, text: T.editPane.audioInfo(T.editPane.kinds[audio.kind] ?? audio.kind, audio.audioKey) } : { ok: false, text: noticeText(audio.code).title };
}
// 새 행의 값 검사(입력란 툴팁)
const newProblems = reactive(new Map<string, string>());
const newProblem = (id: number, c: string) => newProblems.get(`${id}:${c}`) ?? "";
let newTimer = 0;
function inspectNew(row: NewRow, c: "requestKey" | "audioUrl") {
  clearTimeout(newTimer);
  newTimer = window.setTimeout(async () => {
    const value = row[c].trim();
    if (!value) return newProblems.delete(`${row.id}:${c}`);
    const { data } = await axios.post<TrackCacheInspected>(`${API}/inspect`, c === "requestKey" ? { requestKey: value } : { audioUrl: value });
    const one = c === "requestKey" ? data.request : data.audio;
    if (one && !one.ok) newProblems.set(`${row.id}:${c}`, noticeText(one.code).title);
    else newProblems.delete(`${row.id}:${c}`);
  }, 300);
}
function onNewKey(event: KeyboardEvent, n: number) {
  if (event.isComposing) return;
  if (event.key === "Escape") {
    change(() => changes.newRows.splice(n, 1));
    refocus();
  }
}
const isLink = (value: string) => /^https?:\/\//.test(value.trim());

// ── 복사 · 붙여넣기: 브라우저의 copy · paste 이벤트로(보안 연결이 아닌 주소에서도 된다) ─────

let copyHeaders = false;
/** 메뉴가 부른 복사의 글(열 이름 등). 있으면 셀 대신 이것을 넣는다 */
let copyPlain: string | null = null;
function copyText(withHeaders: boolean): { text: string; rows: number } | null {
  const cells = selectedCells();
  if (!cells.length && !rowSel.size) return null;
  const picked = rowSel.size ? [...rowSel].sort((a, b) => a - b) : [...new Set(cells.map((p) => p.r))].sort((a, b) => a - b);
  const cols = rowSel.size ? shown.value.map((_, i) => i) : [...new Set(cells.map((p) => p.i))].sort((a, b) => a - b);
  const lines = picked.map((r) => cols.map((i) => (rowAt(r) ? rawText(rowAt(r)!, shown.value[i]) : "")).join("\t"));
  if (withHeaders) lines.unshift(cols.map((i) => T.columns[shown.value[i]]).join("\t"));
  return { text: lines.join("\n"), rows: picked.length };
}
const gridFocused = () => document.activeElement === scroller.value;
function onCopy(event: ClipboardEvent) {
  if (!gridFocused()) return;
  if (copyPlain !== null) {
    event.preventDefault();
    event.clipboardData?.setData("text/plain", copyPlain);
    copyPlain = null;
    return say(T.hints.copiedText);
  }
  const got = copyText(copyHeaders);
  copyHeaders = false;
  if (!got) return;
  event.preventDefault();
  event.clipboardData?.setData("text/plain", got.text);
  say(T.hints.copied(got.rows));
}
/** 메뉴의 복사: 격자에 포커스를 두고 브라우저 복사를 부른다(onCopy 가 받는다) */
function copy(withHeaders: boolean) {
  scroller.value?.focus({ preventScroll: true });
  copyHeaders = withHeaders;
  document.execCommand("copy");
}
/** 메뉴의 글 복사(열 이름): 셀 복사와 같은 길(클립보드 API 는 보안 연결에서만 있다) */
function copyPlainText(value: string) {
  scroller.value?.focus({ preventScroll: true });
  copyPlain = value;
  document.execCommand("copy");
  copyPlain = null;
}
function pasteText(text: string) {
  const cells = selectedCells();
  if (cells.length !== 1 || !editable(table.value, shown.value[cells[0].i]) || isDeleted(cells[0].r)) return say(T.pasteMany);
  const row = rowAt(cells[0].r) as TrackRequestRow | undefined;
  const value = text.trim().split(/\r?\n/)[0];
  if (row) change(() => setPin(row, value));
  syncPane();
}
function onPaste(event: ClipboardEvent) {
  if (!gridFocused()) return;
  event.preventDefault();
  pasteText(event.clipboardData?.getData("text/plain") ?? "");
}
// 메뉴의 붙여넣기는 클립보드 API 가 있을 때만(보안 연결) 된다. 없으면 Ctrl+V 로 안내
function menuPaste() {
  if (!navigator.clipboard?.readText) return say(T.hints.noClipboard);
  navigator.clipboard
    .readText()
    .then(pasteText)
    .catch(() => say(T.hints.noClipboard));
}

// ── 키 ──────────────────────────────────────────────────────────────────────

// 카드 어디서든(필터 · 편집 창 안이어도): F5 새로고침 · Ctrl+S 저장 · Esc 메뉴 닫기
function onCardKey(event: KeyboardEvent) {
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.key === "F5") {
    event.preventDefault();
    void reload();
  } else if (ctrl && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (editing.value) commitInline();
    if (pane.dirty) applyPane(false);
    void save();
  } else if (event.key === "Escape" && (menu.value || showKeys.value)) {
    event.preventDefault();
    event.stopPropagation();
    closePopups();
    refocus();
  }
}
function moveBy(event: KeyboardEvent, delta: Pos, absolute?: Partial<Pos>) {
  if (!focus.value) return;
  const r = absolute?.r ?? focus.value.r + delta.r;
  const i = absolute?.i ?? focus.value.i + delta.i;
  const next = { r: Math.max(0, Math.min(matched.value - 1, r)), i: Math.max(0, Math.min(shown.value.length - 1, i)) };
  const extend = event.shiftKey && event.key !== "Tab";
  if (!extend) {
    rowSel.clear();
    extra.clear();
  }
  moveFocus(next, extend);
  keepInView(next.r, next.i, absolute?.i === 0);
}
function onKey(event: KeyboardEvent) {
  if (event.target !== scroller.value || event.isComposing) return;
  const ctrl = event.ctrlKey || event.metaKey;
  const key = event.key;
  if (ctrl && key.toLowerCase() === "a") return void (event.preventDefault(), selectAll());
  if (ctrl && key.toLowerCase() === "z") return void (event.preventDefault(), undo());
  if (!focus.value) {
    if (key.startsWith("Arrow") && matched.value) moveFocus({ r: 0, i: 0 }, false);
    return;
  }
  const last = { r: matched.value - 1, i: shown.value.length - 1 };
  const moves: Record<string, () => void> = {
    ArrowUp: () => moveBy(event, { r: -1, i: 0 }),
    ArrowDown: () => moveBy(event, { r: 1, i: 0 }),
    ArrowLeft: () => moveBy(event, { r: 0, i: -1 }),
    ArrowRight: () => moveBy(event, { r: 0, i: 1 }),
    Tab: () => moveBy(event, { r: 0, i: event.shiftKey ? -1 : 1 }),
    PageUp: () => moveBy(event, { r: -pageRows(), i: 0 }),
    PageDown: () => moveBy(event, { r: pageRows(), i: 0 }),
    Home: () => moveBy(event, { r: 0, i: 0 }, ctrl ? { r: 0 } : { i: 0 }),
    End: () => moveBy(event, { r: 0, i: 0 }, ctrl ? { r: last.r } : { i: last.i }),
  };
  if (moves[key]) {
    event.preventDefault();
    return moves[key]();
  }
  onCellKey(event, focus.value);
}
// 셀에서의 편집 키: F2 · Enter 편집 · Esc 선택 풀기 · Delete 지우기
function onCellKey(event: KeyboardEvent, { r, i }: { r: number; i: number }) {
  const key = event.key;
  if (key === "F2" || key === "Enter") return void (event.preventDefault(), startEdit(r, shown.value[i]));
  if (key === "Escape") {
    rowSel.clear();
    extra.clear();
    anchor.value = { r, i };
  }
  if (key === "Delete" || key === "Backspace") {
    event.preventDefault();
    if (rowSel.size) deleteSelected();
    else clearCells(selectedCells());
  }
}
/** 키보드로 옮긴 셀이 보이게 스크롤한다(고정한 열 · 행 번호 · 헤더에 가리지 않게) */
function keepInView(r: number, i: number, toStart = false) {
  const el = scroller.value;
  if (!el) return;
  const top = r * ROW_H;
  const head = 60 + changes.newRows.length * ROW_H;
  if (top < el.scrollTop) el.scrollTop = top;
  else if (top + ROW_H > el.scrollTop + el.clientHeight - head) el.scrollTop = top + ROW_H - el.clientHeight + head;
  // 고정한 열은 늘 보인다. Home 이면 가로도 처음으로
  if (i < layout.value.frozen) return void (toStart && (el.scrollLeft = 0));
  const left = frozenLeft(i);
  const right = left + widthOf(shown.value[i]);
  const covered = frozenLeft(layout.value.frozen);
  if (left - covered < el.scrollLeft) el.scrollLeft = left - covered;
  else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
}

// ── 오른쪽 클릭 메뉴 · 단축키 도움말 ─────────────────────────────────────────

type Item = { label: string; hint?: string; danger?: boolean; off?: boolean; run?: () => void } | "-";
const menu = ref<{ x: number; y: number; items: Item[]; grid: boolean } | null>(null);
const showKeys = ref(false);
function closePopups() {
  menu.value = null;
  showKeys.value = false;
}
function place(event: MouseEvent, items: Item[], grid: boolean) {
  showKeys.value = false;
  menu.value = { x: Math.min(event.clientX, innerWidth - 260), y: Math.min(event.clientY, innerHeight - items.length * 32 - 16), items, grid };
}
function runMenu(item: Exclude<Item, "-">) {
  const grid = menu.value?.grid;
  menu.value = null;
  if (grid) scroller.value?.focus({ preventScroll: true });
  item.run?.();
}
function openHeaderMenu(event: MouseEvent, c: string, i: number) {
  place(
    event,
    [
      { label: T.headerMenu.hide, off: shown.value.length <= 1, run: () => (layout.value.hidden.push(c), saveLayouts()) },
      { label: T.headerMenu.showAll, off: !layout.value.hidden.length, run: () => ((layout.value.hidden = []), saveLayouts()) },
      { label: T.headerMenu.freeze, run: () => ((layout.value.frozen = i + 1), saveLayouts()) },
      { label: T.headerMenu.unfreeze, off: !layout.value.frozen, run: () => ((layout.value.frozen = 0), saveLayouts()) },
      "-",
      { label: T.headerMenu.copyName, run: () => copyPlainText(T.columns[c]) },
    ],
    false,
  );
}
function openFilterMenu(event: MouseEvent, c: string) {
  const now = () => filters[table.value][c] ?? "";
  const bare = () => now().replace(/^(<>|>=|<=|=|>|<)/, "");
  place(event, [...T.filterMenu.map((one): Item => ({ label: one.label, hint: one.hint, run: () => setFilter(c, one.insert === "~" ? `${now()}~` : one.insert === "//" ? `/${now()}/` : `${one.insert}${bare()}`) })), "-", { label: T.filterHelp }], false);
}
function openCellMenu(event: MouseEvent, r: number, i: number) {
  if (!isSelected(r, i)) {
    rowSel.clear();
    extra.clear();
    moveFocus({ r, i }, false);
  }
  const row = rowAt(r);
  const c = shown.value[i];
  if (!row) return;
  const raw = rawText(row, c);
  const filterBy = (expr: string) => () => setFilter(c, expr);
  const items: Item[] = [
    { label: T.cellMenu.copy, hint: "Ctrl+C", run: () => copy(false) },
    { label: T.cellMenu.copyWithHeaders, run: () => copy(true) },
    { label: T.cellMenu.paste, hint: "Ctrl+V", off: !editable(table.value, c) || isDeleted(r), run: menuPaste },
    "-",
    { label: T.cellMenu.filterEquals, run: filterBy(raw === "" ? "=''" : `=${raw}`) },
    { label: T.cellMenu.filterContains, off: raw === "", run: filterBy(raw) },
    { label: T.cellMenu.filterNotEquals, run: filterBy(raw === "" ? "<>''" : `<>${raw}`) },
    ...((TRACK_CACHE_COLUMN_KINDS[table.value] as Record<string, string>)[c] !== "text" && raw !== ""
      ? [
          { label: T.cellMenu.filterGreater, run: filterBy(`>${raw}`) },
          { label: T.cellMenu.filterLess, run: filterBy(`<${raw}`) },
        ]
      : []),
    "-",
  ];
  if (table.value === "requests") {
    const one = row as TrackRequestRow;
    const clear = () => clearCells([{ r, i }]);
    if (c === "audioUrl") {
      items.push({ label: T.cellMenu.edit, hint: "F2", off: isDeleted(r), run: () => startEdit(r, c) });
      if (isPinned(r)) items.push({ label: T.cellMenu.unpin, hint: "Delete", run: clear });
      else items.push({ label: T.cellMenu.clearResult, hint: "Delete", off: one.sameAsRequest || !one.ledgerAudioUrl, run: clear });
    }
    if (c === "file") items.push({ label: T.cellMenu.deleteFile(one.sharedBy), hint: "Delete", danger: true, off: one.file === "none", run: clear });
    if (c === "ageMarkedAt") items.push({ label: T.cellMenu.clearAge, hint: "Delete", off: one.ageMarkedAt === null, run: clear });
    items.push({ label: T.cellMenu.openRequest, off: !isLink(one.requestKey), run: () => window.open(one.requestKey, "_blank", "noopener") });
  }
  if (table.value !== "age") {
    items.push({ label: T.cellMenu.openAudio, off: !isLink(rawText(row, "audioUrl")), run: () => window.open(rawText(row, "audioUrl"), "_blank", "noopener") });
    items.push({ label: T.cellMenu.probe, run: () => void probe(selectedKeys()) });
  }
  const keys = selectedKeys();
  items.push("-", { label: T.cellMenu.deleteRows(keys.length), danger: true, run: () => deleteRows(keys) });
  place(event, items, true);
}

// ── 재생 테스트 ───────────────────────────────────────────────────────────────

const checking = ref<string[]>([]);
const checkRevision = ref(0);
async function probe(keys: string[]) {
  const urls = keys
    .map((key) => [...rows.values()].find((one) => keyOf(table.value, one) === key))
    .map((row) => (row ? (table.value === "requests" ? (changes.pins.get((row as TrackRequestRow).requestKey)?.audioUrl ?? (row as TrackRequestRow).audioUrl) : (row as TrackFileRow).audioUrl) : null))
    .filter((url): url is string => Boolean(url))
    .slice(0, 20);
  if (!urls.length) return;
  try {
    const { data } = await axios.post<TrackCacheProbeQueued>(`${API}/probe`, { audioUrls: urls });
    checking.value = [...new Set([...checking.value, ...data.keys.filter(Boolean)])];
    pollChecks();
  } catch (e) {
    notifyProblem(e, T.probeFailed);
  }
}
let checkTimer = 0;
function pollChecks() {
  clearTimeout(checkTimer);
  checkTimer = window.setTimeout(async () => {
    const { data } = await axios.get<TrackCacheRevision>(`${API}/revision`);
    if (data.checkRevision !== checkRevision.value) {
      const keys = [...new Set([...rows.values()].map((row) => (row as TrackRequestRow).audioKey ?? (row as TrackFileRow).audioKey).filter(Boolean))].slice(0, TRACK_CACHE_PAGE_MAX);
      const got = (await axios.get<TrackCacheChecks>(`${API}/checks?keys=${encodeURIComponent(keys.join(","))}`)).data;
      for (const row of rows.values()) if (table.value === "requests" && (row as TrackRequestRow).audioKey && got.checks[(row as TrackRequestRow).audioKey!]) (row as TrackRequestRow).check = got.checks[(row as TrackRequestRow).audioKey!];
      checkRevision.value = got.checkRevision;
    }
    checking.value = data.checking;
    if (data.checking.length) pollChecks();
  }, PROBE_POLL_MS);
}

// ── 변경 번호(탭이 보이는 동안 운영자 패널의 3초 읽기가 부른다) ─────────────

/** 봇이 이 표들을 바꿨는지 번호만 본다. 바뀌었으면 "새 변경 사항이 있어요" 알약(선택해 둔 것 · 바꾼 것을 지키려고 저절로 다시 읽지 않는다) */
async function checkChanged() {
  if (!loadedRevision.value || botChanged.value) return;
  try {
    const { data } = await axios.get<TrackCacheRevision>(`${API}/revision`);
    if (data.revision !== loadedRevision.value) botChanged.value = true;
  } catch {
    // 다음 주기에 다시 묻는다
  }
}
defineExpose({ checkChanged });

// ── 저장(저장 막대 · Ctrl+S) ─────────────────────────────────────────────────

const saving = ref(false);
const dirty = computed(() => changeCount(changes) > 0);
const RESULT_TEXT = (result: Exclude<TrackCacheOpResult, { ok: true }>) => (result.code === "in-use" ? T.results.inUse[result.where] : T.results[result.code]);
async function save(): Promise<boolean> {
  if (!dirty.value || saving.value) return true;
  const list = opsOf(changes);
  saving.value = true;
  failures.clear();
  try {
    const { data } = await axios.post<TrackCacheWritten>(API, { ops: list.map((one) => one.op) });
    let failed = 0;
    data.results.forEach((result, n) => {
      const { op, where } = list[n];
      if (result.ok) return forgetSaved(op, where.key);
      failed++;
      failures.set(`${where.table === "files" && table.value === "requests" ? "requests" : where.table}|${where.key}|${where.column ?? "*"}`, RESULT_TEXT(result));
    });
    // 저장한 것은 되돌리기 대상이 아니다
    history.length = 0;
    if (failed) notify({ title: T.results.partialTitle, body: T.results.done(data.results.length - failed, failed), severity: "warning" });
    else notifyDone(T.results.doneTitle, T.results.done(data.results.length, 0));
    await reload();
    return failed === 0;
  } catch (e) {
    markRefused(e, list);
    notifyProblem(e, T.results.partialTitle);
    return false;
  } finally {
    saving.value = false;
  }
}
// 저장한 조작을 바뀐 것에서 뺀다(새 행은 행째)
function forgetSaved(op: TrackCacheOp, key: string) {
  if (op.op === "pin" && key.startsWith("new:"))
    changes.newRows.splice(
      changes.newRows.findIndex((row) => `new:${row.id}` === key),
      1,
    );
  else if (op.op === "pin") changes.pins.delete(op.requestKey);
  if (op.op === "unpin") changes.unpins.delete(op.requestKey);
  if (op.op === "clearResult") changes.clears.delete(op.requestKey);
  if (op.op === "deleteRequest") changes.deleteRequests.delete(op.requestKey);
  if (op.op === "deleteFile") changes.deleteFiles.delete(op.audioKey);
  if (op.op === "clearAge") changes.clearAges.delete(op.videoId);
}
// 검사에 걸린 조작은 셀에 표시한다(아무것도 쓰지 않았다)
function markRefused(e: unknown, list: ReturnType<typeof opsOf>) {
  const errors = (replyOf(e) as { errors?: Array<{ pointer?: string; code: Code }> } | undefined)?.errors ?? [];
  for (const one of errors) {
    const n = Number(/^\/ops\/(\d+)/.exec(one.pointer ?? "")?.[1]);
    if (!Number.isInteger(n) || !list[n]) continue;
    const { where } = list[n];
    failures.set(`requests|${where.key}|${where.column ?? "*"}`, noticeText(one.code).title);
    if (where.key.startsWith("new:")) newProblems.set(`${where.key.slice(4)}:${/requestKey$/.test(one.pointer ?? "") ? "requestKey" : "audioUrl"}`, noticeText(one.code).title);
  }
}
function revert() {
  Object.assign(changes, emptyChanges());
  history.length = 0;
  failures.clear();
  newProblems.clear();
  syncPane();
}
useSaveTarget({ tab: "db", dirty, saving, save: () => save(), revert });

// ── 시작 · 끝 ───────────────────────────────────────────────────────────────

let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  void reload();
  document.addEventListener("copy", onCopy);
  document.addEventListener("paste", onPaste);
  if (scroller.value) {
    resizeObserver = new ResizeObserver(() => {
      viewHeight.value = scroller.value?.clientHeight ?? 512;
      ensureVisible();
    });
    resizeObserver.observe(scroller.value);
  }
});
onUnmounted(() => {
  clearTimeout(checkTimer);
  clearTimeout(hintTimer);
  document.removeEventListener("copy", onCopy);
  document.removeEventListener("paste", onPaste);
  resizeObserver?.disconnect();
});
</script>
