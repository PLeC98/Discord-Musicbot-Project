<!--
  문자열 목록을 칩으로 다룬다 — 검색어와 차단어가 같은 성질이라 한 곳에 모은다.
  Enter로 추가, 지우기 버튼 또는 빈 칸에서 Backspace로 제거, 칩을 누르면 고친다.
-->
<template>
  <div class="flex flex-wrap items-center gap-1.5 bg-white/5 border border-white/9 rounded-xl px-2.5 py-2 transition-[border-color,background-color] duration-200 focus-within:border-accent/55 focus-within:bg-white/7">
    <span v-for="(item, i) in modelValue" :key="`${i}-${item}`" class="inline-flex items-center gap-1 bg-white/8 rounded-lg pl-2 pr-1 py-0.5 text-[0.8rem]">
      <!-- 고치는 중에는 그 자리에서 바로 친다 — 지우고 다시 넣게 하면 긴 검색어가 성가시다 -->
      <input v-if="editing === i" ref="editBox" v-model="draft" :size="Math.max(draft.length, 3)" class="bg-transparent border-0 text-fg text-[0.8rem] outline-none font-[inherit] p-0 min-w-8" @keydown.enter.prevent="commitEdit" @keydown.esc="editing = null" @blur="commitEdit" />
      <template v-else>
        <button class="cursor-text text-left" v-tooltip="'눌러서 고치기'" @click="startEdit(i)">{{ item }}</button>
        <button class="size-4 rounded text-muted cursor-pointer flex items-center justify-center hover:text-danger" v-tooltip="'제거'" @click="removeAt(i)"><Icon name="close" :size="11" /></button>
      </template>
    </span>

    <input v-model="entry" :placeholder="modelValue.length ? '' : placeholder" class="flex-1 min-w-32 bg-transparent border-0 text-fg text-[0.85rem] outline-none font-[inherit] py-0.5" @keydown.enter.prevent="commit" @keydown.backspace="onBackspace" @blur="commit" />
  </div>
</template>

<script setup>
import { ref, nextTick, useTemplateRef } from "vue";
import Icon from "./BaseIcon.vue";

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  placeholder: { type: String, default: "" },
  // 차단어처럼 대소문자를 가리지 않고 견주는 자리 — 적히는 값 자체를 낮춰 둔다
  lowercase: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue"]);

const entry = ref("");
const editing = ref(null);
const draft = ref("");
const editBox = useTemplateRef("editBox");

const normalize = (text) => (props.lowercase ? text.trim().toLowerCase() : text.trim());

function commit() {
  const value = normalize(entry.value);
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

async function startEdit(i) {
  editing.value = i;
  draft.value = props.modelValue[i];
  await nextTick();
  // v-for 안의 ref는 배열로 모인다 — 지금 열린 것은 하나뿐이다
  const el = Array.isArray(editBox.value) ? editBox.value[0] : editBox.value;
  el?.select();
}

function commitEdit() {
  const i = editing.value;
  if (i == null) return;
  editing.value = null;

  const value = normalize(draft.value);
  // 비우면 지운 것으로 본다. 다른 칩과 같아지면 합쳐질 뿐이므로 그것도 지운다.
  if (!value || props.modelValue.some((item, at) => at !== i && item === value)) return removeAt(i);
  if (value === props.modelValue[i]) return;

  emit(
    "update:modelValue",
    props.modelValue.map((item, at) => (at === i ? value : item)),
  );
}

// 빈 칸에서 Backspace면 마지막 칩을 지운다 — 칩 UI의 관습이다.
function onBackspace() {
  if (entry.value !== "" || props.modelValue.length === 0) return;
  emit("update:modelValue", props.modelValue.slice(0, -1));
}
</script>
