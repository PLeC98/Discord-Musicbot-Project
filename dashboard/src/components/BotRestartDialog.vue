<template>
  <!-- 봇 다시 시작 창(운영자 패널에 하나). 단추를 누르면 묻고, 봇이 받은 뒤에는 단추 없이 다시 뜨기를 기다린다(저장 후 다시 시작은 묻지 않고 바로 기다리기) -->
  <ConfirmDialog v-model="open" icon="restart_alt" tone="primary" :title="waiting ? T.waitingTitle : T.confirmTitle" :body="waiting ? T.waiting : T.confirmBody" :confirm-label="T.confirm" :actions="!waiting" @confirm="restartNow" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import { restartPhase, restartNow, cancelRestart } from "../composables/bot-restart.ts";
import { text } from "../text/index.ts";
const T = text.restart;

const waiting = computed(() => restartPhase.value === "waiting");
// 닫기(바깥 · 취소)는 묻는 중에만 먹는다. 보내는 중(다시 로그인일 수 있다)에는 닫혀 있고, 기다리는 중에는 창을 지킨다
const open = computed({
  get: () => restartPhase.value === "asking" || waiting.value,
  set: (value: boolean) => {
    if (!value) cancelRestart();
  },
});
</script>
