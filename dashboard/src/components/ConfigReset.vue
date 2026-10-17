<template>
  <!-- 초기화(운영자 패널 백업 · 초기화 탭). 줄마다 이름 · 설명, 오른쪽에 하기. 좁으면 단추가 아래로. 지금은 캐시 초기화 하나 -->
  <!-- 뿌리 하나(받은 class 가 카드 쪽에 붙게) -->
  <div>
    <BaseCard icon="delete_sweep" :title="T.title">
      <div class="flex flex-col">
        <div :class="actionRow">
          <div class="min-w-0 flex-1 basis-56">
            <p class="text-sm font-semibold text-on-surface">{{ T.cache.title }}</p>
            <p class="text-xs text-on-surface-variant">{{ T.cache.desc }}</p>
          </div>
          <BaseButton variant="ghost" class="text-error!" :disabled="resetting" @click="confirmReset = true">{{ resetting ? T.cache.running : T.cache.run }}</BaseButton>
        </div>
      </div>
    </BaseCard>

    <ConfirmDialog v-model="confirmReset" icon="delete" :title="T.cache.confirmTitle" :body="T.cache.confirmBody" :confirm-label="T.cache.confirm" :busy="resetting" @confirm="resetCache" />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { LIMIT } from "../utils/request.ts";
import type { ResetReply } from "../../../src/dashboard/contract/admin.ts";
import { text } from "../text/index.ts";
const T = text.reset;

// 한 줄
const actionRow = "flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0";

// ── 캐시 초기화 ───────────────────────────────────────────────
const confirmReset = ref(false);
const resetting = ref(false);

// 지운 것 · 남긴 것(재생 중)
function resetSummary(r: ResetReply) {
  const mb = Math.round((r.freedBytes || 0) / 1024 / 1024);
  return T.cache.summary(r.removed, mb, r.kept);
}

async function resetCache() {
  if (resetting.value) return;
  resetting.value = true;
  try {
    const { data } = await axios.post<ResetReply>("/api/admin/reset-cache", undefined, { timeout: LIMIT.long });
    notifyDone(T.cache.done, resetSummary(data));
  } catch (e) {
    notifyProblem(e, T.cache.failed);
  } finally {
    resetting.value = false;
    confirmReset.value = false;
  }
}
</script>
