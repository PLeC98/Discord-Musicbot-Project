<template>
  <!-- 권한 적용해서 보기(디스코드의 "역할 적용해서 서버 보기", 서버 판정까지 같이 낮아진다) · 유지 관리(커맨드 재배포). 넓으면 두 단. 초기화는 백업 · 초기화 탭(ConfigReset) -->
  <div class="grid grid-cols-1 xl:grid-cols-2 gap-(--gap-in) items-start">
    <BaseCard icon="visibility" :title="T.viewAs.title">
      <p class="mb-3 flex items-center gap-1 text-sm text-on-surface-variant">{{ T.viewAs.desc }}<Icon name="info" :size="16" class="shrink-0 cursor-help" v-tooltip="T.viewAs.tip" /></p>
      <div role="radiogroup" :aria-label="T.viewAs.label" class="flex flex-col gap-1">
        <button v-for="t in TIER_ROWS" :key="t.id ?? 'none'" type="button" role="radio" :aria-checked="user.viewAs === t.id" :class="[tierRow, user.viewAs === t.id && SELECT_ROW_ON]" :disabled="switchingTier" @click="pickTier(t.id)">
          <Icon :name="user.viewAs === t.id ? 'radio_button_checked' : 'radio_button_unchecked'" :size="20" class="mt-px shrink-0" :class="user.viewAs !== t.id && 'text-on-surface-variant'" />
          <span class="min-w-0">
            <span class="block text-sm">{{ t.label }}</span>
            <span class="block text-xs font-normal" :class="user.viewAs !== t.id && 'text-on-surface-variant'">{{ t.desc }}</span>
          </span>
        </button>
      </div>
    </BaseCard>

    <!-- 줄마다 이름 · 설명, 오른쪽에 하기. 좁으면 단추가 아래로 -->
    <BaseCard icon="build" :title="T.maintenance">
      <div class="flex flex-col">
        <div :class="actionRow">
          <div class="min-w-0 flex-1 basis-56">
            <p class="text-sm font-semibold text-on-surface">{{ T.redeploy.title }}</p>
            <p class="text-xs text-on-surface-variant">{{ T.redeploy.desc }}</p>
          </div>
          <BaseButton variant="secondary" :disabled="redeploying" @click="redeploy">{{ redeploying ? T.redeploy.running : T.redeploy.run }}</BaseButton>
        </div>
      </div>
    </BaseCard>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { LIMIT } from "../utils/request.ts";
import { SELECT_ROW_ON } from "../utils/select-row.ts";
import { useUserStore, VIEW_AS_TIERS } from "../stores/user.ts";
import type { RedeployReply } from "../../../src/dashboard/contract/admin.ts";
import type { Tier } from "../../../src/dashboard/contract/identity.ts";
import { text } from "../text/index.ts";
const T = text.dev;

// ── 권한 수준 오버라이드 ──────────────────────────────────────────────────────
// 계층을 바꾸면 스토어가 페이지를 다시 읽는다. 서버 목록·플레이어 권한이 통째로 달라지기 때문.
const user = useUserStore();
const switchingTier = ref(false);
// 맨 위는 오버라이드 안 함(null). 고르는 계층이 아니라 평소 상태다
const TIER_ROWS: { id: Tier | null; label: string; desc: string }[] = [{ id: null, ...T.viewAs.none }, ...VIEW_AS_TIERS];

// 라디오 줄(고른 줄은 목록 · 상세의 고른 줄과 같은 색)
const tierRow = "state-layer w-full flex items-start gap-3 text-left rounded-(--r-inner) px-3 py-2.5 text-on-surface cursor-pointer transition-[background-color,border-radius] duration-150 disabled:cursor-not-allowed disabled:opacity-38";
// 유지 관리 카드의 한 줄
const actionRow = "flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0";

async function pickTier(tier: Tier | null) {
  if (switchingTier.value || user.viewAs === tier) return;
  switchingTier.value = true;
  try {
    await user.setViewAs(tier); // 성공하면 새로고침되므로 아래로 돌아오지 않는다
  } catch (e) {
    notifyProblem(e, T.viewAs.failed);
    switchingTier.value = false;
  }
}

// ── 명령 다시 배포 ─────────────────────────────────────────
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
