<template>
  <div class="flex flex-col gap-(--gap-in)">
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>
    <p class="flex items-center gap-1 text-sm text-on-surface-variant"><Icon name="lock" :size="16" class="shrink-0" />{{ T.groupDesc }}</p>

    <BaseCard v-for="id in SERVICE_IDS" :key="id" icon="key" :title="T.services[id].title">
      <template #actions>
        <a :href="T.services[id].link" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-xs text-primary hover:underline">{{ T.linkLabel }}<Icon name="open_in_new" :size="14" /></a>
      </template>
      <!-- 무엇에 쓰는지 한 줄, 없을 때의 일 · 받는 법은 툴팁 -->
      <p class="mb-3 flex items-center gap-1 text-sm text-on-surface-variant">{{ T.services[id].purpose }}<Icon name="info" :size="16" class="shrink-0 cursor-help" v-tooltip="T.services[id].tip" /></p>

      <div class="flex flex-col gap-3">
        <!-- 값은 쓰기 전용이다. 저장된 값은 끝 네 글자만 보인다 -->
        <label v-for="field in fieldsOf(id)" :key="field" class="block min-w-0">
          <span :class="FIELD_LABEL" class="flex items-center gap-2"
            >{{ fieldLabel(id, field) }}<span class="inline-flex items-center gap-1" :class="TONE[stateOf(id, field).state]" v-tooltip="tipOf(id, field)"><Icon :name="ICON[stateOf(id, field).state]" :size="14" :fill="stateOf(id, field).state === 'ok'" />{{ stateText(id, field) }}</span></span
          >
          <input :value="input[id][field]" type="password" autocomplete="off" spellcheck="false" :placeholder="stateOf(id, field).state === 'none' ? T.placeholderNew : T.placeholderReplace" :class="[FIELD, 'w-full font-mono placeholder:font-sans']" @input="input[id][field] = valueOf($event)" />
        </label>

        <div class="flex items-center gap-2 flex-wrap">
          <BaseButton :disabled="!typed(id) || busy[id] !== null" @click="save(id)">{{ busy[id] === "save" ? T.saving : T.save }}</BaseButton>
          <BaseButton variant="ghost" :disabled="!saved(id) || busy[id] !== null" @click="test(id)">{{ busy[id] === "test" ? T.testing : T.test }}</BaseButton>
          <button v-if="saved(id)" type="button" :class="[ICON_BTN, 'size-10']" class="hover:text-error" :disabled="busy[id] !== null" :aria-label="T.clear" v-tooltip="T.clear" @click="clear(id)"><Icon name="delete" :size="20" /></button>
        </div>
        <p v-if="checked[id]" role="status" class="flex items-center gap-1 text-xs" :class="checked[id]?.ok ? 'text-primary' : 'text-error'"><Icon :name="checked[id]?.ok ? 'check_circle' : 'error'" :size="16" :fill="checked[id]?.ok" />{{ checkText(checked[id]) }}</p>
      </div>
    </BaseCard>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import { ICON_BTN } from "../utils/icon-button.ts";
import { FIELD, FIELD_LABEL } from "../utils/field.ts";
import { valueOf } from "../utils/dom.ts";
import { problemText } from "../utils/problem.ts";
import { formatDate } from "../utils/locale.ts";
import { trackUnsaved } from "../composables/unsaved.ts";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { SERVICE_KEYS, SERVICE_IDS, type ServiceId } from "../../../src/rules/service-keys.ts";
import type { KeyCheck, SecretView, ServiceKeysView } from "../../../src/dashboard/contract/admin.ts";
import type { IconName } from "../icons.ts";
import { text } from "../text/index.ts";
const T = text.serviceKeys;

const ICON: Record<SecretView["state"], IconName> = { none: "radio_button_unchecked", ok: "check_circle", again: "sync_problem" };
const TONE: Record<SecretView["state"], string> = { none: "text-on-surface-variant", ok: "text-primary", again: "text-error" };
const NONE: SecretView = { state: "none", last4: null, updatedAt: null };

const fieldsOf = (id: ServiceId): readonly string[] => SERVICE_KEYS[id];
const fieldLabel = (id: ServiceId, field: string) => (T.services[id].fields as Record<string, string>)[field] ?? field;

const view = ref<ServiceKeysView | null>(null);
const loadError = ref("");
// 서비스마다 칸에 넣은 값(저장 전). 저장하면 비운다
const input = reactive(Object.fromEntries(SERVICE_IDS.map((id) => [id, Object.fromEntries(fieldsOf(id).map((field) => [field, ""]))])) as Record<ServiceId, Record<string, string>>);
// 서비스마다 하는 일(저장 · 시험 · 지우기), 마지막 연결 시험 결과
const busy = reactive(Object.fromEntries(SERVICE_IDS.map((id) => [id, null])) as Record<ServiceId, "save" | "test" | "clear" | null>);
const checked = reactive(Object.fromEntries(SERVICE_IDS.map((id) => [id, null])) as Record<ServiceId, KeyCheck | null>);

const typed = (id: ServiceId) => Object.values(input[id]).some((value) => value.trim());
const stateOf = (id: ServiceId, field: string): SecretView => (view.value?.[id] as Record<string, SecretView> | undefined)?.[field] ?? NONE;
const saved = (id: ServiceId) => fieldsOf(id).some((field) => stateOf(id, field).state !== "none");

// 넣고 저장하지 않은 값도 떠날 때 묻는다
trackUnsaved(
  "keys:service-keys",
  computed(() => SERVICE_IDS.some(typed)),
);

function stateText(id: ServiceId, field: string) {
  const one = stateOf(id, field);
  return one.state === "ok" ? T.state.ok(one.last4) : T.state[one.state];
}
function tipOf(id: ServiceId, field: string) {
  const one = stateOf(id, field);
  if (one.state === "again") return T.againTip;
  return one.updatedAt ? T.updated(formatDate(one.updatedAt, { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })) : null;
}
const checkText = (result: KeyCheck | null) => (!result ? "" : result.ok ? T.check.ok : T.check[result.reason]);

async function save(id: ServiceId) {
  busy[id] = "save";
  const title = T.services[id].title;
  try {
    const values = Object.fromEntries(Object.entries(input[id]).filter(([, value]) => value.trim()));
    view.value = (await axios.put<ServiceKeysView>(`/api/admin/service-keys/${id}`, { values })).data;
    for (const field of fieldsOf(id)) input[id][field] = "";
    checked[id] = null;
    notifyDone(T.savedDone(title));
  } catch (err) {
    notifyProblem(err, T.saveFailed(title));
  } finally {
    busy[id] = null;
  }
}

async function clear(id: ServiceId) {
  busy[id] = "clear";
  const title = T.services[id].title;
  try {
    view.value = (await axios.delete<ServiceKeysView>(`/api/admin/service-keys/${id}`)).data;
    checked[id] = null;
    notifyDone(T.clearedDone(title));
  } catch (err) {
    notifyProblem(err, T.clearFailed(title));
  } finally {
    busy[id] = null;
  }
}

async function test(id: ServiceId) {
  busy[id] = "test";
  try {
    checked[id] = (await axios.post<KeyCheck>(`/api/admin/service-keys/${id}/test`)).data;
  } catch (err) {
    notifyProblem(err, T.testFailed(T.services[id].title));
  } finally {
    busy[id] = null;
  }
}

onMounted(async () => {
  try {
    view.value = (await axios.get<ServiceKeysView>("/api/admin/service-keys")).data;
  } catch (err) {
    loadError.value = problemText(err, T.loadFailed);
  }
});
</script>
