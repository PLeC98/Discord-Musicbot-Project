<!--
  SponsorBlock 에서 건너뛸 구간 고르기: 이름표(정보 단추를 누르면 구간마다 설명 창) + 체크박스 목록.
  서버 설정의 SponsorBlock 카드와 운영 조절값의 "기본으로 건너뛸 구간"이 같이 쓴다. 설명은 rules/sponsor-categories.
  목록은 카드가 넓으면(32rem 이상) 두 단.
-->
<template>
  <div>
    <div class="flex items-center gap-1 mb-2">
      <span class="text-on-surface-variant text-xs">{{ label }}</span>
      <button type="button" :class="[ICON_BTN, 'size-6']" v-tooltip="T.help" :aria-label="T.helpLabel" aria-haspopup="dialog" @click="helpOpen = true"><Icon name="info" :size="16" /></button>
    </div>

    <!-- 구간 설명은 대화상자로 띄운다(카드 안에서 펼치면 단 배치가 흔들린다) -->
    <Teleport to="body">
      <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
        <div v-if="helpOpen" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" @click.self="helpOpen = false">
          <div ref="helpEl" role="dialog" aria-modal="true" :aria-labelledby="titleId" class="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-surface-container-high animate-[art-in_350ms_var(--ease-spring-fast)] [&::-webkit-scrollbar-track]:my-(--sb-inset-dialog)" :class="helpOverflowing ? 'py-6 pl-6 pr-5.25' : 'p-6'">
            <div class="flex items-center gap-3 mb-4">
              <span class="size-9 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center"><Icon name="skip_next" :size="20" /></span>
              <h3 :id="titleId" class="flex-1 text-xl font-round font-semibold">{{ T.categories }}</h3>
              <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="text.common.close" @click="helpOpen = false"><Icon name="close" :size="20" /></button>
            </div>
            <dl class="flex flex-col gap-1">
              <div v-for="c in CATEGORIES" :key="c.id" class="rounded-(--r-inner) bg-surface-container-highest px-4 py-3">
                <dt class="text-sm font-semibold">{{ c.label }}</dt>
                <dd class="mt-0.5 text-xs text-on-surface-variant">{{ c.description }}</dd>
              </div>
            </dl>
          </div>
        </div>
      </Transition>
    </Teleport>

    <div class="rounded-(--r-inner) border border-outline-variant/50 p-1 grid grid-cols-1 @lg/card:grid-cols-2" :class="dimmed ? 'opacity-38 pointer-events-none' : ''">
      <label v-for="c in CATEGORIES" :key="c.id" class="flex items-center gap-2 h-10 px-3 rounded-(--r-row) text-sm" :class="editable ? 'state-layer cursor-pointer' : 'opacity-60'">
        <input type="checkbox" class="size-4 accent-primary shrink-0" :checked="selected.includes(c.id)" :disabled="!editable" @change="emit('toggle', c.id)" />
        <span>{{ c.label }}</span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, useId } from "vue";
import { onKeyStroke } from "@vueuse/core";
import Icon from "./BaseIcon.vue";
import { ICON_BTN } from "../utils/icon-button.ts";
import { useOverflowing } from "../composables/overflowing.ts";
import { SKIP_CATEGORIES, categoryDescription, categoryLabel } from "../../../src/rules/sponsor-categories.ts";
import { text } from "../text/index.ts";
const T = text.serverSettings.sponsor;

/** label: 목록 이름표 · selected: 고른 구간 id · editable: 고칠 수 있는가 · dimmed: 흐리게(서버에서 자동 스킵을 껐을 때) */
withDefaults(defineProps<{ label: string; selected: readonly string[]; editable?: boolean; dimmed?: boolean }>(), { editable: true, dimmed: false });
const emit = defineEmits<{ toggle: [id: string] }>();

const CATEGORIES = SKIP_CATEGORIES.map((id) => ({ id, label: categoryLabel(id), description: categoryDescription(id) }));

const helpOpen = ref(false);
const helpEl = ref<HTMLElement | null>(null);
const helpOverflowing = useOverflowing(helpEl);
const titleId = useId();
onKeyStroke("Escape", () => (helpOpen.value = false));
</script>
