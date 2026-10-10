<template>
  <!-- 안내 상자. gate: 할 수 없는 까닭(곡 넣기 칸 자리에 선다, 바탕 surface-container-high, 입력칸과 같은 높이 48 이상이라 바뀌어도 아래가 튀지 않는다), note: 해 본 결과(칸 아래, 색은 tone). 글은 slot -->
  <div :class="variant === 'gate' ? GATE : [NOTE, TONE[tone]]">
    <Icon v-if="icon" :name="icon" :size="variant === 'gate' ? 24 : 20" :fill="fill" :class="['shrink-0', iconClass]" />
    <slot />
  </div>
</template>

<script setup lang="ts">
import Icon from "./BaseIcon.vue";
import type { IconName } from "../icons.ts";

/** tone: note 의 색(오류 · 일부만 됨 · 됨). iconClass: 아이콘에만 줄 색 */
withDefaults(defineProps<{ variant: "gate" | "note"; icon?: IconName; iconClass?: string; fill?: boolean; tone?: "error" | "notice" | "info" }>(), { iconClass: "", fill: false, tone: "info" });

const GATE = "flex items-center gap-3 min-h-12 rounded-(--r-inner) bg-surface-container-high px-4 py-3 text-sm";
const NOTE = "mt-3 flex items-start gap-3 rounded-(--r-inner) px-4 py-3 text-sm whitespace-pre-line";
const TONE = { error: "bg-error-container text-on-error-container", notice: "bg-tertiary-container text-on-tertiary-container", info: "bg-secondary-container text-on-secondary-container" };
</script>
