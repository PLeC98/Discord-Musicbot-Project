<template>
  <SelectPanel v-model:open="open" v-model:term="term" :summary="summary" :muted="!picked.length" :count="options.length" :searchable="searchable" :empty="!shown.length">
    <button v-for="opt in shown" :key="String(opt.value)" type="button" :class="[rowCls, picked.includes(opt.value) ? rowOn : '']" @click="toggle(opt.value)">
      <span class="truncate">{{ opt.label }}</span>
      <input type="checkbox" class="size-4 shrink-0 pointer-events-none" :class="picked.includes(opt.value) ? 'accent-on-tertiary-container' : 'accent-primary'" :checked="picked.includes(opt.value)" tabindex="-1" />
    </button>
  </SelectPanel>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import SelectPanel from "./SelectPanel.vue";
import { filterOptions, type Option, type OptionValue } from "../utils/options.ts";
import { SELECT_ROW, SELECT_ROW_ON } from "../utils/select-row.ts";
import { text } from "../text/index.ts";

const props = withDefaults(
  defineProps<{
    modelValue?: OptionValue[] | null;
    options?: Option[];
    placeholder?: string;
    /** 이보다 많으면 검색칸을 띄운다. 몇 개뿐인 칸에 검색칸이 붙으면 거추장스럽다 */
    searchFrom?: number;
  }>(),
  { modelValue: () => [], options: () => [], placeholder: text.common.all, searchFrom: 12 },
);
const emit = defineEmits<{ "update:modelValue": [value: OptionValue[]] }>();

const rowCls = `${SELECT_ROW} justify-between gap-2`;
// 고른 줄: M3E 세로 메뉴의 고른 줄(모서리 12 · tertiary-container)
const rowOn = SELECT_ROW_ON;

const open = ref(false);
const term = ref("");

const picked = computed(() => props.modelValue || []);
const searchable = computed(() => props.options.length > props.searchFrom);
// 고른 것은 검색어와 무관하게 남긴다. 걸러 낸 뒤에 체크를 풀 수 없으면 답답하다
const shown = computed(() => filterOptions(props.options, term.value, (value) => picked.value.includes(value)));

const labelOf = (value: OptionValue) => props.options.find((one) => one.value === value)?.label || String(value);
const summary = computed(() => {
  if (!picked.value.length) return props.placeholder;
  return picked.value.length === 1 ? labelOf(picked.value[0]) : text.fields.pickedSummary(labelOf(picked.value[0]), picked.value.length - 1);
});

function toggle(value: OptionValue) {
  const next = picked.value.includes(value) ? picked.value.filter((one) => one !== value) : [...picked.value, value];
  emit("update:modelValue", next);
}
</script>
