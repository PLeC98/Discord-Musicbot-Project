<!--
  이모지 한 글자를 고르는 칸.

  환경에 따라 이모지를 직접 입력하기 어렵거나 불가능해서 고르는 판을 붙인다.
  검색칸에는 이름으로 찾아도 되고 이모지를 붙여넣어도 된다 — 붙여넣은 것이 목록에 없더라도
  이모지 한 글자이기만 하면 고를 수 있게 맨 앞에 내놓는다.

  분류와 순서는 디스코드 선택기 그대로다. 목록(1900여 개)은 처음 열 때 따로 받아온다
  — 대시보드를 열 때마다 들고 다닐 것이 아니다.
-->
<template>
  <div class="relative shrink-0">
    <button ref="anchor" type="button" :class="box" v-tooltip="modelValue ? '이모지 바꾸기' : '이모지 고르기'" @click="open = !open">
      <Twemoji v-if="modelValue" :char="modelValue" :size="20" />
      <Icon v-else name="add" :size="15" class="opacity-45" />
    </button>

    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-190" @mousedown="open = false"></div>

      <div v-if="open" :class="panel" :style="popoverStyle">
        <div class="p-2 border-b border-white/8 relative">
          <!-- v-model을 쓰지 않는다: v-model은 한글·일본어처럼 조합해서 만드는 글자를 다 만들 때까지
               input을 흘려보내서, 한 글자를 완성해도 다음 글자를 치기 전까지 검색이 안 먹는다. -->
          <input ref="searchBox" :value="query" placeholder="이름 · 디스코드 이름 · 이모지 붙여넣기" :class="searchCls" @input="query = $event.target.value" @keydown.esc="open = false" />
          <button v-if="query" type="button" :class="clearBtn" v-tooltip="'검색어 지우기'" @click="clearQuery">
            <Icon name="close" :size="12" />
          </button>
        </div>

        <div :class="scroller">
          <p v-if="!groups.length" class="text-muted text-[0.82rem] text-center py-8">불러오는 중...</p>

          <!-- 찾는 중에는 분류를 접어 두었는지와 무관하게 전부 뒤진다 -->
          <div v-else-if="results" class="px-2 py-2">
            <p v-if="!results.length" class="text-muted text-[0.82rem] text-center py-6">찾는 이모지가 없습니다.</p>
            <div v-else :class="grid">
              <button v-for="e in results" :key="e.char" type="button" :class="cell" v-tooltip="e.label" @click="pick(e.char)"><Twemoji :char="e.char" :size="22" /></button>
            </div>
          </div>

          <!-- content-visibility: 화면 밖 분류는 그리지 않는다 — 1900여 개를 한 번에 펼쳐 두기 때문 -->
          <section v-for="group in groups" v-else :key="group.name" class="[content-visibility:auto] [contain-intrinsic-size:auto_200px]">
            <!-- 배경을 판과 같은 색으로 둬야 접히는 자리에 틈이 비치지 않는다 -->
            <button type="button" :class="header" @click="toggle(group.name)">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" class="transition-transform duration-150 shrink-0" :class="collapsed[group.name] ? '-rotate-90' : ''">
                <path d="M0 2h8L4 7z" />
              </svg>
              <span class="truncate">{{ group.name }}</span>
              <span class="ml-auto opacity-40 tabular-nums">{{ group.emoji.length }}</span>
            </button>

            <div v-if="!collapsed[group.name]" :class="[grid, 'px-2 pb-2']">
              <button v-for="e in group.emoji" :key="e.char" type="button" :class="cell" v-tooltip="e.label" @click="pick(e.char)"><Twemoji :char="e.char" :size="22" /></button>
            </div>
          </section>
        </div>

        <button v-if="modelValue" type="button" class="w-full border-t border-white/8 text-muted text-[0.8rem] py-2 cursor-pointer hover:text-danger" @click="pick('')">비우기</button>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, shallowRef, computed, watch, nextTick, onBeforeUnmount } from "vue";
import Icon from "./BaseIcon.vue";
import Twemoji from "./TwemojiImage.vue";

defineProps({ modelValue: { type: String, default: "" } });
const emit = defineEmits(["update:modelValue"]);

const open = ref(false);
const anchor = ref(null);
const searchBox = ref(null);
const popoverStyle = ref({});
const query = ref("");
const groups = shallowRef([]);
const collapsed = ref({});

const ONE_EMOJI = /^\p{RGI_Emoji}$/v;

// 어느 분류를 접어 뒀는지는 브라우저가 기억한다. 못 읽거나 못 쓰는 환경(사생활 보호 창 등)에서도
// 그냥 다 펼친 채로 동작해야 하므로 실패는 삼킨다.
const STORE_KEY = "emojiPicker.collapsed";

function toggle(name) {
  collapsed.value[name] = !collapsed.value[name];
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(Object.keys(collapsed.value).filter((k) => collapsed.value[k])));
  } catch {
    // 기억하지 못해도 고르는 데는 지장이 없다
  }
}

async function load() {
  if (groups.value.length) return;
  const module = await import("../emojiList.js");
  groups.value = module.EMOJI_GROUPS;

  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
  } catch {
    saved = null; // 못 읽는 환경이면 그냥 다 펼친다
  }
  // 저장된 이름 중 지금도 있는 것만 본다 — 분류가 바뀌어도 엉뚱하게 접히지 않는다
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

  const found = [];
  // 붙여넣은 이모지는 목록에 없더라도 고를 수 있어야 한다 — 폰트가 모르는 새 이모지일 수도 있다
  if (ONE_EMOJI.test(typed)) found.push({ char: typed, label: typed });

  const needle = typed.toLowerCase();
  for (const group of groups.value) {
    for (const e of group.emoji) {
      if (found.length >= 120) return found; // 다 그려 봐야 눈에 안 들어온다
      if (e.char !== typed && e.search.includes(needle)) found.push(e);
    }
  }
  return found;
});

function pick(value) {
  emit("update:modelValue", value);
  open.value = false;
}

// 판을 띄울 자리 — 칸 아래가 화면을 넘치면 위로 올린다.
function place() {
  const rect = anchor.value?.getBoundingClientRect();
  if (!rect) return;
  const width = 320;
  const height = 372;
  const below = rect.bottom + 6;
  const top = below + height > window.innerHeight ? Math.max(8, rect.top - height - 6) : below;
  popoverStyle.value = { top: `${top}px`, left: `${Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)}px`, width: `${width}px` };
}

// 판은 화면 기준으로 놓이므로, 페이지가 움직이면 다시 놓아야 칸을 따라간다.
// capture로 잡아야 안쪽 스크롤 상자가 움직일 때도 걸린다.
const listen = (add) => {
  const fn = add ? window.addEventListener : window.removeEventListener;
  fn.call(window, "scroll", place, { capture: true, passive: true });
  fn.call(window, "resize", place);
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

const box = "h-[38px] w-[38px] rounded-xl border border-white/9 bg-white/5 text-[1.05rem] leading-none flex items-center justify-center cursor-pointer transition-[background-color,border-color] duration-150 hover:bg-white/8";
const panel = "fixed z-200 rounded-2xl overflow-hidden bg-[rgba(18,22,42,0.97)] backdrop-blur-2xl backdrop-saturate-[1.6] border border-white/11 shadow-[0_12px_40px_rgba(0,0,0,0.55)] inset-shadow-glass";
const searchCls = "w-full bg-white/5 border border-white/9 rounded-lg text-fg px-3 py-1.5 text-[0.84rem] outline-none font-[inherit] transition-[border-color,background-color] duration-150 focus:border-accent/55 focus:bg-white/7";
// 스크롤 상자에는 안쪽 여백을 주지 않는다 — 여백을 주면 붙어 있는 분류 머리가 그만큼 내려와 틈이 생긴다
const scroller = "h-[300px] overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-(--sb-track-color) [&::-webkit-scrollbar-track]:rounded-[5px] [&::-webkit-scrollbar-thumb]:bg-(--sb-thumb-color) [&::-webkit-scrollbar-thumb]:rounded-[5px]";
const header = "sticky top-0 z-10 w-full flex items-center gap-1.5 bg-[rgba(18,22,42,0.97)] px-2.5 py-1.5 text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[rgba(196,181,253,0.7)] cursor-pointer transition-colors duration-150 hover:text-[rgba(196,181,253,0.95)]";
const clearBtn = "absolute right-4 top-1/2 -translate-y-1/2 size-5 rounded-full flex items-center justify-center text-muted cursor-pointer transition-colors duration-150 hover:bg-white/12 hover:text-fg";
const grid = "grid grid-cols-8 gap-0.5";
const cell = "size-[34px] rounded-lg text-[1.15rem] leading-none flex items-center justify-center cursor-pointer transition-colors duration-100 hover:bg-white/12";
</script>
