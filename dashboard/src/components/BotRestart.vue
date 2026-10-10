<template>
  <!-- 봇 다시 시작 단추(봇 상태 탭 머리). 묻는 창은 운영자 패널에 하나(BotRestartDialog) -->
  <span class="shrink-0" v-tooltip="available ? null : T.unavailable">
    <BaseButton variant="secondary" size="sm" :disabled="!available" @click="askRestart"><Icon name="restart_alt" :size="18" />{{ T.button }}</BaseButton>
  </span>
</template>

<script setup lang="ts">
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import { askRestart } from "../composables/bot-restart.ts";
import { text } from "../text/index.ts";
const T = text.restart;

/** available: 실행기로 켰는가(봇 상태의 env.launcher). 아니면 단추를 막고 까닭을 툴팁으로 */
defineProps<{ available: boolean }>();
</script>
