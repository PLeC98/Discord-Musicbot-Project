<template>
  <!-- 봇 다시 시작 창(운영자 패널에 하나). 묻는 동안: 까닭(있으면), 재생이 잠깐 끊긴다는 안내, 재생 중인 서버 수와 공지 스위치(기본 켬).
       재생 중인 서버가 없으면 스위치를 숨기고 알리지 않는다(수를 읽는 중이거나 읽지 못했으면 스위치를 보인다. 봇은 재생 중인 서버에만 보낸다).
       봇이 받은 뒤에는 버튼 없이 다시 뜨기를 기다린다 -->
  <ConfirmDialog v-model="open" icon="restart_alt" tone="primary" :title="waiting ? T.waitingTitle : T.confirmTitle" :confirm-label="T.confirm" :cancel-label="T.later" :actions="!waiting" @confirm="restartNow(showAnnounce && announce)">
    <template v-if="waiting">{{ T.waiting }}</template>
    <template v-else>
      <span v-if="restartReason" class="block mb-2">{{ T.reasons[restartReason] }}</span
      >{{ T.confirmBody }}
      <span v-if="restartPlaying" class="block mt-2">{{ T.playing(restartPlaying) }}</span>
      <!-- 설정 행처럼 글은 왼쪽, 스위치는 오른쪽 끝 -->
      <label v-if="showAnnounce" class="mt-4 flex items-center justify-between gap-4 text-left text-on-surface cursor-pointer">{{ T.announce }}<BaseSwitch v-model="announce" /></label>
    </template>
  </ConfirmDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import BaseSwitch from "./BaseSwitch.vue";
import { restartPhase, restartReason, restartPlaying, restartNow, cancelRestart } from "../composables/bot-restart.ts";
import { text } from "../text/index.ts";
const T = text.restart;

const waiting = computed(() => restartPhase.value === "waiting");
// 닫기(바깥, 나중에)는 묻는 중에만 된다. 보내는 중(다시 로그인일 수 있다)에는 닫혀 있고, 기다리는 중에는 창을 지킨다
const open = computed({
  get: () => restartPhase.value === "asking" || waiting.value,
  set: (value: boolean) => {
    if (!value) cancelRestart();
  },
});

const announce = ref(true);
watch(restartPhase, (phase) => phase === "asking" && (announce.value = true));
const showAnnounce = computed(() => restartPlaying.value !== 0);
</script>
