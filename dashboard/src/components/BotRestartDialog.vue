<template>
  <!-- 봇 다시 시작 창(운영자 패널에 하나). 단추를 누르면 묻고, 다시 시작한 뒤에는 봇이 다시 뜰 때까지 기다리는 글로 바뀐다 -->
  <ConfirmDialog v-model="open" icon="restart_alt" tone="primary" :title="T.confirmTitle" :body="waiting ? T.waiting : T.confirmBody" :confirm-label="T.confirm" :busy="waiting" @confirm="restartNow" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import { restartPhase, restartNow, cancelRestart } from "../composables/bot-restart.ts";
import { text } from "../text/index.ts";
const T = text.restart;

const waiting = computed(() => restartPhase.value === "waiting");
// 닫기(바깥 · 취소)는 묻는 중에만 먹는다. 기다리는 중에는 창을 지킨다
const open = computed({
  get: () => restartPhase.value !== "idle",
  set: (value: boolean) => {
    if (!value) cancelRestart();
  },
});
</script>
