<template>
  <!-- 실시간 로그 탭의 설정 버튼이 여는 창. 로그 수준 둘(운영 설정값 LOG_LEVEL, LOG_CONSOLE_LEVEL). 운영 설정값의 고치는 중인 값을 바꾸므로
       위 저장 바에도 그대로 오른다. 창 아래 저장 버튼은 이 둘만 저장하고 닫는다. 바로 적용된다(다시 시작하지 않는다) -->
  <BaseDialog :open="open" width="md" aria-labelledby="log-settings-title" @close="emit('close')">
    <div class="flex items-center gap-3 mb-4">
      <span class="size-9 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center"><Icon name="settings" :size="20" /></span>
      <h3 id="log-settings-title" class="flex-1 text-xl font-round font-semibold">{{ T.title }}</h3>
      <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="text.common.close" @click="emit('close')"><Icon name="close" :size="20" /></button>
    </div>
    <div class="flex flex-col mb-4">
      <div v-for="row in ROWS" :key="row.key" class="-mx-3 px-3 py-2 min-h-14 flex items-center gap-4">
        <Icon :name="row.icon" :size="20" class="text-on-surface-variant" />
        <span class="flex-1 min-w-0">
          <span class="block text-body font-medium">{{ row.label }}</span>
          <span class="block text-label text-on-surface-variant">{{ row.desc }}</span>
        </span>
        <SingleSelect :model-value="shownOf(row.key)" :options="row.options" :disabled="!loaded || saving" class="w-40 shrink-0" @update:model-value="pick(row.key, String($event))" />
      </div>
    </div>
    <div class="flex gap-2 justify-end">
      <BaseButton :disabled="!dirty || saving" @click="save"><Icon name="save" :size="18" class="-ml-1" />{{ text.editor.save }}</BaseButton>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import BaseDialog from "./BaseDialog.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import SingleSelect from "./SingleSelect.vue";
import { ICON_BTN } from "../utils/icon-button.ts";
import { LEVEL_CHIPS } from "../utils/log-style.ts";
import type { Option } from "../utils/options.ts";
import { attach, draft, loaded, namesOf, saveKeys, saved } from "../composables/tunables.ts";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { trackUnsaved } from "../composables/unsaved.ts";
import { text } from "../text/index.ts";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const KEYS = ["LOG_LEVEL", "LOG_CONSOLE_LEVEL"] as const;
type Key = (typeof KEYS)[number];
// 운영 설정값은 기본값을 빈 값으로 둔다. 드롭다운에는 기본값(기록 수준 INFO, 터미널 수준 "기록 수준과 같음")이 선택된 것으로 보인다
const SAME = "same";
const DEFAULT_SHOWN: Record<Key, string> = { LOG_LEVEL: "info", LOG_CONSOLE_LEVEL: SAME };
const shownOf = (key: Key) => draft.value[key] || DEFAULT_SHOWN[key];
const pick = (key: Key, value: string) => (draft.value[key] = value === DEFAULT_SHOWN[key] ? "" : value);

const T = computed(() => text.logs.settingsDialog);
// 레벨은 심각한 것이 위(필터 칩과 같은 차례). 터미널 수준은 맨 위에 "기록 수준과 같음"(빈 값)
const LEVELS = computed<Option[]>(() => LEVEL_CHIPS.map(({ value, label }) => ({ value, label })));
const ROWS = computed(() => [
  { key: "LOG_LEVEL" as const, icon: "article" as const, label: T.value.fileLevel, desc: T.value.fileLevelDesc, options: LEVELS.value },
  { key: "LOG_CONSOLE_LEVEL" as const, icon: "terminal" as const, label: T.value.consoleLevel, desc: T.value.consoleLevelDesc, options: [{ value: SAME, label: T.value.sameAsFile }, ...LEVELS.value] },
]);

// 운영 설정값을 읽는다(이 탭에는 운영 설정값 카드가 없다). 저장 바에 오르는 것도 이것이 한다
const { ready, detach } = attach();
ready.catch((e: unknown) => notifyProblem(e, text.tunables.loadFailed));
onUnmounted(detach);

const saving = ref(false);
const dirty = computed(() => KEYS.some((key) => (draft.value[key] ?? "") !== (saved.value[key] ?? "")));
// 실시간 로그 탭 아이콘의 저장하지 않은 표시(다른 탭의 운영 설정값 카드와 같다), 떠날 때 묻기
trackUnsaved("logs:tunables", dirty);

// 창 안의 저장: 이 둘만 저장하고 닫는다
async function save() {
  saving.value = true;
  // 알림에는 바꾼 것만 적는다(저장하면 고치는 중인 값과 저장된 값이 같아지므로 먼저 센다)
  const changed = KEYS.filter((key) => (draft.value[key] ?? "") !== (saved.value[key] ?? ""));
  try {
    await saveKeys(KEYS);
    notifyDone(text.tunables.savedDone, namesOf(changed));
    emit("close");
  } catch (e) {
    notifyProblem(e, text.tunables.saveFailed);
  } finally {
    saving.value = false;
  }
}
</script>
