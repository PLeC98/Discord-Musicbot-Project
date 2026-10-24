<!--
  AI 보조 · 고급 설정: 요청 · 재시도와 리퀘스트 로그의 기록 설정(운영 조절값 ailog 그룹). 운영자 패널의 "고급 설정 보기"를 켰을 때만 목록에 있다.
  상태는 composables/ai-editor(ConfigAI 가 내려 준다).
-->
<template>
  <BaseCard icon="replay" :title="TA.title">
    <div class="flex flex-col gap-4">
      <p class="text-sm text-on-surface-variant">{{ TA.desc }}</p>
      <div class="grid grid-cols-2 @xl/card:grid-cols-3 gap-3">
        <label class="block">
          <span :class="FIELD_LABEL" v-tooltip="TA.timeoutTip">{{ TA.timeout }}</span>
          <NumberInput v-model="timeoutSec" :placeholder="defaultSec('timeoutMs')" :class="[FIELD, 'w-full']" />
        </label>
        <label class="block">
          <span :class="FIELD_LABEL" v-tooltip="TA.retriesTip">{{ TA.retries }}</span>
          <NumberInput v-model="draft.retries" :placeholder="defaultOf('retries')" :class="[FIELD, 'w-full']" />
        </label>
        <label class="block">
          <span :class="FIELD_LABEL" v-tooltip="TA.totalTip">{{ TA.total }}</span>
          <NumberInput v-model="totalSec" :placeholder="defaultSec('totalTimeoutMs')" :class="[FIELD, 'w-full']" />
        </label>
        <label class="block">
          <span :class="FIELD_LABEL" v-tooltip="TA.delayTip">{{ TA.delay }}</span>
          <NumberInput v-model="delaySec" decimal :placeholder="defaultSec('retryDelayMs')" :class="[FIELD, 'w-full']" />
        </label>
        <label class="block">
          <span :class="FIELD_LABEL" v-tooltip="TA.delayMaxTip">{{ TA.delayMax }}</span>
          <NumberInput v-model="delayMaxSec" decimal :placeholder="defaultSec('retryDelayMaxMs')" :class="[FIELD, 'w-full']" />
        </label>
        <label class="flex items-center gap-2 cursor-pointer self-end h-10">
          <BaseSwitch v-model="draft.retryTimeouts" />
          <span class="text-sm text-on-surface">{{ TA.retryTimeouts }}</span>
        </label>
      </div>
      <label class="block">
        <span :class="FIELD_LABEL" v-tooltip="TA.retryStatusTip">{{ TA.retryStatus }}</span>
        <ChipInput :model-value="(draft.retryStatus ?? []).map(String)" :placeholder="defaultOf('retryStatus')" @update:model-value="setRetryStatus" />
      </label>
    </div>
  </BaseCard>

  <ConfigTunables :groups="['ailog']" tab="ai" :can-restart="false" />
</template>

<script setup lang="ts">
import BaseCard from "./BaseCard.vue";
import ConfigTunables from "./ConfigTunables.vue";
import NumberInput from "./NumberInput.vue";
import ChipInput from "./ChipInput.vue";
import { FIELD, FIELD_LABEL } from "../utils/field.ts";
import BaseSwitch from "./BaseSwitch.vue";
import { text } from "../text/index.ts";
import { useAiEditor } from "../composables/ai-editor.ts";
const TA = text.ai.advanced;

const { draft, timeoutSec, totalSec, delaySec, delayMaxSec, defaultOf, defaultSec, setRetryStatus } = useAiEditor();
</script>
