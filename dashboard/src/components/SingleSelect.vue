<template>
  <SelectPanel v-model:open="open" v-model:term="term" :summary="summary" :muted="!picked" :count="options.length" :searchable="searchable" :empty="!shown.length">
    <button v-if="emptyLabel" type="button" :class="[rowCls, picked ? '' : 'bg-white/10']" @click="choose('')">
      <span class="truncate text-muted">{{ emptyLabel }}</span>
    </button>
    <button v-for="opt in shown" :key="opt.value" type="button" :class="[rowCls, opt.value === modelValue ? 'bg-white/10' : '']" @click="choose(opt.value)">
      <span class="truncate">{{ opt.label }}</span>
    </button>
  </SelectPanel>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import SelectPanel from "./SelectPanel.vue";
import { filterOptions, type Option, type OptionValue } from "../utils/options.ts";

const props = withDefaults(
  defineProps<{
    modelValue?: OptionValue | null;
    options?: Option[];
    placeholder?: string;
    /** 있으면 목록 맨 위에 "비우기" 줄이 선다. 비울 수 없는 칸에서는 넘기지 않는다 */
    emptyLabel?: string;
    searchFrom?: number;
  }>(),
  { modelValue: "", options: () => [], placeholder: "고르기", emptyLabel: "", searchFrom: 12 },
);
const emit = defineEmits<{ "update:modelValue": [value: OptionValue] }>();

const rowCls = "w-full flex items-center px-2.5 py-1.5 text-[0.82rem] text-fg-soft text-left cursor-pointer transition-colors duration-100 hover:bg-white/8";

const open = ref(false);
const term = ref("");

const picked = computed(() => props.modelValue !== "" && props.modelValue != null);
const searchable = computed(() => props.options.length > props.searchFrom);
const shown = computed(() => filterOptions(props.options, term.value));

const summary = computed(() => {
  if (!picked.value) return props.emptyLabel || props.placeholder;
  return props.options.find((one) => one.value === props.modelValue)?.label || String(props.modelValue);
});

function choose(value: OptionValue) {
  emit("update:modelValue", value);
  open.value = false;
}
</script>
