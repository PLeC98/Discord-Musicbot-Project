<template>
  <!-- 좁은 화면의 거르기 버튼(누르면 거르기 창). 찾기 칸과 한 줄에 둔다. 기본값에서 바꾼 거르기가 있으면 그 수를 배지로 -->
  <button type="button" class="tap state-layer shrink-0 h-10 pl-3 pr-4 rounded-(--r-inner) bg-surface-container-highest flex items-center gap-1.5 text-sm font-medium cursor-pointer" :aria-label="count ? T.filterApplied(count) : T.filter" @click="emit('open')">
    <Icon name="tune" :size="20" />{{ T.filter }}
    <span v-if="count" class="min-w-5 h-5 px-1.5 rounded-full bg-primary text-on-primary text-2xs font-semibold nums flex items-center justify-center">{{ count }}</span>
  </button>
</template>

<script setup lang="ts">
import Icon from "./BaseIcon.vue";
import { text } from "../text/index.ts";
const T = text.fields;

defineProps<{ count: number }>();
const emit = defineEmits<{ open: [] }>();
</script>
