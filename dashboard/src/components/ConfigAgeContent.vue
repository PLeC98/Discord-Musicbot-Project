<template>
  <!-- 일반 탭: 연령 제한 콘텐츠(운영자 단위). 켤 때는 무엇이 열리는지 알리고 확인을 받는다. 끄기는 바로. 저장 막대와 상관없이 곧바로 서버에 쓴다 -->
  <BaseCard icon="no_adult_content" :title="T.title">
    <label class="flex items-start gap-3 cursor-pointer">
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-semibold text-on-surface">{{ T.allow }}</span>
        <span class="block text-xs text-on-surface-variant">{{ T.allowDesc }}</span>
      </span>
      <!-- 확인창이 떠 있는 동안은 켠 쪽으로 보인다(취소하면 돌아간다) -->
      <BaseSwitch :model-value="ageContent.enabled || asking" :disabled="busy" class="mt-0.5" @update:model-value="toggle" />
    </label>
    <!-- 문단 셋: 계정 · 서버마다 틀 곳(모든 채널만 굵게) · 굵은 경고 -->
    <ConfirmDialog v-model="asking" icon="no_adult_content" :title="T.confirm.title" :confirm-label="T.confirm.run" tone="primary" :busy="busy" @confirm="turnOn">
      <span class="block">{{ T.confirm.account }}</span>
      <span class="block mt-3"
        >{{ T.confirm.placeBefore }}<strong class="font-semibold text-on-surface">{{ T.confirm.placeStrong }}</strong
        >{{ T.confirm.placeAfter }}</span
      >
      <strong class="block mt-3 font-semibold text-on-surface">{{ T.confirm.emphasis }}</strong>
    </ConfirmDialog>
  </BaseCard>
</template>

<script setup lang="ts">
import { ref } from "vue";
import BaseCard from "./BaseCard.vue";
import BaseSwitch from "./BaseSwitch.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import { ageContent, setAgeContent } from "../composables/age-content.ts";
import { text } from "../text/index.ts";
const T = text.ageContent;

const asking = ref(false);
const busy = ref(false);

async function toggle(on: boolean) {
  if (on) {
    asking.value = true;
    return;
  }
  busy.value = true;
  await setAgeContent(false);
  busy.value = false;
}

async function turnOn() {
  busy.value = true;
  await setAgeContent(true);
  busy.value = false;
  asking.value = false;
}
</script>
