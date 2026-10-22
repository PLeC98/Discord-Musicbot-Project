<template>
  <!-- 자동 저장 표시(위 막대 버튼 위치, 크기도 같다). 저장 중: 플로피도 돌고(링보다 느리게) 둘레를 링이 돈다. 끝: 링이 한 바퀴로 이어져 닫히고 플로피가 체크로 바뀌어(동그라미 안 체크) 잠시 뒤 사라진다.
       실패: 링이 오류 색으로 닫히고 느낌표. 링은 SVG 원 하나(돌 때는 4 분의 1 호, 끝나면 둘레를 다 채운다) -->
  <Transition enter-from-class="opacity-0 scale-75" leave-to-class="opacity-0 scale-75" enter-active-class="transition-[opacity,scale] duration-200 ease-out" leave-active-class="transition-[opacity,scale] duration-300 ease-in">
    <span v-if="state !== 'idle'" role="status" :aria-label="LABEL[state]" v-tooltip="LABEL[state]" class="relative size-10 md:size-7 shrink-0 flex items-center justify-center" :class="state === 'error' ? 'text-error' : state === 'done' ? 'text-primary' : 'text-on-surface'">
      <svg class="absolute inset-0 size-full -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" stroke-opacity="0.15" stroke-width="2.5" />
        <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" :stroke-dasharray="CIRC" :stroke-dashoffset="state === 'saving' ? CIRC * 0.75 : 0" class="origin-center transition-[stroke-dashoffset] duration-300 ease-[cubic-bezier(0.2,0,0,1)]" :class="state === 'saving' && 'animate-[spin_0.9s_linear_infinite]'" />
      </svg>
      <!-- type="transition": 떠나는 플로피는 도는 애니메이션(무한)을 단 채라, 정하지 않으면 Vue 가 그 길이(1.4초)를 기다린 뒤에야 체크를 들인다. 체크는 링이 닫힐 때 튀어 들어온다 -->
      <Transition mode="out-in" type="transition" enter-from-class="opacity-0 scale-50" leave-to-class="opacity-0 scale-50" enter-active-class="transition-[opacity,scale] duration-300 ease-(--ease-spring-fast)" leave-active-class="transition-[opacity,scale] duration-150 ease-in">
        <Icon :key="ICON[state]" :name="ICON[state]" :size="ICON_SIZE" :weight="600" :class="state === 'saving' && 'animate-[spin_1.4s_linear_infinite]'" />
      </Transition>
    </span>
  </Transition>
</template>

<script setup lang="ts">
import { useMediaQuery } from "@vueuse/core";
import { computed } from "vue";
import Icon from "./BaseIcon.vue";
import { PHONE_QUERY } from "../utils/breakpoints.ts";
import type { IconName } from "../icons.ts";
import { text } from "../text/index.ts";

export type SaveState = "idle" | "saving" | "done" | "error";
defineProps<{ state: SaveState }>();

const CIRC = 2 * Math.PI * 17;
const LABEL: Record<SaveState, string> = { idle: "", saving: text.editor.saving, done: text.editor.saved, error: text.editor.saveFailed };
const ICON: Record<SaveState, IconName> = { idle: "save", saving: "save", done: "check", error: "priority_high" };
// 위 막대 버튼처럼 휴대폰 20 · 태블릿 · PC 16(링 안에 들게 한 단계 작게)
const phone = useMediaQuery(PHONE_QUERY);
const ICON_SIZE = computed(() => (phone.value ? 20 : 16));
</script>
