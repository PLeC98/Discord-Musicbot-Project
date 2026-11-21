<template>
  <!-- 봇 다시 시작 창(운영자 패널에 하나). 묻는 동안: 이유(있으면), 재생 중인 서버 수와 그 재생이 잠시 끊긴다는 안내, 진행 중인 설치 작업이 중단된다는 안내, 공지 스위치(기본 켬).
       재생 중인 서버가 없으면 스위치를 숨기고 알리지 않는다(수를 읽는 중이거나 읽지 못했으면 스위치를 보인다. 봇은 재생 중인 서버에만 보낸다).
       봇이 받은 뒤에는 버튼 없이 다시 뜨기를 기다린다.
       이유가 bgutil(POToken 서버 사용을 켰는데 bgutil이 없다)이면: 설치 중이면 "설치 후 다시 시작"을 묻고(설치가 끝날 때 다시 시작하므로 공지 스위치는 늘 보인다),
       설치할 수 없으면(없는 프로그램, 실패) 그 안내와 함께 "그래도 다시 시작"을 묻는다 -->
  <ConfirmDialog v-model="open" icon="restart_alt" tone="primary" :title="title" :confirm-label="confirmLabel" :cancel-label="T.later" :actions="!waiting" @confirm="confirm">
    <template v-if="waiting">{{ T.waiting }}</template>
    <template v-else>
      <template v-if="bgutilAsk === 'install'"
        ><span class="block mb-2">{{ B.dialog.installBody }}</span></template
      >
      <template v-else-if="bgutilAsk === 'cannot'"
        ><span class="block mb-2"
          ><BgutilNeeds v-if="restartBgutil?.missing?.length" :needs="restartBgutil.missing" /><span v-else-if="restartBgutil?.failure" class="block wrap-break-word">{{ B.failed(restartBgutil.failure.reason) }}</span
          ><span class="block mt-2">{{ B.dialog.cannotBody }}</span></span
        ></template
      >
      <span v-else-if="restartReason && restartReason !== 'bgutil'" class="block mb-2">{{ T.reasons[restartReason] }}</span
      >{{ T.confirmBody(restartCounts) }}
      <span v-if="installName && bgutilAsk !== 'install'" class="block mt-2">{{ T.installStops(installName) }}</span>
      <!-- 설정 행처럼 글은 왼쪽, 스위치는 오른쪽 끝 -->
      <label v-if="showAnnounce" class="mt-4 flex items-center justify-between gap-4 text-left text-on-surface cursor-pointer">{{ T.announce }}<BaseSwitch v-model="announce" /></label>
    </template>
  </ConfirmDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import BaseSwitch from "./BaseSwitch.vue";
import BgutilNeeds from "./BgutilNeeds.vue";
import { restartPhase, restartReason, restartCounts, restartBgutil, restartNow, restartAfterInstall, cancelRestart } from "../composables/bot-restart.ts";
import { text } from "../text/index.ts";
import type { Job } from "../../../src/infra/process-job.ts";
const T = text.restart;
const B = text.bgutil;

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
// bgutil 물음: install(설치 중이라 끝나면 다시 시작), cannot(설치할 수 없다), 아니면 null
const bgutilAsk = computed<"install" | "cannot" | null>(() => {
  if (restartReason.value !== "bgutil" || !restartBgutil.value) return null;
  return restartBgutil.value.job !== null ? "install" : "cannot";
});
const title = computed(() => {
  if (waiting.value) return T.waitingTitle;
  if (bgutilAsk.value === "install") return B.dialog.installTitle;
  return bgutilAsk.value === "cannot" ? B.dialog.cannotTitle : T.confirmTitle;
});
const confirmLabel = computed(() => (bgutilAsk.value === "install" ? B.dialog.installConfirm : bgutilAsk.value === "cannot" ? B.dialog.cannotConfirm : T.confirm));
// 설치 후 다시 시작은 몇 분 뒤에 다시 시작하므로 지금 재생 중인 서버가 없어도 공지 스위치를 보인다
const showAnnounce = computed(() => bgutilAsk.value === "install" || restartCounts.value?.playing !== 0);
function confirm() {
  if (bgutilAsk.value === "install") void restartAfterInstall(announce.value);
  else void restartNow(showAnnounce.value && announce.value);
}
// 봇 상태 탭의 작업 이름을 그대로 쓴다
const INSTALL_NAMES = computed<Partial<Record<Job, string>>>(() => ({ "ffmpeg-install": text.status.jobs.ffmpegInstall, "bgutil-install": text.status.jobs.bgutilInstall }));
const installName = computed(() => {
  const job = restartCounts.value?.installJob;
  return job ? (INSTALL_NAMES.value[job] ?? job) : null;
});
</script>
