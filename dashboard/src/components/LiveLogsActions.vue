<template>
  <!-- 실시간 로그 탭의 설정, 파일 보기 버튼. 넓으면 제목 줄 오른쪽, 좁으면 자동 스크롤 줄에 놓인다(LiveLogs) -->
  <BaseButton variant="secondary" size="sm" @click="emit('settings')"><Icon name="settings" :size="18" class="-ml-1" />{{ T.settings }}</BaseButton>
  <!-- 지난 기록: 로그 파일 보기 페이지를 같은 창에서. 진짜 링크라 우클릭, Ctrl, 가운데 클릭으로 새 탭, 새 창 -->
  <router-link v-slot="{ href, navigate }" to="/admin/log-files" custom>
    <BaseButton variant="secondary" size="sm" class="gap-0!" :href="href" @click="navigate">{{ T.openFiles }}<Icon name="chevron_right" :size="18" class="-mr-1.5" /></BaseButton>
  </router-link>
</template>

<script setup lang="ts">
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import { text } from "../text/index.ts";

const emit = defineEmits<{ settings: [] }>();
const T = text.logs;
</script>
