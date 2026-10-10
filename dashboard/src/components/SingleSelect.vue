<template>
  <SelectPanel v-model:open="open" v-model:term="term" :summary="summary" :summary-color="pickedColor" :muted="!picked" :count="options.length" :searchable="searchable" :empty="!shown.length" :disabled="disabled">
    <button v-if="emptyLabel" type="button" :class="[rowCls, picked ? '' : rowOn]" @click="choose('')">
      <span class="truncate" :class="picked && 'text-on-surface-variant'">{{ emptyLabel }}</span>
    </button>
    <template v-for="(opt, i) in shown" :key="String(opt.value)">
      <p v-if="opt.group && opt.group !== shown[i - 1]?.group" :class="SELECT_GROUP">{{ opt.group }}</p>
      <button type="button" :class="[rowCls, opt.value === modelValue ? rowOn : '']" @click="choose(opt.value)">
        <span v-if="opt.color" class="size-2 shrink-0 rounded-full mr-2" :style="{ backgroundColor: opt.color }"></span><span class="truncate">{{ opt.label }}</span>
      </button>
    </template>
  </SelectPanel>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import SelectPanel from "./SelectPanel.vue";
import { filterOptions, type Option, type OptionValue } from "../utils/options.ts";
import { SELECT_GROUP, SELECT_ROW, SELECT_ROW_ON } from "../utils/select-row.ts";

const props = withDefaults(
  defineProps<{
    modelValue?: OptionValue | null;
    options?: Option[];
    placeholder?: string;
    /** 있으면 목록 맨 위에 "비우기" 줄이 선다. 비울 수 없는 칸에서는 넘기지 않는다 */
    emptyLabel?: string;
    searchFrom?: number;
    disabled?: boolean;
  }>(),
  { modelValue: "", options: () => [], placeholder: "고르기", emptyLabel: "", searchFrom: 12, disabled: false },
);
const emit = defineEmits<{ "update:modelValue": [value: OptionValue] }>();

const rowCls = SELECT_ROW;
const rowOn = SELECT_ROW_ON;

const open = ref(false);
const term = ref("");

const picked = computed(() => props.modelValue !== "" && props.modelValue != null);
const searchable = computed(() => props.options.length > props.searchFrom);
const shown = computed(() => filterOptions(props.options, term.value));

const pickedColor = computed(() => (picked.value ? props.options.find((one) => one.value === props.modelValue)?.color : undefined));
const summary = computed(() => {
  if (!picked.value) return props.emptyLabel || props.placeholder;
  return props.options.find((one) => one.value === props.modelValue)?.label || String(props.modelValue);
});

function choose(value: OptionValue) {
  emit("update:modelValue", value);
  open.value = false;
}
</script>
