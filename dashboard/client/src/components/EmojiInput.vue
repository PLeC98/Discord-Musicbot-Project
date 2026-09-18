<!--
  이모지 한 글자만 담는 칸 (장르 아이콘).

  고르는 판 자체는 EmojiPicker가 갖는다. 여기서는 무엇을 눌러 여는지와,
  고른 것을 어떻게 다룰지(갈아끼우기·비우기)만 정한다.
-->
<template>
  <EmojiPicker v-slot="{ toggle }" :clearable="!!modelValue" @pick="$emit('update:modelValue', $event)" @clear="$emit('update:modelValue', '')">
    <button type="button" :class="box" v-tooltip="modelValue ? '이모지 바꾸기' : '이모지 고르기'" @click="toggle">
      <Twemoji v-if="modelValue" :char="modelValue" :size="20" />
      <Icon v-else name="add" :size="15" class="opacity-45" />
    </button>
  </EmojiPicker>
</template>

<script setup>
import Icon from "./BaseIcon.vue";
import Twemoji from "./TwemojiImage.vue";
import EmojiPicker from "./EmojiPicker.vue";

defineProps({ modelValue: { type: String, default: "" } });
defineEmits(["update:modelValue"]);

const box = "h-[38px] w-[38px] rounded-xl border border-white/9 bg-white/5 text-[1.05rem] leading-none flex items-center justify-center cursor-pointer transition-[background-color,border-color] duration-150 hover:bg-white/8";
</script>
