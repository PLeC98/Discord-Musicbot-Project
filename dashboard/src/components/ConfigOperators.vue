<template>
  <!-- 설정 탭: 봇 운영자. 현재 운영자와 그 출처(앱 정보, OWNER_ID)를 보여 주고, 팀 앱이면 운영자로 볼 팀원의 범위를 고른다(팀 소유자만). 고른 범위는 저장 바로 저장한다 -->
  <BaseCard :icon="TG.icon" :title="TG.title">
    <template v-if="view?.teamId" #actions
      ><BaseButton variant="secondary" size="sm" :href="teamPage(view.teamId)" target="_blank" rel="noopener"><Icon name="open_in_new" :size="16" />{{ T.teamInfo }}</BaseButton></template
    >
    <p class="mb-3 text-sm text-on-surface-variant">{{ T.desc }}</p>
    <!-- 넓으면 현재 운영자와 범위를 한 줄에(범위가 없으면 운영자가 줄을 다 쓴다) -->
    <div v-if="view" class="grid grid-cols-1 gap-3 @md/card:grid-cols-2">
      <div class="min-w-0" :class="view.kind !== 'team' && '@md/card:col-span-2'">
        <span :class="FIELD_LABEL">{{ T.current }}</span>
        <!-- 비활성 드롭다운과 같은 면(면 불투명도 38%, 한 줄이면 높이 40px, 내용이 많으면 늘어난다). 글자는 흐리게 하지 않는다 -->
        <p class="min-h-10 rounded-(--r-inner) border border-transparent bg-surface-container-highest/38 px-4 py-2.5 text-sm leading-5 break-words text-on-surface">{{ view.operators.map((one) => one.name).join(", ") || "-" }}</p>
        <p v-if="view.source === 'override'" class="mt-1 text-xs text-on-surface-variant">{{ T.fromOverride }}</p>
        <p v-if="view.stale" class="mt-1 text-xs text-(--warn-ink)">{{ T.stale }}</p>
        <p v-if="view.kind === null && view.lock" class="mt-1 text-xs text-on-surface-variant">{{ T.locks[view.lock] }}</p>
      </div>
      <div v-if="view.kind === 'team'" class="min-w-0">
        <span :class="FIELD_LABEL">{{ T.scopeLabel }}</span>
        <SingleSelect v-model="draft" :options="SCOPES" :disabled="Boolean(view.lock) || busy" />
        <p v-if="view.lock" class="mt-1 text-xs text-on-surface-variant">{{ T.locks[view.lock] }}</p>
        <p v-else-if="draft !== 'owner'" class="mt-1 text-xs text-on-surface-variant">{{ T.widenNote }}</p>
      </div>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import axios from "axios";
import BaseButton from "./BaseButton.vue";
import BaseCard from "./BaseCard.vue";
import Icon from "./BaseIcon.vue";
import SingleSelect from "./SingleSelect.vue";
import { FIELD_LABEL } from "../utils/field.ts";
import type { Option } from "../utils/options.ts";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { OPERATOR_SCOPES } from "../../../src/rules/app-owners.ts";
import type { OperatorsView, ScopeSaved } from "../../../src/dashboard/contract/operators.ts";
import { applyCard } from "../composables/tunables.ts";
import { useSaveTarget } from "../composables/save-targets.ts";
import { text } from "../text/index.ts";
const T = text.tunables.operators;
const TG = text.tunables.groups.operators;

// 디스코드 개발자 포털의 팀 페이지
const teamPage = (id: string) => `https://discord.com/developers/teams/${encodeURIComponent(id)}/information`;

const SCOPES = computed<Option[]>(() => OPERATOR_SCOPES.map((value) => ({ value, label: T.scopes[value] })));

const view = ref<OperatorsView | null>(null);
// 고르는 중인 범위. 저장 바에서 저장하면 서버에 쓴다
const draft = ref("owner");
const busy = ref(false);

function show(next: OperatorsView) {
  view.value = next;
  draft.value = next.scope;
}

onMounted(async () => {
  try {
    show((await axios.get<OperatorsView>("/api/admin/operators")).data);
  } catch (e) {
    notifyProblem(e, T.loadFailed);
  }
});

// 고른 범위를 저장한다(성공하면 true). 화면에 불러온 범위를 함께 보내 그사이 다른 곳에서 바꿨으면 거절된다
async function save(): Promise<boolean> {
  const scope = draft.value;
  if (!view.value || scope === view.value.scope) return true;
  busy.value = true;
  try {
    const { data } = await axios.put<ScopeSaved>("/api/admin/operators/scope", { scope, expect: view.value.scope });
    show(data.operators);
    // 범위는 운영 설정값에 저장된다. 저장 바의 다음 저장이 충돌로 거절되지 않게 저장 번호를 맞춘다
    applyCard(data.tunables);
    notifyDone(T.saved);
    return true;
  } catch (e) {
    notifyProblem(e, T.saveFailed);
    return false;
  } finally {
    busy.value = false;
  }
}

// 저장 바에 올린다. 운영 설정값 카드와 같은 설정 탭이고, 범위는 잠기지 않았을 때만 고칠 수 있다
useSaveTarget({
  tab: "settings",
  dirty: computed(() => Boolean(view.value) && draft.value !== view.value!.scope),
  saving: busy,
  save,
  revert: () => {
    if (view.value) draft.value = view.value.scope;
  },
});
</script>
