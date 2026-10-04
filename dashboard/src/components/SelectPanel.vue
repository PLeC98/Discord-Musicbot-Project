<template>
  <div ref="root" class="relative">
    <button ref="anchor" type="button" :class="boxCls" :aria-expanded="open" @click="open = !open">
      <span class="truncate" :class="muted ? 'text-muted' : 'text-fg'">{{ summary }}</span>
      <svg class="shrink-0 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
    </button>

    <Teleport to="body">
      <div v-if="open" ref="panel" :class="panelCls" :style="style">
        <div v-if="searchable" class="shrink-0 px-2 py-1.5 border-b border-white/8">
          <input ref="box" v-model="term" type="text" :placeholder="`${count}개 중에서 찾기`" :class="searchCls" @keydown.esc.stop="term ? (term = '') : (open = false)" />
        </div>
        <div class="min-h-0 overflow-auto py-1">
          <slot />
          <p v-if="empty" class="px-2.5 py-2 text-[0.8rem] text-muted">찾는 것이 없습니다</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
// 고르기 칸의 겉: 누르는 칸 · body 로 내보낸 목록 · 검색칸. 하나 고르기(SingleSelect)와 여럿 고르기(MultiSelect)가 같이 쓴다.
// 목록의 줄은 쓰는 쪽이 넣는다(slot). 검색어(term)로 거르는 것도 쓰는 쪽이 한다(utils/options)
import { ref, nextTick, onBeforeUnmount, watch } from "vue";
import { useAnchoredPanel } from "../composables/anchored-panel.ts";

const props = defineProps<{
  /** 닫혀 있을 때 칸에 보일 글 */
  summary: string;
  /** 고른 것이 없다(흐리게 보인다) */
  muted: boolean;
  /** 고를 것의 수(검색칸 안내) */
  count: number;
  /** 검색칸을 띄우는지 */
  searchable: boolean;
  /** 걸러 낸 것이 없다 */
  empty: boolean;
}>();
const open = defineModel<boolean>("open", { default: false });
const term = defineModel<string>("term", { default: "" });

const boxCls = "w-full flex items-center justify-between gap-2 bg-white/5 border border-white/9 rounded-lg text-fg pl-2.5 pr-2 py-2 text-[0.85rem] font-[inherit] text-left cursor-pointer outline-none transition-[border-color] duration-150 focus:border-accent/55";
const panelCls = "flex flex-col overflow-hidden rounded-lg border border-white/12 bg-[#141833] shadow-[0_12px_32px_rgba(0,0,0,0.5)]";
const searchCls = "w-full bg-white/5 border border-white/9 rounded-md text-fg px-2 py-1.5 text-[0.82rem] font-[inherit] outline-none transition-[border-color] duration-150 focus:border-accent/55";

const root = ref<HTMLElement | null>(null);
const anchor = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const box = ref<HTMLInputElement | null>(null);

const PANEL_MAX = 256;
const { style } = useAnchoredPanel({ root, anchor, panel, open, maxHeight: PANEL_MAX });

// 바깥 누름은 패널 자리를 잡는 쪽이 같이 본다. 패널이 body 로 나가 있기 때문이다.
const onEsc = (event: KeyboardEvent) => event.key === "Escape" && (open.value = false);

watch(open, (now) => {
  if (now) document.addEventListener("keydown", onEsc);
  else document.removeEventListener("keydown", onEsc);
  if (now && props.searchable) void nextTick(() => box.value?.focus({ preventScroll: true }));
  if (!now) term.value = "";
});

onBeforeUnmount(() => document.removeEventListener("keydown", onEsc));
</script>
