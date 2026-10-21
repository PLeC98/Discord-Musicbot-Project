<template>
  <!-- 로그 파일 보기. 실시간 로그 창과 같은 틀(머리 · 거르기 · 줄 영역). 실시간 로그의 "파일 보기"가 여는 페이지(views/LogFilesView)에 놓인다.
       배치는 카드 안쪽 폭으로 바꾼다(사이드바를 접은 화면 = 화면 - 116, 1280 이상은 - 124):
       1187 이상: 레벨 / 카테고리 · 태그 · 찾기 … 날짜 · 시간(224) · 파일(256).
       935 ~ 1186: 오른쪽이 한 열이 되어 날짜 · 시간(256)을 파일 위로(첫 줄 오른쪽까지).
       934 이하: [필터 · 찾기 … 날짜 · 시간 · 파일] 한 줄. 레벨 · 카테고리 · 태그는 필터 창에(고르는 대로 반영).
       804 이하는 날짜 · 시간을, 524 이하(사이드바를 편 820 · 휴대폰)는 파일까지 필터 창에(날짜 · 시간은 고르기 창의 "적용"). 오른쪽이 다 빠지면 찾기가 남은 폭을 다 쓴다 -->
  <section ref="card" class="@container/card pane rounded-(--r-window) p-(--pad-window) pb-[calc(var(--pad-window)+max(0px,var(--player)-var(--gap-out)))] -mb-(--player) flex flex-col gap-3 h-[calc(var(--desk-h)-var(--gap-out)*2)]">
    <PaneHeader icon="folder" :title="T.title">
      <!-- 실시간 로그처럼 제목 옆에 고른 파일의 전체 줄 수(불러온 수가 아니라). 찾은 줄 수는 찾기 칸 안에 -->
      <template #badge>
        <span v-if="current" class="text-xs nums text-on-surface shrink-0">{{ L.lines(current.lines) }}</span>
      </template>
      <template #actions>
        <BaseButton v-if="current" variant="ghost" size="sm" :href="downloadUrl" download v-tooltip="T.downloadTip"><Icon name="download" :size="18" />{{ T.download }}</BaseButton>
      </template>
    </PaneHeader>

    <div class="flex @min-[935px]/card:hidden items-center gap-2">
      <FilterButton :count="activeFilters" @open="sheetOpen = true" />
      <SearchInput v-model="term" :placeholder="T.search" :aria-label="T.search" :input-class="[SEARCH_FIELD, 'w-full']" :note="matchNote" class="flex-1 min-w-0 md:@min-[525px]/card:min-w-40 md:@min-[525px]/card:max-w-72" />
      <div class="hidden md:flex items-center gap-2 ml-auto shrink-0">
        <DateTimePicker v-model="at" class="hidden @min-[805px]/card:block w-56" :ranges="ranges" @go="jump" />
        <SingleSelect v-model="file" class="hidden @min-[525px]/card:block w-64" :options="fileOptions" />
      </div>
    </div>
    <FilterSheet :open="sheetOpen" @close="sheetOpen = false" @reset="resetFilters">
      <section class="flex flex-col gap-2">
        <h3 class="text-label font-semibold text-primary">{{ L.filterLevels }}</h3>
        <div class="flex flex-wrap gap-2">
          <button v-for="l in LEVEL_CHIPS" :key="l.value" type="button" :aria-pressed="levelsOn.has(l.value)" :class="[FILTER_CHIP, levelsOn.has(l.value) ? FILTER_CHIP_ON : FILTER_CHIP_OFF]" @click="toggleLevel(l.value)">{{ l.label }}</button>
        </div>
      </section>
      <section v-if="dateInside" class="flex flex-col gap-2">
        <h3 class="text-label font-semibold text-primary">{{ fileInside ? T.whenFile : T.when }}</h3>
        <SingleSelect v-if="fileInside" v-model="file" :options="fileOptions" />
        <DateTimePicker v-model="at" :ranges="ranges" @go="jump" />
      </section>
      <section class="flex flex-col gap-2">
        <h3 class="text-label font-semibold text-primary">{{ L.filterCategories }}</h3>
        <SingleSelect v-model="category" :options="categoryOptions" :search-from="0" :empty-label="L.allCategories" />
        <SingleSelect v-model="tag" :options="tagOptions" :empty-label="L.allTags" />
      </section>
    </FilterSheet>

    <div class="hidden @min-[935px]/card:grid grid-cols-[1fr_auto] items-center gap-2 [grid-template-areas:'chips_when'_'filters_file'] @min-[1187px]/card:grid-cols-[1fr_auto_auto] @min-[1187px]/card:[grid-template-areas:'chips_chips_chips'_'filters_when_file']">
      <div class="[grid-area:chips] flex flex-wrap items-center gap-2">
        <button v-for="l in LEVEL_CHIPS" :key="l.value" type="button" :aria-pressed="levelsOn.has(l.value)" :class="[FILTER_CHIP, levelsOn.has(l.value) ? FILTER_CHIP_ON : FILTER_CHIP_OFF]" @click="toggleLevel(l.value)">{{ l.label }}</button>
      </div>
      <div class="[grid-area:filters] flex items-center gap-2 min-w-0">
        <SingleSelect v-model="category" class="w-44 shrink-0" :options="categoryOptions" :search-from="0" :empty-label="L.allCategories" />
        <SingleSelect v-model="tag" class="w-44 shrink-0" :options="tagOptions" :empty-label="L.allTags" />
        <SearchInput v-model="term" :placeholder="T.search" :aria-label="T.search" :input-class="[SEARCH_FIELD, 'w-full']" :note="matchNote" class="flex-1 min-w-40 max-w-72" />
      </div>
      <DateTimePicker v-model="at" class="[grid-area:when] w-64 @min-[1187px]/card:w-56" :ranges="ranges" @go="jump" />
      <!-- 파일 칸 256px: 나올 수 있는 가장 넓은 시각 글("2000/04/04 AM 04:00:00 까지", 숫자 폭이 제각각인 글꼴에서 0 · 4 가 넓다)과 여백 · 꺾쇠가 들어간다 -->
      <SingleSelect v-model="file" class="[grid-area:file] w-64" :options="fileOptions" />
    </div>

    <!-- 줄 영역: 위 · 아래 끝에 닿으면 앞 · 뒤의 줄을 저절로 이어 붙인다(그동안 그 끝에 "불러오는 중"). 스크롤바는 실시간 로그와 같다 -->
    <div ref="pane" class="@container/log flex-1 min-h-0 overflow-y-auto rounded-(--r-inner) bg-(--log-pane) py-2 pl-3 [&::-webkit-scrollbar-track]:my-[calc(var(--r-inner)-5px)]" :class="overflowing ? 'pr-2.25' : 'pr-3'" @scroll="onScroll">
      <p v-if="!enabled" class="h-full flex items-center justify-center text-sm text-on-surface-variant">{{ T.off }}</p>
      <template v-else>
        <p v-if="loading === 'earlier'" class="py-1 text-center text-xs text-on-surface-variant">{{ T.loading }}</p>
        <!-- hit: 시각으로 갔을 때 그 시각의 줄. 잠깐 칠해 어디인지 보인다 -->
        <div v-for="entry in lines" :key="entry.offset" :data-offset="entry.offset" class="-mx-1.5 px-1.5 rounded-sm transition-colors duration-700 border-b border-outline-variant/20 last:border-b-0" :class="hit === entry.offset && 'bg-primary/20'">
          <LogLine :entry="entry" :time="stamp(entry.ts)" :query="searched" />
        </div>
        <p v-if="loading === 'later'" class="py-1 text-center text-xs text-on-surface-variant">{{ T.loading }}</p>
        <p v-if="!loading && lines.length === 0" class="h-full flex items-center justify-center text-sm text-on-surface-variant">{{ T.empty }}</p>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import axios from "axios";
import { useElementSize, useMediaQuery } from "@vueuse/core";
import PaneHeader from "./PaneHeader.vue";
import DateTimePicker from "./DateTimePicker.vue";
import FilterSheet from "./FilterSheet.vue";
import FilterButton from "./FilterButton.vue";
import BaseButton from "./BaseButton.vue";
import SingleSelect from "./SingleSelect.vue";
import SearchInput from "./SearchInput.vue";
import LogLine from "./LogLine.vue";
import Icon from "./BaseIcon.vue";
import { PHONE_QUERY } from "../utils/breakpoints.ts";
import { FILTER_CHIP, FILTER_CHIP_OFF, FILTER_CHIP_ON } from "../utils/filter-chip.ts";
import { SEARCH_FIELD } from "../utils/field.ts";
import { LEVEL_CHIPS, catColor } from "../utils/log-style.ts";
import { useOverflowing } from "../composables/overflowing.ts";
import { notifyProblem } from "../composables/toasts.ts";
import { problemCodeOf, replyOf } from "../utils/request.ts";
import type { Option, OptionValue } from "../utils/options.ts";
import type { LevelName } from "../../../src/infra/log/levels.ts";
import type { FileLine, FilePage, LogFile, LogFileList } from "../../../src/dashboard/contract/log-files.ts";
import { text } from "../text/index.ts";
const L = text.logs;
const T = text.logs.files;
const BASE = "/api/admin/logs";

/** initialAt: 이 시각으로 연다(실시간 로그의 "밀려났어요" 줄에서 왔을 때). 그 시각이 든 파일을 고른다 */
const props = defineProps<{ initialAt?: number }>();

// ── 거르기 ──
// 처음 켜 둘 레벨: trace 를 뺀 모두(지난 기록은 무엇이 있었는지 보러 온다)
const BASE_LEVELS: LevelName[] = ["fatal", "error", "warn", "info", "debug"];
const levelsOn = ref(new Set<LevelName>(BASE_LEVELS));
function toggleLevel(v: LevelName) {
  const next = new Set(levelsOn.value);
  if (!next.delete(v)) next.add(v);
  levelsOn.value = next;
}
const term = ref("");
// 카테고리 · 태그: 그 파일에 나온 것(파일 목록이 준다). "" 이면 거르지 않는다. 실시간 로그와 같은 모양(카테고리 앞에 줄의 점과 같은 색)
const category = ref<OptionValue>("");
const tag = ref<OptionValue>("");
const categoryOptions = computed<Option[]>(() => (current.value?.categories ?? []).map((c) => ({ value: c, label: c, color: catColor(c) })));
const tagOptions = computed<Option[]>(() => (current.value?.tags ?? []).map((t) => ({ value: t, label: `#${t}` })));
const filterParams = () => ({ levels: [...levelsOn.value].join(","), q: term.value, category: String(category.value), tag: String(tag.value) });

// ── 파일 ──
const enabled = ref(true);
const files = ref<LogFile[]>([]);
const file = ref<OptionValue>("");
const current = computed(() => files.value.find((f) => f.name === file.value));
const latest = () => files.value.find((f) => f.current) ?? files.value[0];
const fileOptions = computed<Option[]>(() => files.value.map((f) => ({ value: f.name, label: f.current ? T.latest : T.until(f.lastAt) })));
// 날짜 · 시간은 파일마다의 기간에서 고른다(로그가 없는 사이는 막힌다. 고른 시각이 든 파일로 저절로 바꿔 연다). 빈 파일은 빼고
const ranges = computed(() => files.value.filter((f) => f.lines).map((f): [number, number] => [f.firstAt, f.lastAt]));
// 시각이 든 파일: 그 기간 안이면 그 파일, 사이(파일을 떼어 낸 틈)면 그 뒤로 가장 먼저 끝난 파일
const fileAt = (ms: number) => files.value.find((f) => f.lines && f.firstAt <= ms && ms <= f.lastAt) ?? [...files.value].sort((a, b) => a.lastAt - b.lastAt).find((f) => f.lastAt >= ms) ?? latest();
async function loadFiles() {
  const list = (await axios.get<LogFileList>(`${BASE}/files`)).data;
  enabled.value = list.enabled;
  files.value = list.files;
}
// 내려받기: 지금 건 거르기 그대로, 시각은 이 화면의 시간대로
const downloadUrl = computed(() => `${BASE}/file/download?${new URLSearchParams({ name: String(file.value), ...filterParams(), tz: String(new Date().getTimezoneOffset()) })}`);

// ── 줄 ──
const lines = ref<FileLine[]>([]);
const more = ref(false);
const later = ref(false);
// 읽고 있는 파일의 첫 줄 시각: 이어 읽을 때 보내 떼어진 파일을 따라간다
let since = 0;
const loading = ref<"" | "page" | "earlier" | "later">("");
const matches = ref<number | null>(null);
const matchNote = computed(() => (matches.value == null ? "" : L.lines(matches.value)));
// 맞은 부분을 칠할 찾기: 받은 줄을 거른 찾기(입력 중인 찾기는 결과가 오기 전이라 쓰지 않는다)
const searched = ref("");
const pane = ref<HTMLElement | null>(null);
const overflowing = useOverflowing(pane);
const two = (n: number) => String(n).padStart(2, "0");
const stamp = (ms: number) => {
  const d = new Date(ms);
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

async function fetchPage(params: Record<string, string | number>, kind: "page" | "earlier" | "later"): Promise<FilePage | null> {
  loading.value = kind;
  try {
    const page = (await axios.get<FilePage>(`${BASE}/file`, { params: { name: file.value, ...filterParams(), ...params } })).data;
    since = page.since;
    // 보던 지금 파일이 떼어졌다: 떼어 낸 파일을 이어 읽었다. 목록을 새로 받아 그 파일을 고른 것으로
    if (page.name !== file.value) {
      skipWatch = true;
      file.value = page.name;
      void loadFiles();
    }
    return page;
  } catch (err) {
    // 파일이 사라졌다(보관 개수를 넘어 삭제): 목록을 새로 받는다
    if (problemCodeOf(replyOf(err)) === "log-file-not-found") void loadFiles();
    notifyProblem(err, T.loadFailed);
    return null;
  } finally {
    loading.value = "";
  }
}
const toEnd = () => void nextTick(() => pane.value && (pane.value.scrollTop = pane.value.scrollHeight));

const hit = ref<number | null>(null);
let hitTimer: number | undefined;
async function reload(params: Record<string, number> = {}) {
  if (!file.value) return;
  const q = term.value;
  const page = await fetchPage(params, "page");
  if (!page) return;
  searched.value = q;
  lines.value = page.lines;
  more.value = page.more;
  later.value = page.later;
  matches.value = page.matches ?? null;
  if (typeof params.at === "number") showTime(params.at);
  else toEnd();
}
// 시각으로 갔다: 그 시각 또는 바로 뒤의 첫 줄을 가운데로 가져오고 잠깐 칠한다
function showTime(ms: number) {
  const target = lines.value.find((l) => l.ts >= ms) ?? lines.value.at(-1);
  if (!target) return;
  hit.value = target.offset;
  clearTimeout(hitTimer);
  hitTimer = window.setTimeout(() => (hit.value = null), 2500);
  void nextTick(() => pane.value?.querySelector(`[data-offset="${target.offset}"]`)?.scrollIntoView({ block: "center" }));
}
// 위 끝: 앞의 줄을 앞에 붙이고, 보던 줄이 제자리에 있게 스크롤을 그만큼 내린다
async function loadEarlier() {
  const first = lines.value[0];
  if (!first || loading.value) return;
  const el = pane.value;
  const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
  const page = await fetchPage({ before: first.offset, since }, "earlier");
  if (!page) return;
  lines.value = [...page.lines, ...lines.value];
  more.value = page.more;
  await nextTick();
  if (el) el.scrollTop = el.scrollHeight - fromBottom;
}
// 아래 끝(시각으로 가서 파일 중간을 볼 때): 뒤의 줄을 이어 붙인다
async function loadLater() {
  const last = lines.value.at(-1);
  if (!last || loading.value) return;
  const page = await fetchPage({ after: last.offset, since }, "later");
  if (!page) return;
  lines.value = [...lines.value, ...page.lines];
  later.value = page.later;
}
function onScroll() {
  const el = pane.value;
  if (!el) return;
  if (el.scrollTop < 40 && more.value) void loadEarlier();
  else if (el.scrollHeight - el.scrollTop - el.clientHeight < 40 && later.value) void loadLater();
}

// ── 날짜 · 시간 ──
const at = ref<number | null>(null);
// 고른 시각 둘레로. null(초기화)이면 최신 파일의 끝에서부터
function jump(ms: number | null) {
  const target = ms == null ? latest() : fileAt(ms);
  if (target && target.name !== file.value) {
    skipWatch = true;
    file.value = target.name;
  }
  void reload(ms == null ? {} : { at: ms });
}

// 파일 · 거르기를 바꾸면 끝에서부터 다시. 날짜 · 시간으로 파일을 바꿀 때는 그쪽이 그 시각으로 읽으므로 한 번 건너뛴다
let skipWatch = false;
watch([file, levelsOn, category, tag], () => {
  if (skipWatch) return void (skipWatch = false);
  void reload();
});
let typing: number | undefined;
watch(term, () => {
  clearTimeout(typing);
  typing = window.setTimeout(() => void reload(), 300);
});

// ── 필터 창 ──
// 안의 거르기는 줄의 것과 같은 값을 바로 바꾼다. 필터 창이 맡은 것만 센다: 줄에서 빠진 날짜 · 시간(카드 804 이하) · 파일(524 이하). 휴대폰은 둘 다 창 안에 있다
const sheetOpen = ref(false);
const isPhone = useMediaQuery(PHONE_QUERY);
const card = ref<HTMLElement | null>(null);
const { width: cardWidth } = useElementSize(card);
const dateInside = computed(() => isPhone.value || cardWidth.value <= 804);
const fileInside = computed(() => isPhone.value || cardWidth.value <= 524);
const sameLevels = () => levelsOn.value.size === BASE_LEVELS.length && BASE_LEVELS.every((l) => levelsOn.value.has(l));
const activeFilters = computed(() => Number(!sameLevels()) + Number(Boolean(category.value)) + Number(Boolean(tag.value)) + (fileInside.value ? Number(file.value !== latest()?.name) : 0) + (dateInside.value ? Number(at.value != null) : 0));
// 초기화: 기본 레벨 · 모든 카테고리 · 모든 태그, 창 안에 있으면 최신 파일 · 파일 끝으로
function resetFilters() {
  levelsOn.value = new Set(BASE_LEVELS);
  category.value = "";
  tag.value = "";
  if (fileInside.value) file.value = latest()?.name ?? "";
  if (!dateInside.value) return;
  // 시각으로 옮겨 가 있었으면 파일 끝으로 돌아온다(파일 · 레벨이 그대로면 다시 읽기가 걸리지 않는다)
  if (at.value != null) jump(null);
  at.value = null;
}

onMounted(async () => {
  try {
    await loadFiles();
  } catch (err) {
    notifyProblem(err, T.loadFailed);
    return;
  }
  const startAt = props.initialAt;
  const start = startAt == null ? latest() : fileAt(startAt);
  if (!start) return;
  skipWatch = true;
  file.value = start.name;
  if (startAt != null) at.value = startAt;
  await reload(startAt == null ? {} : { at: startAt });
});
</script>
