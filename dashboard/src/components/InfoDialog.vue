<!--
  설명 대화상자: 헤더(색조 동그라미 아이콘 · 제목 · 닫기)와 그 아래 내용(slot). 카드 안에서 펼치면 단 배치가 흔들리는 긴 설명을 표시한다.
  SponsorBlock 구간 설명 · 줄 형식 문법이 같이 쓴다. 바깥을 누르거나 Esc 로 닫는다. 넘치면 안에서 스크롤되고 스크롤바 트랙을 모서리 안쪽에 맞춘다
-->
<template>
  <Teleport to="body">
    <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
      <div v-if="open" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" @click.self="open = false">
        <div ref="panel" role="dialog" aria-modal="true" :aria-labelledby="titleId" class="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-surface-container-high animate-[art-in_350ms_var(--ease-spring-fast)] [&::-webkit-scrollbar-track]:my-(--sb-inset-dialog)" :class="overflowing ? 'py-6 pl-6 pr-5.25' : 'p-6'">
          <div class="flex items-center gap-3 mb-4">
            <span class="size-9 shrink-0 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center"><Icon :name="icon" :size="20" /></span>
            <h3 :id="titleId" class="flex-1 text-xl font-round font-semibold">{{ title }}</h3>
            <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="text.common.close" @click="open = false"><Icon name="close" :size="20" /></button>
          </div>
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, useId } from "vue";
import { useCloseLayer } from "../composables/close-layer.ts";
import Icon from "./BaseIcon.vue";
import { ICON_BTN } from "../utils/icon-button.ts";
import { useOverflowing } from "../composables/overflowing.ts";
import type { IconName } from "../icons.ts";
import { text } from "../text/index.ts";

/** 열림(v-model) */
const open = defineModel<boolean>({ required: true });
defineProps<{ title: string; icon: IconName }>();

const panel = ref<HTMLElement | null>(null);
const overflowing = useOverflowing(panel);
const titleId = useId();
useCloseLayer(open, () => (open.value = false));
</script>
