<template>
  <div ref="root" class="relative">
    <button ref="anchor" type="button" :class="boxCls" :aria-expanded="open" :disabled="disabled" @click="open = !open">
      <span class="min-w-0 flex items-center gap-2" :class="muted ? 'text-on-surface-variant' : 'text-on-surface'"
        ><span v-if="summaryColor" class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: summaryColor }"></span><span class="truncate">{{ summary }}</span></span
      >
      <svg class="shrink-0 text-on-surface-variant transition-transform duration-200" :class="open && 'rotate-180'" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
    </button>

    <Teleport to="body">
      <div v-if="open" ref="panel" :class="panelCls" :style="style">
        <div v-if="searchable" class="shrink-0 p-1 border-b border-outline-variant/50">
          <SearchInput ref="box" v-model="term" type="text" :placeholder="text.fields.searchAmong(count)" :input-class="searchCls" @escape="onSearchEscape" />
        </div>
        <!-- 스크롤바 트랙은 둥근 모서리가 있는 끝만 막대에 닿는 만큼 비운다(--sb-inset-menu). 검색창 아래 위쪽 끝은 곧은 선이라 비우지 않는다 -->
        <!-- 넘치면 오른쪽 안쪽 여백을 4 - 3 = 1 로(useOverflowing) -->
        <div ref="listEl" class="min-h-0 overflow-auto flex flex-col [&::-webkit-scrollbar-track]:mb-(--sb-inset-menu) [&>button]:rounded-xs [&>button:first-of-type]:rounded-t-md [&>button:last-of-type]:rounded-b-md" :class="[overflowing ? 'py-1 pl-1 pr-px' : 'p-1', !searchable && '[&::-webkit-scrollbar-track]:mt-(--sb-inset-menu)']" :style="{ maxHeight: `${LIST_MAX_REM}rem` }">
          <slot />
          <p v-if="empty" class="px-4 py-3 text-xs text-on-surface-variant">{{ text.common.noMatch }}</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
// 드롭다운의 겉: 누르는 버튼 · body 로 내보낸 목록 · 검색창. 단일 선택(SingleSelect)과 다중 선택(MultiSelect)이 같이 쓴다.
// 목록의 항목은 쓰는 쪽이 넣는다(slot). 검색어(term)로 필터링하는 것도 쓰는 쪽이 한다(utils/options)
import { computed, ref, nextTick, onBeforeUnmount, watch } from "vue";
import { useAnchoredPanel } from "../composables/anchored-panel.ts";
import { useOverflowing } from "../composables/overflowing.ts";
import { rem } from "../utils/rem.ts";
import SearchInput from "./SearchInput.vue";
import { text } from "../text/index.ts";

const props = defineProps<{
  /** 닫혀 있을 때 버튼에 보일 글 */
  summary: string;
  /** 있으면 닫혀 있을 때 글 앞에 그 색 점(선택한 선택지의 color) */
  summaryColor?: string;
  /** 선택한 것이 없다(흐리게 보인다) */
  muted: boolean;
  /** 선택지의 수(검색창 안내) */
  count: number;
  /** 검색창을 표시하는지 */
  searchable: boolean;
  /** 필터링된 것이 없다 */
  empty: boolean;
  /** 고칠 수 없다(누르는 버튼을 막는다) */
  disabled?: boolean;
  /** 목록이 보일 항목 수(넘으면 스크롤된다). 기본 6.5. 그룹 이름이 있는 짧은 메뉴(필터)는 다 보이게 늘린다 */
  rows?: number;
  /** 작은 버튼(높이 32, 아이콘 버튼이 늘어선 도구 줄) */
  small?: boolean;
}>();
const open = defineModel<boolean>("open", { default: false });
const term = defineModel<string>("term", { default: "" });

const boxBase = "w-full flex items-center justify-between gap-2 bg-surface-container-highest border border-transparent rounded-(--r-inner) text-on-surface font-[inherit] text-left cursor-pointer outline-none transition-[border-color] duration-150 focus-visible:border-primary disabled:opacity-38 disabled:cursor-not-allowed";
const boxCls = computed(() => `${boxBase} ${props.small ? "h-8 pl-3 pr-2 text-xs" : "h-10 pl-4 pr-3 text-sm"}`);
// M3E 세로 메뉴(Compose SegmentedMenuTokens · StandardMenuTokens): 바탕 surface-container-low · 그림자 2단 · 모서리 16 · 안쪽 여백 4.
// 항목은 높이 44 · 좌우 16, 항목 사이 틈 없음(틈은 그룹 사이에만 두고 스크롤되는 메뉴에는 두지 않는다), 모서리 4 에 첫 항목 위 · 마지막 항목 아래만 12(쓰는 쪽의 항목은 button), 선택한 항목은 12 · tertiary-container
const panelCls = "pane-menu bg-surface-container-low! flex flex-col overflow-hidden rounded-lg";
const searchCls = "w-full bg-surface-container-highest border border-transparent rounded-(--r-inner) text-on-surface h-10 px-4 text-sm font-[inherit] outline-none transition-[border-color] duration-150 focus:border-primary placeholder:text-on-surface-variant";

const root = ref<HTMLElement | null>(null);
const anchor = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const box = ref<InstanceType<typeof SearchInput> | null>(null);
/** 검색어가 빈 채로 Esc: 목록을 닫는다(검색어가 있으면 SearchInput 이 비운다). 둘레의 창까지 닫지 않게 멈춘다 */
function onSearchEscape(event: KeyboardEvent) {
  event.stopPropagation();
  open.value = false;
}

// 항목 높이는 M3E 세로 메뉴(44)에서 한 단계 촘촘하게(density -1, 40 = 2.5rem). 목록은 6.5개까지 보인다(마지막 항목이 반쯤 걸려 스크롤된다는 것이 보인다).
// 패널은 검색창 몫까지 더해 잡고, 화면 남는 공간이 모자라면 목록이 줄어든다. 항목 높이가 rem 이라 높이도 rem 으로 셈한다
const ROW_REM = 2.5;
const LIST_MAX_REM = 0.25 + ROW_REM * (props.rows ?? 6.5);
const PANEL_MAX = rem(LIST_MAX_REM + 3) + 1; // 검색창 몫: 위아래 여백 0.25 · 입력란 2.5rem · 아래 선 1px

const listEl = ref<HTMLElement | null>(null);
const overflowing = useOverflowing(listEl);

const { style } = useAnchoredPanel({ root, anchor, panel, open, maxHeight: PANEL_MAX });

// 바깥 누름은 패널 위치를 잡는 쪽이 같이 본다. 패널이 body 로 나가 있기 때문이다.
const onEsc = (event: KeyboardEvent) => event.key === "Escape" && (open.value = false);

watch(open, (now) => {
  if (now) document.addEventListener("keydown", onEsc);
  else document.removeEventListener("keydown", onEsc);
  if (now && props.searchable) void nextTick(() => box.value?.focus({ preventScroll: true }));
  if (!now) term.value = "";
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onEsc);
});
</script>
