<template>
  <!-- 설정(M3 대화상자). 밝기, 테마, 화면은 이 브라우저에만 기억하고, 로그인한 기기는 서버의 세션이라 창을 열 때 읽는다 -->
  <BaseDialog :open="open" width="md" scroll aria-labelledby="settings-title" @close="close">
    <div class="flex items-center gap-3 mb-4">
      <span class="size-9 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center"><Icon name="settings" :size="20" /></span>
      <h3 id="settings-title" class="flex-1 text-xl font-round font-semibold">{{ T.title }}</h3>
      <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="text.common.close" @click="close"><Icon name="close" :size="20" /></button>
    </div>

    <div class="text-label font-semibold text-primary mb-2">{{ text.shell.brightness }}</div>
    <div class="flex gap-0.5 mb-6" role="group" :aria-label="text.shell.brightness">
      <button v-for="(m, i) in MODE_ITEMS" :key="m.mode" type="button" class="state-layer flex-1 h-10 flex items-center justify-center gap-2 text-label font-semibold cursor-pointer" :class="[segmentShape(mode === m.mode, i, MODE_ITEMS.length), mode === m.mode ? 'bg-secondary text-on-secondary' : 'bg-surface-highest text-on-surface-variant']" @click="setMode(m.mode)"><Icon :name="m.icon" :size="18" :fill="mode === m.mode" />{{ m.label }}</button>
    </div>

    <template v-for="group in GROUPS" :key="group.title">
      <div class="text-label font-semibold text-primary mb-2">{{ group.title }}</div>
      <div class="flex flex-col mb-4 last:mb-0">
        <label v-for="row in group.rows" :key="row.key" class="state-layer -mx-3 px-3 py-2 min-h-14 rounded-2xl flex items-center gap-4 cursor-pointer">
          <Icon :name="row.icon" :size="20" class="text-on-surface-variant" />
          <span class="flex-1 min-w-0">
            <span class="block text-body font-medium">{{ row.label }}</span>
            <span class="block text-label text-on-surface-variant">{{ row.desc }}</span>
          </span>
          <BaseSwitch :model-value="prefs[row.key]" @update:model-value="setPref(row.key, $event)" />
        </label>
      </div>
    </template>

    <!-- 내 언어: 화면과 디스코드의 본인 응답이 같이 쓰는 계정 값(PUT /api/me/language). 언어가 하나면 감춘다 -->
    <template v-if="canChoose">
      <div class="text-label font-semibold text-primary mb-2">{{ L.title }}</div>
      <div class="-mx-3 px-3 py-2 min-h-14 mb-4 flex items-center gap-4">
        <Icon name="language" :size="20" class="text-on-surface-variant" />
        <span class="flex-1 min-w-0">
          <span class="block text-body font-medium">{{ L.mine }}</span>
          <span class="block text-label text-on-surface-variant">{{ L.appliesToDiscord }}</span>
        </span>
        <SingleSelect :model-value="wanted" :options="languageOptions" :disabled="saving" class="w-40 shrink-0" @update:model-value="pickLanguage" />
      </div>
    </template>

    <div class="text-label font-semibold text-primary mb-2">{{ T.devices.title }}</div>
    <AccountDevices />
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ICON_BTN } from "../utils/icon-button.ts";
import { segmentShape } from "../utils/segment.ts";
import BaseDialog from "./BaseDialog.vue";
import Icon from "./BaseIcon.vue";
import BaseSwitch from "./BaseSwitch.vue";
import AccountDevices from "./AccountDevices.vue";
import SingleSelect from "./SingleSelect.vue";
import { canChoose, chooseLanguage, languageOptions, wanted, type Wanted } from "../composables/screen-language.ts";
import { notifyProblem } from "../composables/toasts.ts";
import type { OptionValue } from "../utils/options.ts";
import { mode, prefs, setMode, setPref, type Mode, type Prefs } from "../theme/theme.ts";
import type { IconName } from "../icons.ts";
import { text } from "../text/index.ts";
const T = text.settings;
const L = text.language;

const open = defineModel<boolean>({ required: true });
const close = () => (open.value = false);

// 저장하는 동안 드롭다운을 막는다. 저장이 되어야 화면 언어가 바뀐다
const saving = ref(false);
async function pickLanguage(value: OptionValue) {
  saving.value = true;
  try {
    await chooseLanguage(value as Wanted, { signedIn: true });
  } catch (error) {
    notifyProblem(error, L.saveFailed);
  } finally {
    saving.value = false;
  }
}

const MODE_ITEMS = computed<Array<{ mode: Mode; label: string; icon: IconName }>>(() => [
  { mode: "dark", label: text.shell.modeDark, icon: "dark_mode" },
  { mode: "light", label: text.shell.modeLight, icon: "light_mode" },
  { mode: "system", label: text.shell.modeSystem, icon: "contrast" },
]);

type Row = { key: keyof Prefs; label: string; desc: string; icon: IconName };
const GROUPS = computed<Array<{ title: string; rows: Row[] }>>(() => [
  {
    title: T.groupTheme,
    rows: [
      { key: "artColor", ...T.artColor, icon: "palette" },
      { key: "artWallpaper", ...T.artWallpaper, icon: "wallpaper" },
    ],
  },
  { title: T.groupScreen, rows: [{ key: "clock", ...T.clock, icon: "schedule" }] },
]);
</script>
