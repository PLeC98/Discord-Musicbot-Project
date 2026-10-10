<template>
  <!-- 창 · 카드의 머리 한 벌: 아이콘 배지(36) · 제목 · (badge) · 오른쪽 끝 조작. 창 · 카드 · 실시간 로그가 같이 쓴다.
       간격 기준: 배지(20 이상의 앞머리) ↔ 제목 12, 조작 사이 8. 위로 4 당겨 배지가 창 여백 안쪽 모서리와 맞게(-mt-1). 아래 간격은 쓰는 쪽이 준다 -->
  <header class="flex items-center gap-3 h-10 -mt-1">
    <span v-if="icon" class="size-9 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0"><Icon :name="icon" :size="20" /></span>
    <h2 v-if="title" class="text-lg font-semibold text-on-surface truncate">{{ title }}</h2>
    <slot name="badge" />
    <div v-if="$slots.actions" class="ml-auto shrink-0 flex items-center gap-2"><slot name="actions" /></div>
  </header>
</template>

<script setup lang="ts">
import Icon from "./BaseIcon.vue";
import type { IconName } from "../icons.ts";

withDefaults(defineProps<{ title?: string; icon?: IconName }>(), { title: "" });
</script>
