<template>
  <!-- 화면 하나를 대신하는 오류(읽기 실패 · 없는 서버 · 없는 주소). 창 하나 가운데에 아이콘 · 까닭, 아래에 할 일(slot) -->
  <AppWindow class="flex-1 items-center justify-center text-center gap-4">
    <span class="size-20 rounded-full bg-error-container text-on-error-container flex items-center justify-center"><Icon :name="icon" :size="40" /></span>
    <p class="text-base whitespace-pre-line">{{ text }}</p>
    <slot />
  </AppWindow>
</template>

<script setup lang="ts">
import AppWindow from "../shell/AppWindow.vue";
import Icon from "./BaseIcon.vue";

defineProps<{ icon: string; text: string }>();
</script>
