<template>
  <!-- 설정 탭: 봇 운영자. 지금 운영자와 정한 곳을 보여 주고, 팀 앱이면 운영자로 볼 팀원의 범위를 고른다(팀 소유자만). 저장 바와 상관없이 곧바로 서버에 쓴다 -->
  <BaseCard :icon="TG.icon" :title="TG.title">
    <p class="mb-3 text-sm text-on-surface-variant">{{ T.desc }}</p>
    <template v-if="view">
      <span :class="FIELD_LABEL">{{ T.current }}</span>
      <p class="text-sm text-on-surface">
        {{ view.operators.map((one) => one.name).join(", ") || "-" }}<span v-if="view.source === 'override'" class="ml-2 text-xs text-on-surface-variant">{{ T.fromOverride }}</span>
      </p>
      <p v-if="view.stale" class="mt-1 text-xs text-(--warn-ink)">{{ T.stale }}</p>
      <div v-if="view.kind === 'team'" class="mt-4 min-w-0">
        <span :class="FIELD_LABEL">{{ T.scopeLabel }}</span>
        <SingleSelect :model-value="view.scope" :options="SCOPES" :disabled="Boolean(view.lock) || busy" @update:model-value="change(String($event))" />
        <p v-if="view.lock" class="mt-1 text-xs text-on-surface-variant">{{ T.locks[view.lock] }}</p>
        <p v-else class="mt-1 text-xs text-on-surface-variant">{{ T.widenNote }}</p>
      </div>
    </template>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import SingleSelect from "./SingleSelect.vue";
import { FIELD_LABEL } from "../utils/field.ts";
import type { Option } from "../utils/options.ts";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { OPERATOR_SCOPES } from "../../../src/rules/app-owners.ts";
import type { OperatorsView } from "../../../src/dashboard/contract/operators.ts";
import { text } from "../text/index.ts";
const T = text.tunables.operators;
const TG = text.tunables.groups.operators;

const SCOPES = computed<Option[]>(() => OPERATOR_SCOPES.map((value) => ({ value, label: T.scopes[value] })));

const view = ref<OperatorsView | null>(null);
const busy = ref(false);

onMounted(async () => {
  try {
    view.value = (await axios.get<OperatorsView>("/api/admin/operators")).data;
  } catch (e) {
    notifyProblem(e, T.loadFailed);
  }
});

// 고르면 곧바로 서버에 쓴다. 화면에 불러온 범위를 함께 보내 그사이 다른 곳에서 바꿨으면 거절된다
async function change(scope: string) {
  if (!view.value || scope === view.value.scope) return;
  busy.value = true;
  try {
    view.value = (await axios.put<OperatorsView>("/api/admin/operators/scope", { scope, expect: view.value.scope })).data;
    notifyDone(T.saved);
  } catch (e) {
    notifyProblem(e, T.saveFailed);
  } finally {
    busy.value = false;
  }
}
</script>
