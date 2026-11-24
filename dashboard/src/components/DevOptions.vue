<template>
  <!-- 맨 위 스위치(안드로이드의 "개발자 옵션 사용", 끄면 탭이 숨는다), 권한 적용해서 보기(디스코드의 "역할 적용해서 서버 보기", 서버 판정까지 같이 낮아진다).
       커맨드 재배포는 설정 탭(ConfigCommands), 초기화는 백업, 초기화 탭(ConfigReset) -->
  <div class="grid grid-cols-1 xl:grid-cols-2 gap-(--gap-in) items-start">
    <BaseCard class="xl:col-span-2">
      <label class="flex items-start gap-3 cursor-pointer">
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-on-surface">{{ T.toggle.title }}</span>
          <span class="block text-xs text-on-surface-variant">{{ T.toggle.desc }}</span>
        </span>
        <BaseSwitch :model-value="devOptions" :disabled="switchingTier" class="mt-0.5" @update:model-value="(on) => !on && turnOff()" />
      </label>
    </BaseCard>
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
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import BaseCard from "./BaseCard.vue";
import Icon from "./BaseIcon.vue";
import BaseSwitch from "./BaseSwitch.vue";
import { devOptions, setDevOptions } from "../composables/dev-options.ts";
import { notifyProblem } from "../composables/toasts.ts";
import { SELECT_ROW_ON } from "../utils/select-row.ts";
import { useUserStore, viewAsTiers } from "../stores/user.ts";
import type { Tier } from "../../../src/dashboard/contract/identity.ts";
import { text } from "../text/index.ts";
const T = text.dev;

// ── 권한 수준 오버라이드 ──────────────────────────────────────────────────────
// 계층을 바꾸면 스토어가 페이지를 다시 읽는다. 서버 목록, 플레이어 권한이 통째로 달라지기 때문.
const user = useUserStore();
const switchingTier = ref(false);
// 맨 위는 오버라이드 안 함(null). 선택하는 계층이 아니라 평소 상태다
const TIER_ROWS = computed<{ id: Tier | null; label: string; desc: string }[]>(() => [{ id: null, ...T.viewAs.none }, ...viewAsTiers()]);

// 라디오 항목(선택한 항목은 목록, 상세의 선택한 항목과 같은 색)
const tierRow = "state-layer w-full flex items-start gap-3 text-left rounded-(--r-inner) px-3 py-2.5 text-on-surface cursor-pointer transition-[background-color,border-radius] effects disabled:cursor-not-allowed disabled:opacity-38";

// 끄면 탭을 숨기고(정보 탭으로 옮기는 것은 운영자 패널), 권한 적용해서 보기가 켜져 있으면 같이 해제한다(해제하면 새로고침된다).
// 해제하지 못하면 탭을 다시 켜고 알린다
async function turnOff() {
  setDevOptions(false);
  if (user.viewAs === null) return;
  switchingTier.value = true;
  try {
    await user.setViewAs(null);
  } catch (e) {
    setDevOptions(true);
    notifyProblem(e, T.viewAs.failed);
    switchingTier.value = false;
  }
}

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
</script>
