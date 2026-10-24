<template>
  <!-- 로그인 창(다시 로그인)의 끝. 원래 탭에 알리고 창을 닫는다. 브라우저가 닫기를 막으면(직접 연 탭 등) 닫아 달라고 적는다 -->
  <div class="min-h-dvh flex items-center justify-center p-6 text-center">
    <div class="flex flex-col items-center gap-3">
      <span class="size-12 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center"><Icon name="check_circle" :size="24" fill /></span>
      <h1 class="text-xl font-round font-semibold text-on-surface">{{ T.loginDoneTitle }}</h1>
      <p class="text-sm text-on-surface-variant">{{ T.loginDoneBody }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import Icon from "../components/BaseIcon.vue";
import { announceSignedIn } from "../composables/session.ts";
import { text } from "../text/index.ts";
const T = text.shell;

onMounted(() => {
  announceSignedIn();
  window.close();
});
</script>
