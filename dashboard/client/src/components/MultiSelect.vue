<!--
  여럿 고르는 드롭다운 — 열면 각 줄 오른쪽 끝에 체크박스가 있다.

  알약(enumList)으로 늘어놓기에는 항목이 너무 많은 칸에 쓴다(가사 언어는 40가지가 넘는다).
-->
<template>
  <div ref="root" class="relative">
    <button type="button" :class="boxCls" :aria-expanded="open" @click="open = !open">
      <span class="truncate" :class="picked.length ? 'text-fg' : 'text-muted'">{{ summary }}</span>
      <svg class="shrink-0 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
    </button>

    <div v-if="open" :class="panelCls">
      <button v-for="opt in options" :key="opt.value" type="button" :class="rowCls" @click="toggle(opt.value)">
        <span class="truncate">{{ opt.label }}</span>
        <input type="checkbox" class="size-4 accent-accent shrink-0 pointer-events-none" :checked="picked.includes(opt.value)" tabindex="-1" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount, watch } from "vue";

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: "전체" },
});
const emit = defineEmits(["update:modelValue"]);

const boxCls = "w-full flex items-center justify-between gap-2 bg-white/5 border border-white/9 rounded-lg text-fg pl-2.5 pr-2 py-2 text-[0.85rem] font-[inherit] text-left cursor-pointer outline-none transition-[border-color] duration-150 focus:border-accent/55";
const panelCls = "absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-white/12 bg-[#141833] shadow-[0_12px_32px_rgba(0,0,0,0.5)] py-1";
const rowCls = "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[0.82rem] text-fg-soft text-left cursor-pointer transition-colors duration-100 hover:bg-white/8";

const root = ref(null);
const open = ref(false);
const picked = computed(() => props.modelValue || []);

const labelOf = (value) => props.options.find((one) => one.value === value)?.label || value;
const summary = computed(() => {
  if (!picked.value.length) return props.placeholder;
  return picked.value.length === 1 ? labelOf(picked.value[0]) : `${labelOf(picked.value[0])} 외 ${picked.value.length - 1}개`;
});

function toggle(value) {
  const next = picked.value.includes(value) ? picked.value.filter((one) => one !== value) : [...picked.value, value];
  emit("update:modelValue", next);
}

// 바깥을 누르면 닫는다. 열려 있을 때만 듣는다 — 닫힌 드롭다운이 여럿 있어도 비용이 없다.
function onDocClick(event) {
  if (!root.value?.contains(event.target)) open.value = false;
}
const onEsc = (event) => event.key === "Escape" && (open.value = false);

watch(open, (now) => {
  const how = now ? "addEventListener" : "removeEventListener";
  document[how]("click", onDocClick, true);
  document[how]("keydown", onEsc);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick, true);
  document.removeEventListener("keydown", onEsc);
});
</script>
