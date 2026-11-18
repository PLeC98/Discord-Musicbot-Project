<template>
  <!-- bgutil(POToken 공급자) 카드(업데이트 탭). 공유 타입 sources/bgutil/status-types. 설치된 버전과 POToken 서버 사용(켜기는 유튜브 탭의 설정값이라 여기서는 보이기만),
       설치 진행(설치 중, 다른 작업 뒤로 미룸), 설치 뒤 다시 시작 예약과 그 취소, 실패와 없는 프로그램의 안내와 재시도, 다시 시작해야 적용될 때의 다시 시작.
       상태는 도구 라우트(/api/admin/vendor)를 다시 읽는다. 운영자 패널이 업데이트 탭을 보이는 동안 폴링으로 부른다(설치는 백그라운드에서 끝난다) -->
  <BaseCard icon="key" :title="T.title">
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>
    <template v-else-if="state">
      <dl class="flex flex-col gap-2 text-sm">
        <div class="flex items-baseline justify-between gap-3">
          <dt class="shrink-0 text-on-surface-variant">{{ T.installed }}</dt>
          <dd class="min-w-0 text-right">
            <span class="block truncate" :class="state.installed ? 'font-mono' : 'text-on-surface-variant'">{{ state.installed ? `${state.installed.tag}` : T.notInstalled }}</span>
            <span v-if="servingDiffers && state.serving" class="block text-xs text-on-surface-variant">{{ T.serving(state.serving.tag) }}</span>
          </dd>
        </div>
        <div class="flex items-baseline justify-between gap-3">
          <dt class="shrink-0 text-on-surface-variant">{{ T.use }}</dt>
          <dd class="min-w-0 text-right">{{ state.enabled ? T.on : T.off }}</dd>
        </div>
      </dl>

      <!-- 진행: 설치 중, 미룸. 설치 중이고 다시 시작할 수 있으면 설치 후 다시 시작(예약했으면 그 안내와 취소) -->
      <NoticeBox v-if="state.job" variant="note" tone="notice" icon="schedule">
        <span class="flex items-start gap-3 flex-wrap"
          ><span class="flex-1 min-w-0"
            >{{ state.job === "running" ? T.installing : T.queued }}<span v-if="state.restartReserved" class="block">{{ T.reserved }}</span></span
          ><BaseButton v-if="state.restartReserved" variant="secondary" size="sm" class="-my-1.5" :disabled="working" @click="unreserve">{{ T.unreserve }}</BaseButton
          ><BaseButton v-else-if="canRestart" variant="secondary" size="sm" class="-my-1.5" :disabled="working" @click="askRestart('bgutil', state)">{{ T.installThenRestart }}</BaseButton></span
        >
      </NoticeBox>
      <!-- 실패, 없는 프로그램: 그 안내와 재시도(켜져 있을 때만. 꺼져 있으면 설치하지 않는다) -->
      <NoticeBox v-else-if="state.enabled && !state.installed && (state.missing?.length || state.failure)" variant="note" tone="error" icon="error">
        <span class="flex items-start gap-3 flex-wrap"
          ><span class="flex-1 min-w-0 wrap-break-word"
            ><BgutilNeeds v-if="state.missing?.length" :needs="state.missing" /><template v-else-if="state.failure">{{ T.failed(state.failure.reason) }}</template></span
          ><BaseButton variant="secondary" size="sm" class="-my-1.5" :disabled="working" @click="retry">{{ T.retry }}</BaseButton></span
        >
      </NoticeBox>
      <NoticeBox v-else-if="state.restartNeeded" variant="note" tone="notice" icon="restart_alt">
        <span class="flex items-start gap-3 flex-wrap"
          ><span class="flex-1 min-w-0">{{ T.restartToApply }}</span
          ><BaseButton v-if="canRestart" variant="secondary" size="sm" class="-my-1.5" @click="askRestart()">{{ T.restart }}</BaseButton></span
        >
      </NoticeBox>
    </template>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import NoticeBox from "./NoticeBox.vue";
import BgutilNeeds from "./BgutilNeeds.vue";
import { askRestart } from "../composables/bot-restart.ts";
import { notifyProblem } from "../composables/toasts.ts";
import { problemText } from "../utils/problem.ts";
import type { VendorReply } from "../../../src/dashboard/contract/admin.ts";
import type { BgutilCardStatus } from "../../../src/sources/bgutil/status-types.ts";
import { text } from "../text/index.ts";
const T = text.bgutil;

const BASE = "/api/admin/vendor";

/** canRestart: 실행기로 켠 봇이라 대시보드에서 다시 시작할 수 있다 */
const props = defineProps<{ canRestart: boolean }>();

const state = ref<BgutilCardStatus | null>(null);
const loadError = ref("");
const working = ref(false);
let reading = false;

const canRestart = computed(() => props.canRestart);
// 설치된 것과 이 봇이 쓰는 것이 다르다(그사이 설치했다)
const servingDiffers = computed(() => Boolean(state.value?.installed && state.value.serving && state.value.installed.tag !== state.value.serving.tag));

/** 상태를 다시 읽는다. 운영자 패널이 업데이트 탭을 보이는 동안 폴링으로 부른다 */
async function refresh() {
  if (reading) return;
  reading = true;
  try {
    state.value = (await axios.get<VendorReply>(BASE)).data.status.bgutil;
    loadError.value = "";
  } catch (err) {
    if (!state.value) loadError.value = problemText(err, T.loadFailed);
  } finally {
    reading = false;
  }
}

async function send(method: "post" | "delete", path: string, failed: string) {
  working.value = true;
  try {
    state.value = (await axios.request<VendorReply>({ method, url: `${BASE}${path}` })).data.status.bgutil;
  } catch (err) {
    notifyProblem(err, failed);
  } finally {
    working.value = false;
  }
}

const retry = () => send("post", "/bgutil/install", T.retryFailed);
const unreserve = () => send("delete", "/bgutil/restart-after-install", T.unreserveFailed);

onMounted(() => void refresh());
defineExpose({ refresh });
</script>
