<template>
  <!-- 봇이 있는 채널 밖에서는 서버가 조작을 막는다(checkVoice). 버튼을 하나씩 비활성으로 두는 대신
       플레이어를 통째로 가리고(상위 컴포넌트에서 블러 처리한다) 이유를 한 번에 알린다. 서버 관리자는 면제라 여기 걸리지 않는다 -->
  <div class="absolute inset-0 flex items-center justify-center p-4">
    <div class="rounded-xl bg-surface-container-highest px-4 py-3 flex items-center gap-3 max-w-sm">
      <span class="size-9 shrink-0 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center"><Icon name="headphones" :size="24" /></span>
      <span class="text-sm font-medium">{{ noticeText("must-be-in-same-voice").title }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from "./BaseIcon.vue";
import { noticeText } from "../utils/problem.ts";
</script>
