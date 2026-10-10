<template>
  <div class="flex flex-col gap-(--gap-in)">
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>
    <p class="text-sm text-on-surface-variant">{{ T.desc }}</p>
    <!-- 저장했지만 다시 시작해야 적용되는 값이 있으면 그 자리에서 다시 시작한다 -->
    <NoticeBox v-if="pending.length" variant="note" tone="info" icon="restart_alt" class="mt-0!">
      <span class="flex items-center gap-3 flex-wrap"
        ><span class="flex-1 min-w-0">{{ text.restart.pending(pending.length) }}</span
        ><BotRestart :available="canRestart"
      /></span>
    </NoticeBox>

    <BaseCard v-for="group in TUNABLE_GROUPS" :key="group" :icon="T.groups[group].icon" :title="T.groups[group].title">
      <p v-if="T.groups[group].desc" class="mb-3 text-sm text-on-surface-variant">{{ T.groups[group].desc }}</p>
      <div class="grid grid-cols-1 @md/card:grid-cols-2 gap-3">
        <label v-for="one in byGroup(group)" :key="one.key" class="block min-w-0">
          <span :class="FIELD_LABEL" class="flex items-center gap-1 flex-wrap"
            ><span class="truncate">{{ T.fields[one.key]?.label ?? one.key }}</span
            ><Icon v-if="T.fields[one.key]?.help" name="info" :size="14" class="shrink-0 cursor-help" v-tooltip="T.fields[one.key]?.help" /><span v-if="pending.includes(one.key)" class="text-tertiary" v-tooltip="T.restartTip">{{ T.pending }}</span
            ><span v-else-if="one.restart" class="text-on-surface-variant/70" v-tooltip="T.restartTip">{{ T.restartBadge }}</span></span
          >
          <!-- 참 · 거짓은 스위치. 비우면(기본값) 기본값 쪽으로 보인다 -->
          <span v-if="one.kind === 'bool'" class="flex items-center gap-2 h-10">
            <BaseSwitch :model-value="boolOf(one)" :label="T.fields[one.key]?.label ?? one.key" @update:model-value="draft[one.key] = $event ? 'true' : 'false'" />
            <span class="text-sm text-on-surface">{{ boolOf(one) ? T.on : T.off }}</span>
          </span>
          <span v-else class="flex items-center gap-2">
            <span v-if="one.kind === 'color'" class="size-6 shrink-0 rounded-full border border-outline-variant" :style="{ background: draft[one.key] || one.def }"></span>
            <input :value="draft[one.key]" :inputmode="one.kind === 'int' ? 'numeric' : undefined" spellcheck="false" :placeholder="T.defaultWith(one.def)" :class="[FIELD, 'w-full min-w-0', one.kind !== 'text' && 'font-mono']" @input="draft[one.key] = valueOf($event)" />
          </span>
        </label>
      </div>
    </BaseCard>
    <SaveDock tab="settings" :dirty="dirty && loaded" :saving="saving" @save="save" @revert="reset" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import SaveDock from "./SaveDock.vue";
import BotRestart from "./BotRestart.vue";
import BaseSwitch from "./BaseSwitch.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import { FIELD, FIELD_LABEL } from "../utils/field.ts";
import { valueOf } from "../utils/dom.ts";
import { problemText } from "../utils/problem.ts";
import { trackUnsaved } from "../composables/unsaved.ts";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { TUNABLES, TUNABLE_GROUPS, type Tunable, type TunableGroup } from "../../../src/rules/tunables.ts";
import type { TunablesView } from "../../../src/dashboard/contract/admin.ts";
import { text } from "../text/index.ts";
const T = text.tunables;

/** canRestart: 실행기로 켰는가(봇 상태의 env.launcher) */
defineProps<{ canRestart: boolean }>();

const blank = () => Object.fromEntries(TUNABLES.map((one) => [one.key, ""])) as Record<string, string>;

// 저장된 값(비운 칸은 빈 글) · 고치는 중인 값 · 저장 번호 · 저장했지만 다시 켜야 먹는 이름
const saved = ref<Record<string, string>>(blank());
const draft = ref<Record<string, string>>(blank());
const revision = ref(0);
const pending = ref<string[]>([]);
const loaded = ref(false);
const loadError = ref("");
const saving = ref(false);

const byGroup = (group: TunableGroup) => TUNABLES.filter((one) => one.group === group);
const boolOf = (one: Tunable) => (draft.value[one.key] || one.def) === "true";
const dirty = computed(() => TUNABLES.some((one) => (draft.value[one.key] ?? "").trim() !== (saved.value[one.key] ?? "")));
trackUnsaved("tunables", dirty);

function apply(view: TunablesView) {
  saved.value = { ...blank(), ...view.values };
  draft.value = { ...saved.value };
  revision.value = view.revision;
  pending.value = view.pending;
  loaded.value = true;
}

const reset = () => (draft.value = { ...saved.value });

async function save() {
  saving.value = true;
  try {
    const values = Object.fromEntries(Object.entries(draft.value).filter(([, value]) => value.trim()));
    const view = (await axios.put<TunablesView>("/api/admin/tunables", { values, revision: revision.value })).data;
    apply(view);
    notifyDone(T.savedDone, view.pending.length ? T.savedRestart(view.pending.length) : "");
  } catch (err) {
    notifyProblem(err, T.saveFailed);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    apply((await axios.get<TunablesView>("/api/admin/tunables")).data);
  } catch (err) {
    loadError.value = problemText(err, T.loadFailed);
  }
});
</script>
