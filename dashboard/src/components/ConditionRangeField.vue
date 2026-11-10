<template>
  <!-- 상태 문구 조건(양력, 음력, 시간대)의 범위. 누르면 창이 열려 시작, 끝을 휠로 고른다(로그 날짜 고르개와 같은 창 모양, 휴대폰이나 자리가 모자라면 가운데 팝업).
       값은 저장 형식 그대로("MM-DD ~ MM-DD", "HH:MM ~ HH:MM", 없으면 ""). 입력란의 글은 utils/condition-range -->
  <div ref="root" class="relative">
    <button ref="anchor" type="button" :class="BOX" :aria-expanded="open" :aria-label="label" @click="toggle">
      <span class="min-w-0 flex items-center gap-2" :class="parsed ? 'text-on-surface' : 'text-on-surface-variant'">
        <Icon :name="ICON[kind]" :size="18" class="shrink-0 text-on-surface-variant" />
        <span class="truncate nums">{{ parsed ? rangeText(kind, parsed) : R.none }}</span>
      </span>
      <svg class="shrink-0 text-on-surface-variant transition-transform spring-fast" :class="open && 'rotate-180'" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
    </button>

    <Teleport to="body">
      <Transition :name="asDialog ? 'dialog' : 'menu'" :duration="asDialog ? DIALOG_MS : undefined">
        <div v-if="open" :class="asDialog ? 'fixed inset-0 z-300 flex items-center justify-center p-4' : 'contents'">
          <!-- 뒤를 누르면 바깥 누름(useAnchoredPanel)으로 닫힌다 -->
          <div v-if="asDialog" class="absolute inset-0 bg-black/50"></div>
          <div ref="panel" :role="asDialog ? 'dialog' : undefined" :aria-modal="asDialog || undefined" :aria-label="label" :class="asDialog ? DIALOG_CLS : MENU_CLS" :style="asDialog ? undefined : style">
            <h3 v-if="asDialog" class="text-base font-semibold text-on-surface">{{ label }}</h3>
            <!-- 시작 ~ 끝. 날짜는 [월]월 [일]일, 시간대는 [시]:[분] -->
            <div class="flex items-center justify-center gap-2">
              <template v-for="(side, n) in SIDES" :key="side">
                <span v-if="n" class="pt-5 text-lg text-on-surface-variant">~</span>
                <div class="flex flex-col items-center gap-1">
                  <span class="text-xs font-medium text-on-surface-variant">{{ side === "start" ? R.start : R.end }}</span>
                  <div class="flex items-center gap-1">
                    <WheelPicker v-model="draft[side][0]" :count="time ? 24 : 12" :first="time ? 0 : 1" :label="`${side === 'start' ? R.start : R.end} ${time ? R.hour : R.month}`" class="w-11" />
                    <span class="text-sm text-on-surface-variant" :class="time && 'font-semibold text-lg'">{{ time ? ":" : R.month }}</span>
                    <WheelPicker v-model="draft[side][1]" :count="time ? 60 : daysIn(kind, draft[side][0])" :first="time ? 0 : 1" :label="`${side === 'start' ? R.start : R.end} ${time ? R.minute : R.day}`" class="w-11" />
                    <span v-if="!time" class="text-sm text-on-surface-variant">{{ R.day }}</span>
                  </div>
                </div>
              </template>
            </div>
            <div class="flex items-center justify-between gap-2">
              <BaseButton variant="ghost" size="sm" @click="choose('')">{{ R.clear }}</BaseButton>
              <BaseButton variant="primary" size="sm" @click="choose(formatRange(kind, draft))">{{ R.apply }}</BaseButton>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useMediaQuery } from "@vueuse/core";
import Icon from "./BaseIcon.vue";
import BaseButton from "./BaseButton.vue";
import WheelPicker from "./WheelPicker.vue";
import { PHONE_QUERY } from "../utils/breakpoints.ts";
import { coveredBottom, useAnchoredPanel } from "../composables/anchored-panel.ts";
import { rem } from "../utils/rem.ts";
import { DIALOG_MS } from "../utils/motion.ts";
import { daysIn, formatRange, parseRange, rangeText, type End, type Range } from "../utils/condition-range.ts";
import type { ConditionKey } from "../utils/presence-rows.ts";
import { text } from "../text/index.ts";

/** kind: 양력, 음력, 시간대. modelValue: 저장 형식의 범위(없으면 ""). label: 입력란, 창의 이름 */
const props = defineProps<{ kind: ConditionKey; modelValue: string; label: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const R = text.presence.range;
const SIDES = ["start", "end"] as const;
const ICON = { date: "calendar_month", lunar: "bedtime", time: "schedule" } as const;
const BOX = "w-full h-10 pl-4 pr-3 text-sm flex items-center justify-between gap-2 bg-surface-container-highest border border-transparent rounded-(--r-inner) text-on-surface text-left cursor-pointer outline-none transition-[border-color] effects-fast focus-visible:border-primary";
const MENU_CLS = "menu-panel pane-menu bg-surface-container-low! rounded-lg p-3 flex flex-col gap-3 select-none";
const DIALOG_CLS = "dialog-panel relative w-80 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-surface-container-high p-4 flex flex-col gap-3 select-none";
// 창 폭, 높이(rem): 휠 넷과 단위, 버튼
const PANEL_REM = 20;
const PANEL_H_REM = 11;
const GAP = 4;

const time = computed(() => props.kind === "time");
const parsed = computed(() => parseRange(props.kind, props.modelValue));

const root = ref<HTMLElement | null>(null);
const anchor = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const open = ref(false);
// 휴대폰이면 가운데 팝업. 그 밖에도 열 때 입력란 위아래 어느 쪽에도 창이 다 들어가지 않으면(cramped) 팝업
const phone = useMediaQuery(PHONE_QUERY);
const cramped = ref(false);
const asDialog = computed(() => phone.value || cramped.value);
function noRoom() {
  const el = anchor.value;
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const need = rem(PANEL_H_REM) + GAP;
  return window.innerHeight - coveredBottom(el) - rect.bottom < need && rect.top < need;
}
const { style } = useAnchoredPanel({ root, anchor, panel, open, maxHeight: 400, gap: GAP, width: rem(PANEL_REM) });

// 창에서 고르는 중인 범위. 열 때 지금 값에서 시작한다(없으면 양력은 오늘 하루, 음력은 1월 1일, 시간대는 지금 시각부터 한 시간)
const draft = reactive<Range>({ start: [0, 0], end: [0, 0] });
function toggle() {
  if (!open.value) cramped.value = noRoom();
  open.value = !open.value;
  if (!open.value) return;
  const now = new Date();
  const start: End = time.value ? [now.getHours(), 0] : props.kind === "lunar" ? [0, 0] : [now.getMonth(), now.getDate() - 1];
  const range = parsed.value ?? { start, end: time.value ? [(now.getHours() + 1) % 24, 0] : start };
  draft.start = [...range.start];
  draft.end = [...range.end];
}
// 달을 바꿔 날이 그 달보다 많아지면 그 달 끝으로
watch(
  () => [draft.start[0], draft.end[0]],
  () => {
    if (time.value) return;
    for (const side of SIDES) draft[side][1] = Math.min(draft[side][1], daysIn(props.kind, draft[side][0]) - 1);
  },
);

function choose(value: string) {
  emit("update:modelValue", value);
  open.value = false;
}
</script>
