<template>
  <!-- 캐시 DB(운영자 패널 "캐시 DB" 탭, 계약 contract/track-cache). 2차 18단계에서 채운다(지금은 자리만, 저장 공간 카드의 "캐시 DB" 단추가 여기로 온다) -->
  <section class="pane rounded-(--r-window) p-(--pad-window) flex flex-col items-center justify-center gap-3 min-h-60 text-center text-on-surface-variant">
    <Icon name="database" :size="40" />
    <p class="text-sm">{{ T.dbNotYet }}</p>
  </section>
</template>

<script setup lang="ts">
import Icon from "./BaseIcon.vue";
import { text } from "../text/index.ts";
const T = text.admin;
</script>
