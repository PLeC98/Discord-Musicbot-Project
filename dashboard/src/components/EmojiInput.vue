<!--
  이모지 한 글자만 담는 입력란 (장르 아이콘).

  목록 영역 자체는 EmojiPicker가 갖는다. 여기서는 무엇을 눌러 여는지와,
  선택한 것을 어떻게 다룰지(교체·비우기)만 정한다.
-->
<template>
  <EmojiPicker v-slot="{ toggle }" :clearable="!!modelValue" @pick="$emit('update:modelValue', $event)" @clear="$emit('update:modelValue', '')">
    <button type="button" :class="box" v-tooltip="modelValue ? text.fields.emojiChange : text.fields.emojiPick" @click="toggle">
      <Twemoji v-if="modelValue" :char="modelValue" :size="24" />
      <Icon v-else name="add" :size="20" class="text-on-surface-variant" />
    </button>
  </EmojiPicker>
</template>

<script setup lang="ts">
import Icon from "./BaseIcon.vue";
import Twemoji from "./TwemojiImage.vue";
import EmojiPicker from "./EmojiPicker.vue";
import { text } from "../text/index.ts";

withDefaults(defineProps<{ modelValue?: string }>(), { modelValue: "" });
defineEmits<{ "update:modelValue": [value: string] }>();

const box = "state-layer size-10 shrink-0 rounded-(--r-inner) bg-surface-container-highest flex items-center justify-center cursor-pointer";
</script>
