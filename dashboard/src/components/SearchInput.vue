<template>
  <!-- 찾기 · 필터 입력란: 값이 있으면 입력란 안 오른쪽 끝에 지우기(x). 누르면 비우고 입력란에 포커스를 남기고, Esc 도 비운다(비울 때는 Esc 를 막아 둘레의 판이 닫히지 않는다. 비어 있으면 판이 닫힌다).
       v-model 을 쓰지 않는다: 한글처럼 조합하는 글자를 다 짤 때까지 값을 넘기지 않아 찾기가 늦다.
       꾸밈은 부르는 쪽: class 는 감싼 틀(자리 · 너비)에, input-class 는 입력란에, 그 밖의 속성 · 이벤트는 입력란에. 왼쪽 아이콘은 leading 슬롯.
       note: 값이 있을 때 입력란 안 지우기 앞에 작게 보일 글(찾은 줄 수 등). 헤더 · 줄의 다른 칸과 폭을 다투지 않게 입력란 안에 둔다 -->
  <div class="relative" :class="attrs.class">
    <slot name="leading" />
    <input ref="box" v-bind="rest" :value="modelValue" :class="[inputClass, modelValue && !shownNote && SIZES[size].pad]" :style="shownNote ? { paddingRight: `${SIZES[size].end + noteWidth + 8}px` } : undefined" @input="emit('update:modelValue', valueOf($event))" @keydown.esc="onEscape" />
    <span v-if="shownNote" ref="noteEl" class="pointer-events-none absolute top-1/2 -translate-y-1/2 text-xs nums text-on-surface-variant whitespace-nowrap" :style="{ right: `${SIZES[size].end}px` }">{{ shownNote }}</span>
    <button v-if="modelValue && !disabled" type="button" class="tap state-layer absolute top-1/2 -translate-y-1/2 rounded-full flex items-center justify-center cursor-pointer text-on-surface-variant" :class="SIZES[size].button" :aria-label="clearLabel" v-tooltip="clearLabel" @click.prevent.stop="clear">
      <Icon name="close" :size="SIZES[size].icon" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useAttrs } from "vue";
import Icon from "./BaseIcon.vue";
import { text } from "../text/index.ts";
import { composing, valueOf } from "../utils/dom.ts";
import { useElementSize } from "@vueuse/core";

defineOptions({ inheritAttrs: false });
/** size: 입력란 높이에 맞춘 지우기 버튼(md 40 · sm 32 · xs 24). clearLabel: 버튼 이름 */
const props = withDefaults(defineProps<{ modelValue: string; inputClass?: unknown; size?: "md" | "sm" | "xs"; clearLabel?: string; note?: string }>(), { size: "md", clearLabel: text.fields.searchClear, note: "" });
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

/** 크기마다: 지우기 버튼(아이콘 버튼 · 입력란 안 같은 중심) · 아이콘 · 값이 있을 때 입력란 오른쪽 여백 · 지우기 버튼의 왼쪽 끝(오른쪽에서 px, note 자리) */
const SIZES = {
  md: { button: "right-1 size-8", icon: 20, pad: "pr-10!", end: 40 },
  sm: { button: "right-1 size-6", icon: 16, pad: "pr-8!", end: 32 },
  xs: { button: "right-1 size-5", icon: 14, pad: "pr-6!", end: 28 },
} as const;

const attrs = useAttrs();
const rest = computed(() => Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== "class")));
/** 입력란을 끈 동안은 지우기도 없다 */
const disabled = computed(() => attrs.disabled !== undefined && attrs.disabled !== false);
const box = ref<HTMLInputElement | null>(null);
// note 는 값이 있고 지우기가 보일 때만. 입력란 오른쪽 여백을 그 폭만큼 늘려 글이 겹치지 않게
const shownNote = computed(() => (props.modelValue && !disabled.value ? props.note : ""));
const noteEl = ref<HTMLElement | null>(null);
const { width: noteWidth } = useElementSize(noteEl);

function clear() {
  emit("update:modelValue", "");
  box.value?.focus();
}
function onEscape(event: KeyboardEvent) {
  // 한글을 조합하는 중의 Esc 는 입력기 몫이다
  if (composing(event) || !props.modelValue) return;
  event.preventDefault();
  emit("update:modelValue", "");
}

defineExpose({ focus: (options?: FocusOptions) => box.value?.focus(options), el: box });
</script>
