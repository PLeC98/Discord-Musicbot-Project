<template>
  <!-- 봇 다시 시작 단추와 확인 창. 봇 상태 탭 머리 · 설정 탭의 "다시 시작해야 적용" 알림이 함께 쓴다.
       받으면 봇이 내려갔다 다시 뜬다(실행기가 다시 띄운다). 새 프로세스(pid)가 답할 때까지 창을 열어 두고, 뜨면 화면을 새로 고친다 -->
  <span class="shrink-0" v-tooltip="available ? null : T.unavailable">
    <BaseButton variant="secondary" size="sm" :disabled="!available" @click="open = true"><Icon name="restart_alt" :size="18" />{{ T.button }}</BaseButton>
  </span>
  <ConfirmDialog v-model="open" icon="restart_alt" tone="primary" :title="T.confirmTitle" :body="waiting ? T.waiting : T.confirmBody" :confirm-label="T.confirm" :busy="busy" @confirm="restart" />
</template>

<script setup lang="ts">
import { ref } from "vue";
import axios from "axios";
import BaseButton from "./BaseButton.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import Icon from "./BaseIcon.vue";
import { notify, notifyProblem } from "../composables/toasts.ts";
import type { AdminStatus, RestartReply } from "../../../src/dashboard/contract/admin.ts";
import { text } from "../text/index.ts";
const T = text.restart;

/** available: 실행기로 켰는가(봇 상태의 env.launcher). 아니면 단추를 막고 까닭을 툴팁으로 */
defineProps<{ available: boolean }>();

// 다시 뜨기를 기다리는 상한과 묻는 간격. 기동은 보통 몇 초, POToken 서버가 늦으면 30초 남짓
const WAIT_MS = 120_000;
const POLL_MS = 1500;

const open = ref(false);
const busy = ref(false);
const waiting = ref(false);

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const pidNow = async () => (await axios.get<AdminStatus>("/api/admin/status", { timeout: 3000 })).data.env.pid;

// 새 프로세스가 답하면 true. 내려가 있는 동안의 실패는 기다린다
async function cameBack(before: number) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    try {
      if ((await pidNow()) !== before) return true;
    } catch {
      // 아직 내려가 있다
    }
  }
  return false;
}

async function restart() {
  busy.value = true;
  try {
    const before = await pidNow();
    await axios.post<RestartReply>("/api/admin/restart");
    waiting.value = true;
    if (await cameBack(before)) {
      // 새 봇이 새 화면을 줄 수 있다(빌드를 바꾼 뒤 다시 시작했을 때)
      location.reload();
      return;
    }
    notify({ title: T.timeoutTitle, body: T.timeoutBody });
  } catch (err) {
    notifyProblem(err, T.failed);
  }
  busy.value = false;
  waiting.value = false;
  open.value = false;
}
</script>
