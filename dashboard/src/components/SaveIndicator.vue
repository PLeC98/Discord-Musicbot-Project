<template>
  <!-- 자동 저장 표시(위 막대 버튼 위치, 크기도 같다). 저장 중: 플로피도 돌고(링보다 느리게) 둘레를 링이 돈다. 끝: 링이 한 바퀴로 이어져 닫히고 플로피가 사라진 자리에 체크가 그어져(동그라미 안 체크) 잠시 뒤 사라진다.
       실패: 링이 오류 색으로 닫히고 느낌표. 링은 SVG 원 하나(돌 때는 4 분의 1 호, 끝나면 둘레를 다 채운다) -->
  <Transition enter-from-class="opacity-0 scale-75" leave-to-class="opacity-0 scale-75" enter-active-class="transition-[opacity,scale] duration-200 ease-out" leave-active-class="transition-[opacity,scale] duration-300 ease-in">
    <span v-if="state !== 'idle'" role="status" :aria-label="LABEL[state]" v-tooltip="LABEL[state]" class="relative size-10 md:size-7 shrink-0 flex items-center justify-center" :class="state === 'error' ? 'text-error' : state === 'done' ? 'text-primary' : 'text-on-surface'">
      <svg class="absolute inset-0 size-full -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" stroke-opacity="0.15" stroke-width="2.5" />
        <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" :stroke-dasharray="CIRC" :stroke-dashoffset="state === 'saving' ? CIRC * 0.75 : 0" class="origin-center transition-[stroke-dashoffset] duration-300 ease-[cubic-bezier(0.2,0,0,1)]" :class="state === 'saving' && 'animate-[spin_0.9s_linear_infinite]'" />
      </svg>
      <!-- type="transition": 떠나는 플로피는 도는 애니메이션(무한)을 단 채라, 정하지 않으면 Vue 가 그 길이(1.4초)를 기다린 뒤에야 다음 것을 들인다.
           체크는 글꼴 기호가 아니라 SVG 선이라 왼쪽 아래에서 오른쪽 위로 그어진다(check-draw, style.css). 느낌표는 작았다가 커지며 들어온다 -->
      <Transition mode="out-in" type="transition" :enter-from-class="state === 'done' ? '' : 'opacity-0 scale-50'" leave-to-class="opacity-0 scale-50" enter-active-class="transition-[opacity,scale] duration-200 ease-out" leave-active-class="transition-[opacity,scale] duration-150 ease-in">
        <svg v-if="state === 'done'" key="done" :width="ICON_SIZE" :height="ICON_SIZE" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5 9.5 17 19 7.5" pathLength="1" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1" class="animate-[check-draw_320ms_cubic-bezier(0.2,0,0,1)_both]" />
        </svg>
        <Icon v-else :key="ICON[state]" :name="ICON[state]" :size="ICON_SIZE" :weight="600" :class="state === 'saving' && 'animate-[spin_1.4s_linear_infinite]'" />
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
// 끝(done)은 기호가 아니라 그어 그리는 체크(템플릿의 SVG)
const ICON: Record<Exclude<SaveState, "done">, IconName> = { idle: "save", saving: "save", error: "priority_high" };
// 위 막대 버튼처럼 휴대폰 20 · 태블릿 · PC 16(링 안에 들게 한 단계 작게)
const phone = useMediaQuery(PHONE_QUERY);
const ICON_SIZE = computed(() => (phone.value ? 20 : 16));
</script>
