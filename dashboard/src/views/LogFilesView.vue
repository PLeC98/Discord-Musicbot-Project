<template>
  <!-- 로그 파일 보기 페이지(실시간 로그 머리의 "파일 보기"가 같은 창에서 연다). 바탕화면을 창 하나로 채운다.
       위 막대 왼쪽에 실시간 로그로 돌아가는 ←(서버 설정 화면의 돌아가기와 같은 규격: PC 는 글이 붙고 휴대폰은 아이콘만).
       진짜 링크라 우클릭 · Ctrl 클릭으로 새 탭에서도 열린다. ?at=<ms> 면 그 시각으로 연다(실시간 로그의 "밀려났어요" 줄) -->
  <Teleport to="#topbar-start" defer>
    <router-link to="/admin?tab=logs" :class="TOPBAR_TEXT_BTN" :aria-label="T.back" v-tooltip="isPhone ? T.back : null"
      ><Icon name="arrow_back" /><span class="hidden md:inline text-sm font-semibold truncate">{{ T.back }}</span></router-link
    >
  </Teleport>
  <!-- 위아래 · 옆 모두 바깥 간격(운영자 화면과 같다). 카드 높이는 바탕화면 높이에서 위아래 간격을 뺀 값이라 맞물린다 -->
  <div class="min-h-full p-(--gap-out)">
    <LogFiles :initial-at="initialAt" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useMediaQuery } from "@vueuse/core";
import LogFiles from "../components/LogFiles.vue";
import Icon from "../components/BaseIcon.vue";
import { TOPBAR_TEXT_BTN } from "../utils/topbar.ts";
import { PHONE_QUERY } from "../utils/breakpoints.ts";
import { text } from "../text/index.ts";
const T = text.logs.files;

const isPhone = useMediaQuery(PHONE_QUERY);
const route = useRoute();
const initialAt = computed(() => {
  const at = Number(route.query.at);
  return Number.isFinite(at) && at > 0 ? at : undefined;
});
</script>
