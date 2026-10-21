<template>
  <!-- 실시간 로그 탭. 창은 바탕화면 아래 끝까지 채우고(재생 바는 그 위에 겹친다. 바깥 아래 여백의 재생 바 몫은 음수 여백으로 돌려줘 페이지가 스크롤되지 않게),
       로그 영역이 남는 높이를 다 쓰고 그 안에서만 스크롤된다. 아래 여백은 창 여백 + (재생 바 - 바깥 틈): 창 아래 끝이 바탕화면 끝에서 바깥 틈만큼 위라, 로그 영역이 재생 바 위 끝에서 창 여백만큼 떨어진다.
       휴대폰도 같다(위에 있던 탭 줄이 위 막대로 갔다) -->
  <section class="pane rounded-(--r-window) p-(--pad-window) pb-[calc(var(--pad-window)+max(0px,var(--player)-var(--gap-out)))] -mb-(--player) flex flex-col gap-3 h-[calc(var(--desk-h)-var(--gap-out)*2)]">
    <PaneHeader icon="article" :title="T.title">
      <template #actions>
        <span class="flex items-center gap-1 text-xs text-on-surface-variant"
          ><span class="size-2 rounded-full" :class="connected ? 'bg-(--ok-ink)' : 'bg-outline'"></span>{{ connected ? T.connected : T.disconnected }} · <span class="nums text-on-surface">{{ T.lines(lineCount) }}</span></span
        >
      </template>
    </PaneHeader>

    <!-- 필터: 레벨은 여럿 켜기(심각한 것부터). 카테고리 · 태그는 흘러온 로그에서 본 것만 드롭다운으로(종류가 늘어나는 목록이라 칩 대신, 많으면 검색창). 오른쪽 끝에 자동 스크롤(켜 두면 새 줄을 따라 내려간다) · 지우기 -->
    <div class="flex flex-wrap items-center gap-2">
      <button v-for="l in LEVEL_CHIPS" :key="l.value" type="button" :aria-pressed="levelsOn.has(l.value)" :class="[FILTER_CHIP, levelsOn.has(l.value) ? FILTER_CHIP_ON : FILTER_CHIP_OFF]" @click="toggleLevel(l.value)">{{ l.label }}</button>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <!-- 휴대폰은 드롭다운 둘이 한 줄을 나눠 쓰고 자동 스크롤 · 지우기는 다음 줄 오른쪽 -->
      <div class="flex gap-2 w-full sm:w-auto">
        <SingleSelect v-model="category" class="flex-1 min-w-0 sm:flex-none sm:w-44" :options="categoryOptions" :search-from="0" :empty-label="T.allCategories" />
        <SingleSelect v-model="tag" class="flex-1 min-w-0 sm:flex-none sm:w-44" :options="tagOptions" :empty-label="T.allTags" />
      </div>
      <!-- 글자 찾기: 받아 둔 줄의 글 · 카테고리 · 태그에서(한국어 찾기) -->
      <SearchInput v-model="term" :placeholder="T.search" :aria-label="T.search" :input-class="[SEARCH_FIELD, 'w-full']" class="w-full sm:w-auto sm:flex-1 sm:min-w-40 sm:max-w-72" />
      <span class="ml-auto flex items-center gap-2">
        <label class="flex items-center gap-2 text-sm text-on-surface-variant cursor-pointer select-none">{{ T.autoScroll }}<BaseSwitch :model-value="follow" :label="T.autoScroll" @update:model-value="setFollow" /></label>
        <BaseButton variant="ghost" size="sm" @click="emit('clear')"><Icon name="delete_sweep" :size="18" />{{ T.clear }}</BaseButton>
      </span>
    </div>

    <!-- 로그 영역. 넓으면 한 줄(시각 · 레벨 · 카테고리 · 글), 좁으면 시각 · 레벨 · 카테고리를 윗줄에 두고 글은 아랫줄. 글은 낱말 단위로 끊는다.
         바탕은 드롭다운 목록과 겹치지 않는 면(--log-pane, 밝기마다 따로). 넘치면 오른쪽 안쪽 여백을 3 줄여 스크롤바와 글 사이가 왼쪽 여백과 같게(useOverflowing), 둥근 모서리 끝은 스크롤바 트랙을 비운다 -->
    <div ref="pane" class="@container/log flex-1 min-h-0 overflow-y-auto [overflow-anchor:none] rounded-(--r-inner) bg-(--log-pane) py-2 pl-3 [&::-webkit-scrollbar-track]:my-[calc(var(--r-inner)-5px)]" :class="overflowing ? 'pr-2.25' : 'pr-3'" @scroll="onScroll">
      <p v-if="shown.length === 0" class="h-full flex items-center justify-center text-sm text-on-surface-variant">{{ logs.length ? text.common.noMatch : T.empty }}</p>
      <!-- 줄은 한 번 그리면 바뀌지 않는다(v-memo: 탭을 옮기거나 새 줄이 와도 다시 비교하지 않는다). 화면 밖 줄은 그리기를 건너뛴다(content-visibility, 높이는 한 줄 25px 로 짐작하고 그린 뒤로는 그 높이) -->
      <div v-for="entry in shown" :key="entry.key" v-memo="[entry.key]" class="[content-visibility:auto] [contain-intrinsic-size:auto_25px] border-b border-outline-variant/20 last:border-b-0">
        <!-- 표시 줄: 받지 못한 줄 · 봇 재시작. 필터와 상관없이 늘 보인다 -->
        <div v-if="entry.mark" class="flex items-center gap-2 py-1 text-xs text-on-surface-variant">
          <span class="flex-1 border-t border-dashed border-outline-variant"></span>
          <Icon :name="entry.mark === 'gap' ? 'sync_problem' : 'restart_alt'" :size="16" />
          <span class="min-w-0 text-center">{{ entry.mark === "gap" ? T.missed(entry.missed, KEPT_LINES) : T.restarted }}</span>
          <span class="flex-1 border-t border-dashed border-outline-variant"></span>
        </div>
        <div v-else class="flex flex-col @2xl/log:flex-row @2xl/log:items-baseline gap-x-3 py-0.5 text-xs leading-5">
          <span class="flex items-baseline gap-3 shrink-0">
            <span class="font-mono nums text-on-surface-variant">{{ clock(entry.ts) }}</span>
            <span class="w-[5ch] font-mono font-semibold" :class="LEVEL_TONE[entry.level]">{{ entry.level.toUpperCase() }}</span>
            <span v-if="entry.category || entry.sub" class="flex items-center gap-1 text-on-surface-variant"><span class="size-2 rounded-full" :style="{ backgroundColor: catColor(entry.category || entry.sub || '') }"></span>{{ [entry.category, entry.sub].filter(Boolean).join("/") }}</span>
            <span v-for="t in entry.tags" :key="t" class="text-on-surface-variant">#{{ t }}</span>
          </span>
          <span class="min-w-0 wrap-break-word whitespace-pre-wrap" :class="TEXT_TONE[entry.level]">{{ entry.text }}</span>
        </div>
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
import Icon from "./BaseIcon.vue";
import { useOverflowing } from "../composables/overflowing.ts";
import { FILTER_CHIP, FILTER_CHIP_OFF, FILTER_CHIP_ON } from "../utils/filter-chip.ts";
import { SEARCH_FIELD } from "../utils/field.ts";
import { koMatch } from "../../../src/rules/ko-search.ts";
import type { Option, OptionValue } from "../utils/options.ts";
import { KEPT_LINES, LEVELS, isLevel, type LevelName, type WireEntry } from "../../../src/infra/log/levels.ts";
import type { LogRow } from "../utils/log-rows.ts";
import { formatClock } from "../utils/locale.ts";
import { text } from "../text/index.ts";
const T = text.logs;

/** active: 이 탭이 보이는가(숨어 있는 동안은 스크롤할 수 없어 돌아왔을 때 맨 아래로 맞춘다). serverLevel: 봇의 LOG_LEVEL(처음 켜 둘 레벨) */
const props = defineProps<{ logs: LogRow[]; connected: boolean; serverLevel?: string; active: boolean }>();
const emit = defineEmits<{ clear: [] }>();

// ── 레벨 ──
// 레벨 필터는 여럿 켜기다. 봇은 지금 trace 를 남기지 않지만 LOG_LEVEL=trace 로 둘 수 있어 칩을 둔다
const LEVEL_CHIPS: Array<{ value: LevelName; label: string }> = [
  { value: "fatal", label: "FATAL" },
  { value: "error", label: "ERROR" },
  { value: "warn", label: "WARN" },
  { value: "info", label: "INFO" },
  { value: "debug", label: "DEBUG" },
  { value: "trace", label: "TRACE" },
];
// 레벨 색은 테마와 상관없이 고정(style.css --log-*). 이름은 레벨 색, 글은 trace · debug 는 흐리게(같은 색), info · warn 은 보통 글자색, error · fatal 은 레벨 색
const LEVEL_TONE: Record<LevelName, string> = { trace: "text-(--log-trace)", debug: "text-(--log-debug)", info: "text-(--log-info)", warn: "text-(--log-warn)", error: "text-(--log-error)", fatal: "text-(--log-fatal)" };
const TEXT_TONE: Record<LevelName, string> = { trace: "text-(--log-trace)", debug: "text-(--log-debug)", info: "text-on-surface", warn: "text-on-surface", error: "text-(--log-error)", fatal: "text-(--log-fatal) font-semibold" };

// 처음 켜 둘 레벨은 봇의 LOG_LEVEL 이상. 봇이 debug 를 안 보내면 그 칩은 꺼진 채로 시작한다(켜면 그때부터 오는 것이 보인다). 선택한 것은 기억하지 않는다
const levelsOn = ref(new Set<LevelName>(["info", "warn", "error", "fatal"]));
let levelsSeeded = false;
watch(
  () => props.serverLevel,
  (level) => {
    if (levelsSeeded || !level) return;
    levelsSeeded = true;
    const min = isLevel(level) ? LEVELS[level] : LEVELS.info;
    levelsOn.value = new Set(LEVEL_CHIPS.filter((l) => LEVELS[l.value] >= min).map((l) => l.value));
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
// 카테고리 색: 이름에서 정한 고정 색(style.css --log-cat-1..8, 밝기마다 따로). 이름 글이 같이 있어 색은 보조다
const catColor = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `var(--log-cat-${(h % 8) + 1})`;
};

// 글자 찾기: 글 · 카테고리 · 태그(한국어는 조합 중인 글자 · 초성으로도)
const term = ref("");
const matchesTerm = (e: WireEntry) => !term.value.trim() || [e.text, e.category ?? "", e.sub ?? "", ...(e.tags ?? [])].some((one) => koMatch(one, term.value));
const shown = computed(() => props.logs.filter((e) => e.mark || (levelsOn.value.has(e.level) && (!category.value || e.category === category.value) && (!tag.value || (e.tags ?? []).includes(String(tag.value))) && matchesTerm(e))));
// 머리에 적는 줄 수(표시 줄 빼고)
const lineCount = computed(() => shown.value.filter((e) => !e.mark).length);

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
