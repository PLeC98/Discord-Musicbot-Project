<!--
  이모지 한 글자만 받는 입력칸.

  환경에 따라 이모지를 직접 치기 어렵거나 불가능해서 선택기를 붙인다. 그리고 그냥 입력칸이면
  이모지가 아닌 글자도 들어가 버리므로(선택 메뉴가 거부한다), 한 글자짜리 이모지만 받는다.
-->
<template>
  <div class="relative shrink-0">
    <button ref="anchor" type="button" :class="[box, 'emoji']" v-tooltip="modelValue ? '이모지 바꾸기' : '이모지 고르기'" @click="open = !open">
      <span v-if="modelValue">{{ modelValue }}</span>
      <Icon v-else name="add" :size="15" class="opacity-45" />
    </button>

    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-190" @click="open = false"></div>
      <div v-if="open" class="fixed z-200 rounded-2xl overflow-hidden shadow-card border border-white/12" :style="popoverStyle">
        <emoji-picker ref="picker" class="dark"></emoji-picker>
        <button v-if="modelValue" class="w-full bg-[rgba(12,16,36,0.92)] text-muted text-[0.8rem] py-2 cursor-pointer hover:text-danger" @click="pick('')">비우기</button>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from "vue";
import Icon from "./BaseIcon.vue";
import "emoji-picker-element";

defineProps({ modelValue: { type: String, default: "" } });
const emit = defineEmits(["update:modelValue"]);

const open = ref(false);
const anchor = ref(null);
const picker = ref(null);
const popoverStyle = ref({});

function onPick(event) {
  pick(event.detail.unicode);
}

function pick(value) {
  emit("update:modelValue", value);
  open.value = false;
}

// 선택기를 띄울 자리 — 버튼 아래가 화면을 넘치면 위로 올린다.
function place() {
  const rect = anchor.value?.getBoundingClientRect();
  if (!rect) return;
  const width = 340;
  const height = 400;
  const below = rect.bottom + 6;
  const top = below + height > window.innerHeight ? Math.max(8, rect.top - height - 6) : below;
  popoverStyle.value = { top: `${top}px`, left: `${Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)}px`, width: `${width}px` };
}

watch(open, async (isOpen) => {
  if (!isOpen) {
    picker.value?.removeEventListener("emoji-click", onPick);
    return;
  }
  place();
  await nextTick();
  picker.value?.addEventListener("emoji-click", onPick);
});

onBeforeUnmount(() => picker.value?.removeEventListener("emoji-click", onPick));

const box = "h-[38px] w-[38px] rounded-xl border border-white/9 bg-white/5 text-[1.05rem] leading-none flex items-center justify-center cursor-pointer transition-[background-color,border-color] duration-150 hover:bg-white/8";
</script>

<style scoped>
/* 선택기 자체 테마 — 대시보드의 유리 느낌에 맞춘다 */
emoji-picker {
  --background: rgba(12, 16, 36, 0.96);
  --border-color: transparent;
  --input-border-color: rgba(255, 255, 255, 0.12);
  --input-font-color: #e7e9f3;
  --input-placeholder-color: rgba(231, 233, 243, 0.45);
  --category-font-color: rgba(196, 181, 253, 0.8);
  --button-hover-background: rgba(255, 255, 255, 0.08);
  --button-active-background: rgba(255, 255, 255, 0.12);
  width: 100%;
  height: 400px;
}
</style>
