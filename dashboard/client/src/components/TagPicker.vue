<!--
  정해진 목록에서 여럿 고른다. 고른 것은 칩으로 남고, 치면 후보가 뜬다.

  MultiSelect 로도 고를 수 있지만 항목이 수백 개인 칸에는 맞지 않는다. 무엇이 있는지
  모르는 상태에서 목록을 훑어야 하고, 고른 것이 요약 한 줄로 접혀 보이지 않는다.
  여기서는 아는 말을 쳐서 찾고, 고른 것은 전부 눈에 남는다.

  ChipInput 과 달리 아무 말이나 넣을 수 없다. 목록에 없는 값은 저쪽이 거절하기 때문이다.
-->
<template>
  <div ref="root" class="relative">
    <div :class="boxCls">
      <span v-for="value in picked" :key="value" class="inline-flex items-center gap-1 max-w-full min-w-0 bg-white/8 rounded-lg pl-2 pr-1 py-0.5 text-[0.8rem]">
        <span class="truncate min-w-0">{{ labelOf(value) }}</span>
        <button class="size-4 rounded text-muted cursor-pointer flex items-center justify-center shrink-0 hover:text-danger" v-tooltip="'제거'" @click="remove(value)"><Icon name="close" :size="11" /></button>
      </span>

      <input ref="box" v-model="term" :placeholder="picked.length ? '' : placeholder" class="flex-1 min-w-32 bg-transparent border-0 text-fg text-[0.85rem] outline-none font-[inherit] py-0.5" @focus="open = true" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.enter.prevent="take(hits[at])" @keydown.esc="term ? (term = '') : (open = false)" @keydown.backspace="onBackspace" />
    </div>

    <div v-if="open && term.trim() && hits.length" :class="panelCls">
      <button v-for="(opt, i) in hits" :key="opt.value" type="button" :class="[rowCls, i === at ? 'bg-white/10' : '']" @mouseenter="at = i" @click="take(opt)">
        <span class="truncate">{{ opt.label }}</span>
      </button>
    </div>
    <p v-else-if="open && term.trim()" class="absolute z-30 mt-1 w-full rounded-lg border border-white/12 bg-[#141833] px-2.5 py-2 text-[0.8rem] text-muted">찾는 것이 없습니다</p>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from "vue";
import Icon from "./BaseIcon.vue";

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: "치면 후보가 뜹니다" },
  limit: { type: Number, default: 8 },
});
const emit = defineEmits(["update:modelValue"]);

const boxCls = "flex flex-wrap items-center gap-1.5 bg-white/5 border border-white/9 rounded-xl px-2.5 py-2 transition-[border-color,background-color] duration-200 focus-within:border-accent/55 focus-within:bg-white/7";
const panelCls = "absolute z-30 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-white/12 bg-[#141833] shadow-[0_12px_32px_rgba(0,0,0,0.5)] py-1";
const rowCls = "w-full flex items-center px-2.5 py-1.5 text-[0.82rem] text-fg-soft text-left cursor-pointer transition-colors duration-100 hover:bg-white/8";

const root = ref(null);
const box = ref(null);
const term = ref("");
const open = ref(false);
const at = ref(0);

const picked = computed(() => props.modelValue || []);
const labelOf = (value) => props.options.find((one) => one.value === value)?.label || value;

// 앞에서 걸리는 것을 먼저 보인다. 아는 말의 첫 글자를 치는 것이 보통이다.
const hits = computed(() => {
  const want = term.value.trim().toLowerCase();
  if (!want) return [];
  const left = props.options.filter((one) => !picked.value.includes(one.value));
  const starts = [];
  const rest = [];
  for (const one of left) {
    const label = String(one.label).toLowerCase();
    if (label.startsWith(want)) starts.push(one);
    else if (label.includes(want)) rest.push(one);
  }
  return [...starts, ...rest].slice(0, props.limit);
});

watch(hits, () => (at.value = 0));

const move = (by) => {
  if (hits.value.length) at.value = (at.value + by + hits.value.length) % hits.value.length;
};

function take(opt) {
  if (!opt) return;
  term.value = "";
  if (picked.value.includes(opt.value)) return;
  emit("update:modelValue", [...picked.value, opt.value]);
  box.value?.focus();
}

const remove = (value) =>
  emit(
    "update:modelValue",
    picked.value.filter((one) => one !== value),
  );

// 빈 칸에서 Backspace면 마지막 칩을 지운다. 칩 UI의 관습이다.
function onBackspace() {
  if (term.value !== "" || !picked.value.length) return;
  emit("update:modelValue", picked.value.slice(0, -1));
}

function onDocClick(event) {
  if (!root.value?.contains(event.target)) open.value = false;
}
watch(open, (now) => {
  document[now ? "addEventListener" : "removeEventListener"]("click", onDocClick, true);
});
onBeforeUnmount(() => document.removeEventListener("click", onDocClick, true));
</script>
