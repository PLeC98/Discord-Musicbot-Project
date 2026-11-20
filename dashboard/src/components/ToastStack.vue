<template>
  <!-- 떠 있는 알림. 위치는 알림 서랍(shell/NoticeDrawer)이 잡는다(라우터 화면 밖이라 페이지를 옮겨도 남는다). 카드는 알림함과 같은 NoticeCard.
       새 알림은 맨 위에서 펴지며 들어오고(나머지는 스프링으로 아래로 밀린다), 사라질 때는 위로 오므라든다. 밀어 치운 알림만 오른쪽으로 빠진다(style.css의 notice-*).
       오른쪽으로 밀어 치운다(composables/swipe-dismiss). 마우스를 올린 동안은 사라지는 시간을 멈추고, 떼면 멈춘 자리부터 이어 잰다 -->
  <TransitionGroup tag="div" class="contents" aria-live="polite" name="notice" leave-active-class="notice-leave-active absolute! inset-x-0" @after-leave="swipe.onLeft">
    <div v-for="t in toasts" :key="t.id" role="status" class="relative touch-pan-y select-none cursor-grab active:cursor-grabbing [transition:opacity_250ms_var(--ease-effects),translate_460ms_var(--ease-spring)]" :style="swipe.styleOf(t.id)" @pointerdown="swipe.onDown($event, t.id)" @pointermove="swipe.onMove" @pointerup="swipe.onUp" @pointercancel="swipe.onUp" @click.capture="swipe.onClickCapture">
      <NoticeCard :item="t" :ms="t.ms" :round="t.round" :held="t.paused !== null" :close-label="text.common.close" @close="dismiss(t.id)" @hold="holdToast(t.id, $event)" />
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
import NoticeCard from "./NoticeCard.vue";
import { toasts, dismiss, holdToast } from "../composables/toasts.ts";
import { useSwipeDismiss } from "../composables/swipe-dismiss.ts";
import { text } from "../text/index.ts";

// 밀어 치운 알림은 민 자리에서 오른쪽으로 마저 빠진다(나가는 전환이 translate를 옮긴다)
const swipe = useSwipeDismiss(dismiss, () => ({ translate: "calc(100% + var(--gap-out)) 0" }));
</script>
