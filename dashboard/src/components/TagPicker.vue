<!--
  정해진 목록에서 여럿 고른다. 고른 것은 칩으로 남고, 치면 후보가 뜬다.

  MultiSelect 로도 고를 수 있지만 항목이 수백 개인 칸에는 맞지 않는다. 무엇이 있는지
  모르는 상태에서 목록을 훑어야 하고, 고른 것이 요약 한 줄로 접혀 보이지 않는다.
  여기서는 아는 말을 쳐서 찾고, 고른 것은 전부 눈에 남는다.

  ChipInput 과 달리 아무 말이나 넣을 수 없다. 목록에 없는 값은 저쪽이 거절하기 때문이다.
-->
<template>
  <div ref="root">
    <div ref="box" :class="CHIP_FIELD">
      <span v-for="value in picked" :key="value" :class="INPUT_CHIP">
        <span class="truncate min-w-0">{{ labelOf(value) }}</span>
        <button :class="INPUT_CHIP_CLOSE" aria-label="삭제" v-tooltip="'삭제'" @click="remove(value)"><Icon name="close" :size="18" /></button>
      </span>

      <input
        ref="field"
        :value="term"
        @input="term = valueOf($event)"
        :placeholder="picked.length ? '' : placeholder"
        class="flex-1 min-w-32 h-8 px-2 bg-transparent border-0 text-on-surface text-sm outline-none font-[inherit] placeholder:text-on-surface-variant"
        @focus="open = true"
        @keydown.down="composing($event) || ($event.preventDefault(), move(1))"
        @keydown.up="composing($event) || ($event.preventDefault(), move(-1))"
        @keydown.enter="composing($event) || ($event.preventDefault(), take(hits[at]))"
        @keydown.esc="term ? (term = '') : (open = false)"
        @keydown.backspace="composing($event) || onBackspace()"
      />
    </div>

    <Teleport to="body">
      <div v-if="open && term.trim() && hits.length" ref="panel" :class="CHIP_PANEL" :style="style">
        <button v-for="(opt, i) in hits" :key="opt.value" type="button" :class="[CHIP_PANEL_ROW, i === at ? 'bg-on-surface/8' : '']" @mouseenter="at = i" @click="take(opt)">
          <span class="truncate">{{ opt.label }}</span>
        </button>
      </div>
      <p v-else-if="open && term.trim()" ref="panel" :class="CHIP_PANEL_NOTE" :style="style">찾는 것이 없어요</p>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { composing, valueOf } from "../utils/dom.ts";
import { koMatch, koStarts } from "../utils/ko-search.ts";
import { rem } from "../utils/rem.ts";
import { CHIP_FIELD, CHIP_PANEL, CHIP_PANEL_NOTE, CHIP_PANEL_ROW, INPUT_CHIP, INPUT_CHIP_CLOSE } from "../utils/field.ts";
import { ref, computed, watch } from "vue";
import Icon from "./BaseIcon.vue";
import { useAnchoredPanel } from "../composables/anchored-panel.ts";
import { useListCursor } from "../composables/list-cursor.ts";
import type { Option, OptionValue } from "../utils/options.ts";

const props = withDefaults(defineProps<{ modelValue?: OptionValue[] | null; options?: Option[]; placeholder?: string; limit?: number }>(), {
  modelValue: () => [],
  options: () => [],
  placeholder: "입력하면 후보가 표시돼요",
  limit: 8,
});
const emit = defineEmits<{ "update:modelValue": [value: OptionValue[]] }>();

const root = ref<HTMLElement | null>(null);
const box = ref<HTMLElement | null>(null);
const field = ref<HTMLInputElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const term = ref("");
const open = ref(false);

const PANEL_MAX = rem(15);
const { style } = useAnchoredPanel({ root, anchor: box, panel, open, maxHeight: PANEL_MAX });

const picked = computed(() => props.modelValue || []);
const labelOf = (value: OptionValue) => props.options.find((one) => one.value === value)?.label || String(value);

// 앞에서 걸리는 것을 먼저 보인다. 아는 말의 첫 글자를 치는 것이 보통이다.
const hits = computed(() => {
  const want = term.value.trim();
  if (!want) return [];
  const left = props.options.filter((one) => !picked.value.includes(one.value));
  const starts: Option[] = [];
  const rest: Option[] = [];
  for (const one of left) {
    const label = String(one.label);
    if (koStarts(label, want)) starts.push(one);
    else if (koMatch(label, want)) rest.push(one);
  }
  return [...starts, ...rest].slice(0, props.limit);
});

const { at, move, reset } = useListCursor(panel, () => hits.value.length, 0);
watch(hits, reset);

function take(opt: Option | undefined) {
  if (!opt) return;
  term.value = "";
  if (picked.value.includes(opt.value)) return;
  emit("update:modelValue", [...picked.value, opt.value]);
  field.value?.focus();
}

const remove = (value: OptionValue) =>
  emit(
    "update:modelValue",
    picked.value.filter((one) => one !== value),
  );

// 빈 칸에서 Backspace면 마지막 칩을 지운다. 칩 UI의 관습이다.
function onBackspace() {
  if (term.value !== "" || !picked.value.length) return;
  emit("update:modelValue", picked.value.slice(0, -1));
}
</script>
