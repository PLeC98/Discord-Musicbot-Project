<template>
  <!-- 실시간 로그 탭. 창은 바탕화면 아래 끝까지 채우고(재생 바는 그 위에 겹친다. 바깥 아래 여백의 재생 바 몫은 음수 여백으로 돌려줘 페이지가 스크롤되지 않게),
       로그 영역이 남는 높이를 다 쓰고 그 안에서만 스크롤된다. 아래 여백은 창 여백 + (재생 바 - 바깥 틈): 창 아래 끝이 바탕화면 끝에서 바깥 틈만큼 위라, 로그 영역이 재생 바 위 끝에서 창 여백만큼 떨어진다.
       휴대폰도 같다(위에 있던 탭 줄이 위 막대로 갔다) -->
  <section class="@container/card pane rounded-(--r-window) p-(--pad-window) pb-[calc(var(--pad-window)+max(0px,var(--player)-var(--gap-out)))] -mb-(--player) flex flex-col gap-3 h-[calc(var(--desk-h)-var(--gap-out)*2)]">
    <PaneHeader icon="article" :title="T.title">
      <!-- 제목 바로 옆에 연결 상태 · 줄 수. 연결되어 있으면 초록 점과 줄 수만, 끊기면 회색 점 · "끊김" · 줄 수. 점은 툴팁으로 상태를 말한다.
           줄 수는 필터 · 찾기와 상관없이 들고 있는 줄 전부(찾은 수는 찾기 칸 안에) -->
      <template #badge>
        <span class="flex items-center gap-1.5 text-xs text-on-surface-variant shrink-0"
          ><span class="size-2 rounded-full" :class="connected ? 'bg-(--ok-ink)' : 'bg-outline'" :aria-label="connected ? T.connected : T.disconnected" v-tooltip="connected ? T.connected : T.disconnected"></span><template v-if="!connected">{{ T.disconnected }} ·</template> <span class="nums text-on-surface">{{ T.lines(lineCount) }}</span></span
        >
      </template>
      <template #actions>
        <!-- 지난 기록: 로그 파일 보기 페이지를 같은 창에서. 진짜 링크라 우클릭 · Ctrl · 가운데 클릭으로 새 탭 · 새 창 -->
        <router-link v-slot="{ href, navigate }" to="/admin/log-files" custom>
          <BaseButton variant="secondary" size="sm" class="gap-0!" :href="href" @click="navigate">{{ T.openFiles }}<Icon name="chevron_right" :size="18" class="-mr-1.5" /></BaseButton>
        </router-link>
      </template>
    </PaneHeader>

    <!-- 필터: 레벨은 여럿 켜기(심각한 것부터). 카테고리 · 태그는 흘러온 로그에서 본 것만 드롭다운으로(종류가 늘어나는 목록이라 칩 대신, 많으면 검색창). 오른쪽 끝에 자동 스크롤(켜 두면 새 줄을 따라 내려간다) · 지우기 -->
    <!-- 카드 안쪽 587 이하(휴대폰 · 운영자 화면에서 사이드바를 접은 화면 795 이하): 첫 줄은 필터 버튼 · 자동 스크롤, 둘째 줄은 찾기.
         레벨 · 카테고리 · 태그 · 지우기는 필터 창에(고르는 대로 반영. 휴대폰은 바텀 시트, 그 밖은 가운데 팝업) -->
    <div class="flex @min-[588px]/card:hidden items-center gap-2">
      <FilterButton :count="activeFilters" @open="openSheet" />
      <label class="ml-auto flex items-center gap-2 text-sm text-on-surface-variant cursor-pointer select-none">{{ T.autoScroll }}<BaseSwitch :model-value="follow" :label="T.autoScroll" @update:model-value="setFollow" /></label>
    </div>
    <SearchInput v-model="term" :placeholder="T.search" :aria-label="T.search" :input-class="[SEARCH_FIELD, 'w-full']" :note="matchNote" class="@min-[588px]/card:hidden w-full" />
    <FilterSheet :open="sheetOpen" @close="sheetOpen = false" @reset="resetFilters">
      <section class="flex flex-col gap-2">
        <h3 class="text-label font-semibold text-primary">{{ T.filterLevels }}</h3>
        <div class="flex flex-wrap gap-2">
          <button v-for="l in LEVEL_CHIPS" :key="l.value" type="button" :aria-pressed="levelsOn.has(l.value)" :class="[FILTER_CHIP, levelsOn.has(l.value) ? FILTER_CHIP_ON : FILTER_CHIP_OFF]" @click="toggleLevel(l.value)">{{ l.label }}</button>
        </div>
      </section>
      <section class="flex flex-col gap-2">
        <h3 class="text-label font-semibold text-primary">{{ T.filterCategories }}</h3>
        <SingleSelect v-model="category" :options="categoryOptions" :search-from="0" :empty-label="T.allCategories" />
        <SingleSelect v-model="tag" :options="tagOptions" :empty-label="T.allTags" />
      </section>
      <section class="flex flex-col gap-2">
        <h3 class="text-label font-semibold text-primary">{{ T.filterView }}</h3>
        <BaseButton variant="ghost" size="sm" class="self-start" @click="clearNow"><Icon name="delete_sweep" :size="18" />{{ T.clear }}</BaseButton>
      </section>
    </FilterSheet>

    <!-- 카드 안쪽 588 이상: 칸 이름이 붙은 격자(같은 버튼을 두 번 그리지 않게 칸 자리만 바꾼다). 안쪽 폭 = 운영자 화면에서 사이드바를 접으면 화면 - 208.
         588 ~ 742(화면 796 ~ 950): 레벨 · 자동 스크롤 · 지우기 / 카테고리 · 태그 · 찾기(남은 폭).
         743 이상(화면 951 이상): 레벨 / 카테고리 · 태그 · 찾기(288 까지) · 오른쪽 끝 자동 스크롤 · 지우기 -->
    <div class="hidden @min-[588px]/card:grid grid-cols-[1fr_auto] items-center gap-2 [grid-template-areas:'chips_actions'_'filters_filters'] @min-[743px]/card:[grid-template-areas:'chips_chips'_'filters_actions']">
      <div class="[grid-area:chips] flex flex-wrap items-center gap-2">
        <button v-for="l in LEVEL_CHIPS" :key="l.value" type="button" :aria-pressed="levelsOn.has(l.value)" :class="[FILTER_CHIP, levelsOn.has(l.value) ? FILTER_CHIP_ON : FILTER_CHIP_OFF]" @click="toggleLevel(l.value)">{{ l.label }}</button>
      </div>
      <div class="[grid-area:filters] flex items-center gap-2 min-w-0">
        <SingleSelect v-model="category" class="w-44 shrink-0" :options="categoryOptions" :search-from="0" :empty-label="T.allCategories" />
        <SingleSelect v-model="tag" class="w-44 shrink-0" :options="tagOptions" :empty-label="T.allTags" />
        <!-- 글자 찾기: 받아 둔 줄의 글 · 카테고리 · 태그에서(한국어 찾기). 넓으면 288 까지, 그 밖은 남은 폭을 다 -->
        <SearchInput v-model="term" :placeholder="T.search" :aria-label="T.search" :input-class="[SEARCH_FIELD, 'w-full']" :note="matchNote" class="flex-1 min-w-40 @min-[743px]/card:max-w-72" />
      </div>
      <span class="[grid-area:actions] justify-self-end flex items-center gap-2">
        <label class="flex items-center gap-2 text-sm text-on-surface-variant cursor-pointer select-none">{{ T.autoScroll }}<BaseSwitch :model-value="follow" :label="T.autoScroll" @update:model-value="setFollow" /></label>
        <BaseButton variant="ghost" size="sm" @click="emit('clear')"><Icon name="delete_sweep" :size="18" />{{ T.clear }}</BaseButton>
      </span>
    </div>

    <!-- 로그 영역. 넓으면 한 줄(시각 · 레벨 · 카테고리 · 글), 좁으면 시각 · 레벨 · 카테고리를 윗줄에 두고 글은 아랫줄. 글은 낱말 단위로 끊는다.
         바탕은 드롭다운 목록과 겹치지 않는 면(--log-pane, 밝기마다 따로). 넘치면 오른쪽 안쪽 여백을 3 줄여 스크롤바와 글 사이가 왼쪽 여백과 같게(useOverflowing), 둥근 모서리 끝은 스크롤바 트랙을 비운다 -->
    <div ref="pane" class="@container/log flex-1 min-h-0 overflow-y-auto [overflow-anchor:none] rounded-(--r-inner) bg-(--log-pane) py-2 pl-3 [&::-webkit-scrollbar-track]:my-[calc(var(--r-inner)-5px)]" :class="overflowing ? 'pr-2.25' : 'pr-3'" @scroll="onScroll">
      <p v-if="shown.length === 0" class="h-full flex items-center justify-center text-sm text-on-surface-variant">{{ logs.length ? text.common.noMatch : T.empty }}</p>
      <!-- 줄은 한 번 그리면 찾기를 바꿀 때까지 바뀌지 않는다(v-memo: 탭을 옮기거나 새 줄이 와도 다시 비교하지 않는다. 찾기가 바뀌면 맞은 부분을 다시 칠한다). 화면 밖 줄은 그리기를 건너뛴다(content-visibility, 높이는 한 줄 25px 로 짐작하고 그린 뒤로는 그 높이) -->
      <div v-for="entry in shown" :key="entry.key" v-memo="[entry.key, term]" class="[content-visibility:auto] [contain-intrinsic-size:auto_25px] border-b border-outline-variant/20 last:border-b-0">
        <!-- 표시 줄: 받지 못한 줄 · 봇 재시작. 필터와 상관없이 늘 보인다 -->
        <div v-if="entry.mark" class="flex items-center gap-2 py-1 text-xs text-on-surface-variant">
          <span class="flex-1 border-t border-dashed border-outline-variant"></span>
          <Icon :name="entry.mark === 'gap' ? 'sync_problem' : 'restart_alt'" :size="16" />
          <span class="min-w-0 text-center">{{ entry.mark === "gap" ? T.missed(entry.missed) : T.restarted }}</span>
          <!-- 밀려난 줄은 로그 파일에 있다: 바로 앞에 받은 줄의 시각으로 파일 보기를 연다(같은 창, 우클릭 · Ctrl 클릭으로 새 탭) -->
          <router-link v-if="entry.mark === 'gap' && gapFrom(entry.key)" :to="{ path: '/admin/log-files', query: { at: gapFrom(entry.key) } }" class="shrink-0 inline-flex items-center text-primary font-semibold no-underline hover:underline">{{ T.gapToFile }}<Icon name="chevron_right" :size="16" class="-mr-1" /></router-link>
          <span class="flex-1 border-t border-dashed border-outline-variant"></span>
        </div>
        <LogLine v-else :entry="entry" :time="clock(entry.ts)" :query="term" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import BaseButton from "./BaseButton.vue";
import BaseSwitch from "./BaseSwitch.vue";
import PaneHeader from "./PaneHeader.vue";
import SingleSelect from "./SingleSelect.vue";
import SearchInput from "./SearchInput.vue";
import LogLine from "./LogLine.vue";
import FilterSheet from "./FilterSheet.vue";
import FilterButton from "./FilterButton.vue";
import Icon from "./BaseIcon.vue";
import { useOverflowing } from "../composables/overflowing.ts";
import { FILTER_CHIP, FILTER_CHIP_OFF, FILTER_CHIP_ON } from "../utils/filter-chip.ts";
import { SEARCH_FIELD } from "../utils/field.ts";
import { matchesLog } from "../../../src/dashboard/contract/log-files.ts";
import { LEVEL_CHIPS, catColor } from "../utils/log-style.ts";
import type { Option, OptionValue } from "../utils/options.ts";
import { LEVELS, isLevel, type LevelName, type WireEntry } from "../../../src/infra/log/levels.ts";
import type { LogRow } from "../utils/log-rows.ts";
import { formatClock } from "../utils/locale.ts";
import { text } from "../text/index.ts";
const T = text.logs;

/** active: 이 탭이 보이는가(숨어 있는 동안은 스크롤할 수 없어 돌아왔을 때 맨 아래로 맞춘다). serverLevel: 봇의 LOG_LEVEL(처음 켜 둘 레벨) */
const props = defineProps<{ logs: LogRow[]; connected: boolean; serverLevel?: string; active: boolean }>();
const emit = defineEmits<{ clear: [] }>();

// ── 레벨 ──

// 처음 켜 둘 레벨은 봇의 LOG_LEVEL 이상. 봇이 debug 를 안 보내면 그 칩은 꺼진 채로 시작한다(켜면 그때부터 오는 것이 보인다). 선택한 것은 기억하지 않는다
const levelsOn = ref(new Set<LevelName>(["info", "warn", "error", "fatal"]));
// 처음 켠 레벨(필터 시트의 초기화 · 바꾼 필터 수의 기준)
const baseLevels = ref(new Set<LevelName>(["info", "warn", "error", "fatal"]));
let levelsSeeded = false;
watch(
  () => props.serverLevel,
  (level) => {
    if (levelsSeeded || !level) return;
    levelsSeeded = true;
    const min = isLevel(level) ? LEVELS[level] : LEVELS.info;
    levelsOn.value = new Set(LEVEL_CHIPS.filter((l) => LEVELS[l.value] >= min).map((l) => l.value));
    baseLevels.value = new Set(levelsOn.value);
  },
  { immediate: true },
);
function toggleLevel(v: LevelName) {
  const next = new Set(levelsOn.value);
  if (!next.delete(v)) next.add(v);
  levelsOn.value = next;
}

// ── 카테고리 · 태그 ──
// 받은 줄만(표시 줄 빼고)
const lines = computed(() => props.logs.filter((e): e is LogRow & WireEntry => !e.mark));
const categories = computed(() => [...new Set(lines.value.flatMap((e) => (e.category ? [e.category] : [])))].sort());
const tags = computed(() => [...new Set(lines.value.flatMap((e) => e.tags ?? []))].sort());
// 드롭다운의 값. "" 이면 필터링하지 않는다
const category = ref<OptionValue>("");
const tag = ref<OptionValue>("");
// 카테고리는 늘 검색창이 있고, 선택지 앞에 줄의 점과 같은 색
const categoryOptions = computed<Option[]>(() => categories.value.map((c) => ({ value: c, label: c, color: catColor(c) })));
const tagOptions = computed<Option[]>(() => tags.value.map((t) => ({ value: t, label: `#${t}` })));

// 필터 · 글자 찾기(글 · 카테고리 · 태그, 한국어는 조합 중인 글자 · 초성으로도). 로그 파일 보기와 같은 규칙
const term = ref("");
const shown = computed(() => {
  const filter = { levels: levelsOn.value, category: String(category.value), tag: String(tag.value), q: term.value };
  return props.logs.filter((e) => e.mark || matchesLog(e, filter));
});
// 찾기 칸 안의 찾은 줄 수: 필터를 모두 건 채 지금 들고 있는 줄에서(끊김 · 재시작 표시는 빼고)
const matchNote = computed(() => (term.value.trim() ? T.lines(shown.value.filter((e) => !e.mark).length) : ""));
// 헤더의 줄 수: 필터 · 찾기와 상관없이 지금 들고 있는 줄 전부(표시 줄 빼고, 찾은 수는 찾기 칸 안에)
const lineCount = computed(() => props.logs.filter((e) => !e.mark).length);

// 봇 상태 탭과 같은 24시간 시각
const clock = (ms: number) => formatClock(ms, { seconds: true });

// ── 따라가기 ──
// 맨 아래에 있으면 새 줄을 따라 내려가고, 위로 스크롤하면 멈춘다. 따라가기를 켜면 맨 아래로
const pane = ref<HTMLElement | null>(null);
const overflowing = useOverflowing(pane);
const follow = ref(true);
// 내린 뒤 화면 밖이던 줄이 그려지며 높이가 바뀔 수 있어 한 프레임 뒤에 한 번 더 내린다. 위쪽 줄의 높이가 바뀌어도 브라우저가 스크롤을 옮기지 않는다(overflow-anchor: none)
const toBottom = () => {
  if (pane.value) pane.value.scrollTop = pane.value.scrollHeight;
};
const toEnd = () =>
  void nextTick(() => {
    toBottom();
    requestAnimationFrame(() => follow.value && toBottom());
  });
function onScroll() {
  const el = pane.value;
  if (el) follow.value = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
}
function setFollow(on: boolean) {
  follow.value = on;
  if (on) toEnd();
}

// ── 필터 창(좁은 화면) ──
// 안의 필터는 PC 와 같은 값을 바로 바꾼다. 초기화는 처음 켠 레벨 · 모든 카테고리 · 모든 태그로
const sheetOpen = ref(false);
const sameSet = (a: Set<LevelName>, b: Set<LevelName>) => a.size === b.size && [...a].every((x) => b.has(x));
// 바꾼 필터 수(레벨 · 카테고리 · 태그). 필터 버튼의 배지
const activeFilters = computed(() => Number(!sameSet(levelsOn.value, baseLevels.value)) + Number(Boolean(category.value)) + Number(Boolean(tag.value)));
const openSheet = () => (sheetOpen.value = true);

// 밀려난 줄 표시의 시각: 그 표시 바로 앞에 받은 줄의 시각(빠진 줄은 그 뒤부터다). 앞에 받은 줄이 없으면 없음
function gapFrom(key: string) {
  const at = props.logs.findIndex((e) => e.key === key);
  for (let i = at - 1; i >= 0; i--) {
    const row = props.logs[i];
    if (!row.mark) return row.ts;
  }
  return null;
}
function resetFilters() {
  levelsOn.value = new Set(baseLevels.value);
  category.value = "";
  tag.value = "";
}
function clearNow() {
  emit("clear");
  sheetOpen.value = false;
}
// 줄 수가 아니라 마지막 줄을 본다(상한에 닿으면 앞을 잘라 수가 그대로다)
watch(
  () => shown.value.at(-1)?.key,
  () => follow.value && toEnd(),
);
// 숨어 있는 동안(display:none)은 scrollTop 이 먹지 않는다. 돌아오면 맞춘다
watch(
  () => props.active,
  (on) => on && follow.value && toEnd(),
);
</script>
