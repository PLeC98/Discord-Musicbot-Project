<!--
  이모지 선택 판. 무엇을 눌러 여는지와, 선택한 것을 어디에 넣는지는 부르는 쪽이 정한다.
  (장르 아이콘은 값을 교체하고, 상태 문구는 커서 위치에 끼워 넣는다.)

  검색창에는 이름으로 찾아도 되고 이모지를 붙여넣어도 된다. 붙여넣은 것이 목록에 없더라도
  이모지 한 글자이기만 하면 선택할 수 있게 맨 앞에 내놓는다.

  분류와 순서는 디스코드 선택기 그대로다. 목록(1900여 개)은 처음 열 때 따로 불러온다
 대시보드를 열 때마다 들고 다닐 것이 아니다.
-->
<template>
  <div ref="root" class="relative inline-flex shrink-0">
    <slot :toggle="() => (open = !open)" :open="open" />

    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-190" @mousedown="open = false"></div>

      <!-- M3E 메뉴 면(선택 목록과 같다): 바탕 surface-container-low · 그림자 2단 · 모서리 16. 위에 검색창(둘레 4 · 아래 구분선), 셀은 아이콘 버튼 S(40 · 이모지 24) 8열 -->
      <div v-if="open" :class="panel" :style="popoverStyle">
        <div class="relative shrink-0 p-1 border-b border-outline-variant/50">
          <!-- v-model 을 쓰지 않는다: 한글처럼 조합하는 글자를 다 짤 때까지 값을 넘기지 않아 검색이 늦다 -->
          <input ref="searchBox" :value="query" :placeholder="T.emojiSearch" :class="[SEARCH_FIELD, 'w-full', query && 'pr-10']" @input="query = valueOf($event)" @keydown.esc="open = false" />
          <!-- 지우기: 검색창 안 오른쪽 끝(아이콘 버튼 XS 32, 검색창 40 안에 같은 중심 4) -->
          <button v-if="query" type="button" class="tap state-layer absolute right-2 top-1/2 -translate-y-1/2 size-8 rounded-full flex items-center justify-center cursor-pointer text-on-surface-variant" :aria-label="T.emojiSearchClear" v-tooltip="T.emojiSearchClear" @click="clearQuery">
            <Icon name="close" :size="20" />
          </button>
        </div>

        <div :class="scroller">
          <div v-if="loadError" class="px-4 py-6 flex flex-col items-center gap-3 text-center">
            <p class="text-sm text-error whitespace-pre-line">{{ loadError }}</p>
            <BaseButton variant="secondary" size="sm" @click="load">{{ text.shell.retry }}</BaseButton>
          </div>
          <p v-else-if="!groups.length" class="py-6 text-center text-sm text-on-surface-variant">{{ T.emojiLoading }}</p>

          <!-- 찾는 중에는 분류를 접어 두었는지와 무관하게 전부 뒤진다 -->
          <div v-else-if="results" class="p-1">
            <p v-if="!results.length" class="py-6 text-center text-sm text-on-surface-variant">{{ T.emojiNone }}</p>
            <div v-else :class="grid">
              <button v-for="e in results" :key="e.char" type="button" :class="cell" v-tooltip="e.label" @click="choose(e.char)"><Twemoji :char="e.char" :size="24" /></button>
            </div>
          </div>

          <!-- content-visibility 로 화면 밖 분류를 건너뛰지 않는다: 짐작한 높이와 실제 높이의 차이가 소수점으로 남아 붙어 있는 분류 헤더 위에 틈이 비친다.
               그림은 어차피 lazy 라 화면 밖은 불러오지도 않는다 -->
          <section v-for="group in groups" v-else :key="group.name">
            <!-- 분류 헤더: 목록의 그룹 이름 모양에 접기 꺾쇠 · 개수. 판과 같은 바탕이라 붙어 있는 동안 밑으로 지나가는 셀이 비치지 않는다 -->
            <button type="button" :class="header" :aria-expanded="!collapsed[group.name]" @click="toggleGroup(group.name)">
              <Icon name="expand_more" :size="18" class="transition-transform duration-150" :class="collapsed[group.name] && '-rotate-90'" />
              <span class="truncate">{{ group.name }}</span>
              <span class="ml-auto nums font-normal">{{ group.emoji.length }}</span>
            </button>

            <div v-if="!collapsed[group.name]" :class="[grid, 'px-1 pb-1']">
              <button v-for="e in group.emoji" :key="e.char" type="button" :class="cell" v-tooltip="e.label" @click="choose(e.char)"><Twemoji :char="e.char" :size="24" /></button>
            </div>
          </section>
        </div>

        <button v-if="clearable" type="button" class="state-layer shrink-0 h-10 w-full border-t border-outline-variant/50 text-sm text-on-surface-variant cursor-pointer hover:text-error" @click="clear">{{ T.emojiClear }}</button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { koMatch } from "../utils/ko-search.ts";
import { ref, shallowRef, computed, watch, nextTick, onBeforeUnmount, useTemplateRef, type CSSProperties } from "vue";
import Icon from "./BaseIcon.vue";
import BaseButton from "./BaseButton.vue";
import { SEARCH_FIELD } from "../utils/field.ts";
import { rem } from "../utils/rem.ts";
import Twemoji from "./TwemojiImage.vue";
import { ONE_EMOJI } from "../../../src/config/schema/genres.ts";
import { readStored, writeStored } from "../utils/storage.ts";
import { valueOf } from "../utils/dom.ts";
import type { Emoji, EmojiGroup } from "../emoji-list.ts";
import { text } from "../text/index.ts";
const T = text.fields;

const props = withDefaults(
  defineProps<{
    /** 값을 비울 수 있는 곳(장르 아이콘)에서만 "비우기"를 보여준다 */
    clearable?: boolean;
  }>(),
  { clearable: false },
);
const emit = defineEmits<{ pick: [char: string]; clear: [] }>();

const open = ref(false);
const root = useTemplateRef<HTMLElement>("root");
const searchBox = ref<HTMLInputElement | null>(null);
const popoverStyle = ref<CSSProperties>({});
const query = ref("");
const groups = shallowRef<EmojiGroup[]>([]);
const collapsed = ref<Record<string, boolean>>({});
const loadError = ref("");

// 어느 분류를 접어 뒀는지는 브라우저가 기억한다. 못 읽거나 못 쓰는 환경(사생활 보호 창 등)에서도
// 그냥 다 펼친 채로 동작해야 하므로 실패는 삼킨다.
const STORE_KEY = "emojiPicker.collapsed";

function toggleGroup(name: string) {
  collapsed.value[name] = !collapsed.value[name];
  writeStored(STORE_KEY, JSON.stringify(Object.keys(collapsed.value).filter((k) => collapsed.value[k])));
}

async function load() {
  if (groups.value.length) return;
  loadError.value = "";

  let module;
  try {
    module = await import("../emoji-list.ts");
  } catch {
    // 목록은 따로 불러오므로 못 불러올 수가 있다. 특히 대시보드를 다시 빌드하면 파일 이름이
    // 바뀌어서, 열어 둔 화면이 없어진 파일을 찾는다. 새로고침하면 풀린다.
    loadError.value = T.emojiLoadFailed;
    return;
  }
  groups.value = module.EMOJI_GROUPS;

  let saved: unknown;
  try {
    saved = JSON.parse(readStored(STORE_KEY) || "[]");
  } catch {
    saved = null; // 못 읽는 환경이면 그냥 다 펼친다
  }
  // 저장된 이름 중 지금도 있는 것만 본다. 분류가 바뀌어도 엉뚱하게 접히지 않는다
  const names = new Set(Array.isArray(saved) ? saved : []);
  collapsed.value = Object.fromEntries(module.EMOJI_GROUPS.map((group) => [group.name, names.has(group.name)]));
}

function clearQuery() {
  query.value = "";
  searchBox.value?.focus();
}

const results = computed(() => {
  const typed = query.value.trim();
  if (!typed) return null;

  const found: Array<Pick<Emoji, "char" | "label">> = [];
  // 붙여넣은 이모지는 목록에 없더라도 선택할 수 있어야 한다. 폰트가 모르는 새 이모지일 수도 있다
  if (ONE_EMOJI.test(typed)) found.push({ char: typed, label: typed });

  const needle = typed.toLowerCase();
  for (const group of groups.value) {
    for (const e of group.emoji) {
      if (found.length >= 120) return found; // 다 그려 봐야 눈에 안 들어온다
      if (e.char !== typed && koMatch(e.search, needle)) found.push(e);
    }
  }
  return found;
});

function choose(char: string) {
  emit("pick", char);
  open.value = false;
}

function clear() {
  emit("clear");
  open.value = false;
}

// 판을 표시할 위치. 여는 버튼 아래가 화면을 넘치면 위로 올린다. 폭은 셀 8개(40) + 둘레 4 · 4, 높이는 검색창(48 + 선) + 목록(18.75rem) + 비우기(40 + 선)
const WIDTH_REM = 20.5;
function place() {
  const rect = root.value?.getBoundingClientRect();
  if (!rect) return;
  const width = rem(WIDTH_REM);
  const height = rem(3 + 18.75 + (props.clearable ? 2.5 : 0)) + 2;
  const below = rect.bottom + 4;
  const top = below + height > window.innerHeight ? Math.max(8, rect.top - height - 4) : below;
  // 정수로 떨어뜨린다. 소수점 좌표에 놓이면 안에서 붙어 있는 분류 헤더 위에 1픽셀 틈이 비친다
  const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
  popoverStyle.value = { top: `${Math.round(top)}px`, left: `${Math.round(left)}px`, width: `${width}px` };
}

// 판은 화면 기준으로 놓이므로, 페이지가 움직이면 다시 놓아야 버튼을 따라간다.
// capture로 잡아야 안쪽 스크롤 상자가 움직일 때도 걸린다.
const listen = (add: boolean) => {
  if (add) {
    window.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
  } else {
    window.removeEventListener("scroll", place, { capture: true });
    window.removeEventListener("resize", place);
  }
};

watch(open, async (isOpen) => {
  if (!isOpen) {
    listen(false);
    query.value = "";
    return;
  }
  place();
  listen(true);
  await load();
  await nextTick();
  searchBox.value?.focus();
});

onBeforeUnmount(() => listen(false));

const panel = "fixed z-200 flex flex-col overflow-hidden rounded-lg pane-menu bg-surface-container-low!";
// 스크롤 상자에는 안쪽 여백을 주지 않는다(주면 붙어 있는 분류 헤더가 그만큼 내려와 틈이 생긴다). 트랙은 아래 둥근 모서리만 비운다(위는 검색창 아래 곧은 선)
const scroller = "h-75 overflow-y-auto overscroll-contain [&::-webkit-scrollbar-track]:mb-(--sb-inset-menu)";
const header = "state-layer sticky top-0 z-10 w-full h-8 flex items-center gap-1 px-3 bg-surface-container-low text-xs font-semibold text-on-surface-variant cursor-pointer";
const grid = "grid grid-cols-8";
const cell = "state-layer size-10 rounded-full flex items-center justify-center cursor-pointer";
</script>
