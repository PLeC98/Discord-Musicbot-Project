<template>
  <!-- 일반 탭 맨 위: 설정을 어디까지 보일지. 저장 막대와 상관없이 곧바로 바뀌고 서버에 남는다(어느 기기로 열어도 같게) -->
  <BaseCard icon="visibility" :title="T.title">
    <label class="flex items-start gap-3 cursor-pointer">
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-semibold text-on-surface">{{ T.advanced }}</span>
        <span class="block text-xs text-on-surface-variant">{{ T.advancedDesc }}</span>
        <span v-if="!showAdvanced && changedCount" class="block mt-1 text-xs text-tertiary">{{ T.changed(changedCount) }}</span>
      </span>
      <BaseSwitch :model-value="showAdvanced" class="mt-0.5" @update:model-value="setShowAdvanced" />
    </label>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import BaseCard from "./BaseCard.vue";
import BaseSwitch from "./BaseSwitch.vue";
import { setShowAdvanced, showAdvanced } from "../composables/advanced-settings.ts";
import { saved } from "../composables/tunables.ts";
import { TUNABLES, tunableValue } from "../../../src/rules/tunables.ts";
import { text } from "../text/index.ts";
const T = text.tunables.visibility;

// 기본값과 다르게 저장된 고급 항목(꺼 두면 잊기 쉽다)
const changedCount = computed(() => TUNABLES.filter((one) => one.advanced && saved.value[one.key] && tunableValue(one.key, saved.value[one.key]) !== tunableValue(one.key, one.def)).length);
</script>
