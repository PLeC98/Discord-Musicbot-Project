<template>
  <!-- 디스코드 명령. 누르면 곧바로 하는 일이라 저장 막대와 상관없다. 항목마다 이름 · 설명, 오른쪽에 하기. 좁으면 버튼이 아래로 -->
  <BaseCard icon="terminal" :title="T.title">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div class="min-w-0 flex-1 basis-56">
        <p class="text-sm font-semibold text-on-surface">{{ T.redeploy.title }}</p>
        <p class="text-xs text-on-surface-variant">{{ T.redeploy.desc }}</p>
      </div>
      <BaseButton variant="secondary" :disabled="redeploying" @click="redeploy">{{ redeploying ? T.redeploy.running : T.redeploy.run }}</BaseButton>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import { ref } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { LIMIT } from "../utils/request.ts";
import type { RedeployReply } from "../../../src/dashboard/contract/admin.ts";
import { text } from "../text/index.ts";
const T = text.commands;

const redeploying = ref(false);

async function redeploy() {
  if (redeploying.value) return;
  redeploying.value = true;
  try {
    const { data } = await axios.post<RedeployReply>("/api/admin/redeploy-commands", undefined, { timeout: LIMIT.long });
    notifyDone(T.redeploy.done, T.redeploy.summary(data.count, data.scope === "guild"));
  } catch (e) {
    notifyProblem(e, T.redeploy.failed);
  } finally {
    redeploying.value = false;
  }
}
</script>
