<!--
  문자열 목록을 칩으로 다룬다 — 검색어와 차단어가 같은 성질이라 한 곳에 모은다.
  Enter로 추가, 지우기 버튼 또는 빈 칸에서 Backspace로 제거.
-->
<template>
  <div class="flex flex-wrap items-center gap-1.5 bg-white/5 border border-white/9 rounded-xl px-2.5 py-2 transition-[border-color,background-color] duration-200 focus-within:border-accent/55 focus-within:bg-white/7">
    <span v-for="(item, i) in modelValue" :key="`${i}-${item}`" class="inline-flex items-center gap-1 bg-white/8 rounded-lg pl-2 pr-1 py-0.5 text-[0.8rem]">
      {{ item }}
      <button class="size-4 rounded text-muted cursor-pointer flex items-center justify-center hover:text-danger" v-tooltip="'제거'" @click="removeAt(i)"><Icon name="close" :size="11" /></button>
    </span>

    <input v-model="entry" :placeholder="modelValue.length ? '' : placeholder" class="flex-1 min-w-32 bg-transparent border-0 text-fg text-[0.85rem] outline-none font-[inherit] py-0.5" @keydown.enter.prevent="commit" @keydown.backspace="onBackspace" @blur="commit" />
  </div>
</template>

<script setup>
import { ref } from "vue";
import Icon from "./BaseIcon.vue";

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  placeholder: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue"]);

const entry = ref("");

function commit() {
  const value = entry.value.trim();
  entry.value = "";
  if (!value || props.modelValue.includes(value)) return; // 같은 것을 두 번 넣을 이유가 없다
  emit("update:modelValue", [...props.modelValue, value]);
}

function removeAt(i) {
  emit(
    "update:modelValue",
    props.modelValue.filter((_, at) => at !== i),
  );
}

// 빈 칸에서 Backspace면 마지막 칩을 지운다 — 칩 UI의 관습이다.
function onBackspace() {
  if (entry.value !== "" || props.modelValue.length === 0) return;
  emit("update:modelValue", props.modelValue.slice(0, -1));
}
</script>
