<!--
  하나 고르는 드롭다운. 기본 select 를 대신한다.

  펼친 목록의 테두리·둥근 모서리·바탕은 브라우저가 그리는 것이라 CSS 가 닿지 않는다.
  옆에 선 MultiSelect·TagPicker 와 모양이 달라 보이는 것이 그래서다. 우리가 그리면
  셋이 같아지고, 자리 잡는 방식(카드 밖으로 나가기, 위로 뒤집기)도 같이 따라온다.

  MultiSelect 와 나누지 않은 이유: 고른 값의 모양(하나 vs 여럿), 고르면 닫는가,
  체크박스가 있는가가 전부 다르다. 합치면 분기가 본문보다 길어진다.
  공통인 것은 자리 잡기뿐이고 그것은 이미 anchoredPanel 로 나뉘어 있다.
-->
<template>
  <div ref="root" class="relative">
    <button ref="anchor" type="button" :class="boxCls" :aria-expanded="open" @click="open = !open">
      <span class="truncate" :class="picked ? 'text-fg' : 'text-muted'">{{ summary }}</span>
      <svg class="shrink-0 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
    </button>

    <Teleport to="body">
      <div v-if="open" ref="panel" :class="panelCls" :style="style">
        <div v-if="searchable" class="shrink-0 px-2 py-1.5 border-b border-white/8">
          <input ref="box" v-model="term" type="text" :placeholder="`${options.length}개 중에서 찾기`" :class="searchCls" @keydown.esc.stop="term ? (term = '') : (open = false)" />
        </div>
        <div class="min-h-0 overflow-auto py-1">
          <button v-if="emptyLabel" type="button" :class="[rowCls, picked ? '' : 'bg-white/10']" @click="choose('')">
            <span class="truncate text-muted">{{ emptyLabel }}</span>
          </button>
          <button v-for="opt in shown" :key="opt.value" type="button" :class="[rowCls, opt.value === modelValue ? 'bg-white/10' : '']" @click="choose(opt.value)">
            <span class="truncate">{{ opt.label }}</span>
          </button>
          <p v-if="!shown.length" class="px-2.5 py-2 text-[0.8rem] text-muted">찾는 것이 없습니다</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onBeforeUnmount, watch } from "vue";
import { useAnchoredPanel } from "../composables/anchoredPanel";

const props = defineProps({
  modelValue: { type: [String, Number], default: "" },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: "고르기" },
  // 있으면 목록 맨 위에 "비우기" 줄이 선다. 비울 수 없는 칸에서는 넘기지 않는다
  emptyLabel: { type: String, default: "" },
  searchFrom: { type: Number, default: 12 },
});
const emit = defineEmits(["update:modelValue"]);

const boxCls = "w-full flex items-center justify-between gap-2 bg-white/5 border border-white/9 rounded-lg text-fg pl-2.5 pr-2 py-2 text-[0.85rem] font-[inherit] text-left cursor-pointer outline-none transition-[border-color] duration-150 focus:border-accent/55";
const panelCls = "flex flex-col overflow-hidden rounded-lg border border-white/12 bg-[#141833] shadow-[0_12px_32px_rgba(0,0,0,0.5)]";
const rowCls = "w-full flex items-center px-2.5 py-1.5 text-[0.82rem] text-fg-soft text-left cursor-pointer transition-colors duration-100 hover:bg-white/8";
const searchCls = "w-full bg-white/5 border border-white/9 rounded-md text-fg px-2 py-1.5 text-[0.82rem] font-[inherit] outline-none transition-[border-color] duration-150 focus:border-accent/55";

const root = ref(null);
const anchor = ref(null);
const panel = ref(null);
const box = ref(null);
const open = ref(false);
const term = ref("");

const PANEL_MAX = 256;
const { style } = useAnchoredPanel({ root, anchor, panel, open, maxHeight: PANEL_MAX });

const picked = computed(() => props.modelValue !== "" && props.modelValue != null);
const searchable = computed(() => props.options.length > props.searchFrom);
const shown = computed(() => {
  const want = term.value.trim().toLowerCase();
  if (!want) return props.options;
  return props.options.filter((one) => String(one.label).toLowerCase().includes(want) || String(one.value).toLowerCase().includes(want));
});

const summary = computed(() => {
  if (!picked.value) return props.emptyLabel || props.placeholder;
  return props.options.find((one) => one.value === props.modelValue)?.label || props.modelValue;
});

function choose(value) {
  emit("update:modelValue", value);
  open.value = false;
}

// 바깥 누름은 패널 자리를 잡는 쪽이 같이 본다. 패널이 body 로 나가 있기 때문이다.
const onEsc = (event) => event.key === "Escape" && (open.value = false);

watch(open, (now) => {
  document[now ? "addEventListener" : "removeEventListener"]("keydown", onEsc);
  if (now && searchable.value) nextTick(() => box.value?.focus({ preventScroll: true }));
  if (!now) term.value = "";
});

onBeforeUnmount(() => document.removeEventListener("keydown", onEsc));
</script>
