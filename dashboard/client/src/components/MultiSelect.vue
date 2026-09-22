<!--
  여럿 고르는 드롭다운. 열면 각 줄 오른쪽 끝에 체크박스가 있다.

  알약(enumList)으로 늘어놓기에는 항목이 너무 많은 칸에 쓴다(가사 언어는 40가지가 넘는다).
  그만큼 많으면 훑어서 찾기 어려우므로 항목이 여럿일 때 검색칸을 함께 띄운다.
-->
<template>
  <div ref="root">
    <button ref="anchor" type="button" :class="boxCls" :aria-expanded="open" @click="open = !open">
      <span class="truncate" :class="picked.length ? 'text-fg' : 'text-muted'">{{ summary }}</span>
      <svg class="shrink-0 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
    </button>

    <Teleport to="body">
      <div v-if="open" ref="panel" :class="panelCls" :style="style">
        <div v-if="searchable" class="px-2 pt-1 pb-1.5 sticky top-0 bg-[#141833]">
          <input ref="box" v-model="term" type="text" :placeholder="`${options.length}개 중에서 찾기`" :class="searchCls" @keydown.esc.stop="term ? (term = '') : (open = false)" />
        </div>
        <button v-for="opt in shown" :key="opt.value" type="button" :class="rowCls" @click="toggle(opt.value)">
          <span class="truncate">{{ opt.label }}</span>
          <input type="checkbox" class="size-4 accent-accent shrink-0 pointer-events-none" :checked="picked.includes(opt.value)" tabindex="-1" />
        </button>
        <p v-if="!shown.length" class="px-2.5 py-2 text-[0.8rem] text-muted">찾는 것이 없습니다</p>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onBeforeUnmount, watch } from "vue";
import { useAnchoredPanel } from "../composables/anchoredPanel";

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: "전체" },
  // 이보다 많으면 검색칸을 띄운다. 몇 개뿐인 칸에 검색칸이 붙으면 거추장스럽다
  searchFrom: { type: Number, default: 12 },
});
const emit = defineEmits(["update:modelValue"]);

const boxCls = "w-full flex items-center justify-between gap-2 bg-white/5 border border-white/9 rounded-lg text-fg pl-2.5 pr-2 py-2 text-[0.85rem] font-[inherit] text-left cursor-pointer outline-none transition-[border-color] duration-150 focus:border-accent/55";
const panelCls = "overflow-auto rounded-lg border border-white/12 bg-[#141833] shadow-[0_12px_32px_rgba(0,0,0,0.5)] py-1";
const rowCls = "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[0.82rem] text-fg-soft text-left cursor-pointer transition-colors duration-100 hover:bg-white/8";
const searchCls = "w-full bg-white/5 border border-white/9 rounded-md text-fg px-2 py-1.5 text-[0.82rem] font-[inherit] outline-none transition-[border-color] duration-150 focus:border-accent/55";

const root = ref(null);
const anchor = ref(null);
const panel = ref(null);
const box = ref(null);
const open = ref(false);
const term = ref("");

const PANEL_MAX = 256;
const { style } = useAnchoredPanel({ root, anchor, panel, open, maxHeight: PANEL_MAX });
const picked = computed(() => props.modelValue || []);

const searchable = computed(() => props.options.length > props.searchFrom);
// 고른 것은 검색어와 무관하게 남긴다. 걸러 낸 뒤에 체크를 풀 수 없으면 답답하다
const shown = computed(() => {
  const want = term.value.trim().toLowerCase();
  if (!want) return props.options;
  return props.options.filter((one) => picked.value.includes(one.value) || String(one.label).toLowerCase().includes(want) || String(one.value).toLowerCase().includes(want));
});

const labelOf = (value) => props.options.find((one) => one.value === value)?.label || value;
const summary = computed(() => {
  if (!picked.value.length) return props.placeholder;
  return picked.value.length === 1 ? labelOf(picked.value[0]) : `${labelOf(picked.value[0])} 외 ${picked.value.length - 1}개`;
});

function toggle(value) {
  const next = picked.value.includes(value) ? picked.value.filter((one) => one !== value) : [...picked.value, value];
  emit("update:modelValue", next);
}

// 바깥 누름은 패널 자리를 잡는 쪽이 같이 본다. 패널이 body 로 나가 있기 때문이다.
const onEsc = (event) => event.key === "Escape" && (open.value = false);

watch(open, (now) => {
  document[now ? "addEventListener" : "removeEventListener"]("keydown", onEsc);
  if (now && searchable.value) nextTick(() => box.value?.focus());
  if (!now) term.value = "";
});

onBeforeUnmount(() => document.removeEventListener("keydown", onEsc));
</script>
