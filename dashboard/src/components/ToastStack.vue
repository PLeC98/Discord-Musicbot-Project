<template>
  <!-- 자리는 App.vue 가 잡는다(화면 오른쪽 위, 라우터 화면 밖이라 페이지를 옮겨도 남는다).
       새 알림은 맨 위로 위에서 내려오고(나머지는 아래로 밀린다), 사라질 때는 오른쪽으로 빠진다. 끌어서(마우스 · 터치) 오른쪽으로 밀어 치운다 -->
  <TransitionGroup tag="div" class="contents" aria-live="polite" enter-from-class="opacity-0 -translate-y-full" enter-active-class="transition-[opacity,translate] duration-300 spring-fast motion-reduce:transition-none" leave-active-class="absolute! inset-x-0 transition-[opacity,translate] duration-200 ease-in motion-reduce:transition-none" leave-to-class="opacity-0! translate-x-[calc(100%+var(--gap-out))]!" move-class="transition-transform duration-300 spring-fast" @after-leave="onLeft">
    <div v-for="t in toasts" :key="t.id" role="status" class="pointer-events-auto relative overflow-hidden flex gap-3 items-start rounded-xl pl-3 pr-2 py-3 text-body pane-menu touch-pan-y select-none cursor-grab active:cursor-grabbing transition-[opacity,translate] duration-200 ease-out" :style="styleOf(t.id)" @pointerdown="onDown($event, t.id)" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
      <!-- 아래 띠: 왼쪽부터 차서 다 차면 사라진다(같은 알림이 다시 오면 처음부터) -->
      <span :key="t.round" class="toast-time absolute left-0 bottom-0 h-1 w-full origin-left" :class="LOOK[t.severity].bar" :style="{ animationDuration: `${t.ms}ms` }"></span>
      <span class="size-9 shrink-0 rounded-full flex items-center justify-center" :class="LOOK[t.severity].badge"><Icon :name="LOOK[t.severity].icon" :size="20" /></span>
      <div class="flex-1 min-w-0 whitespace-pre-line">
        <div class="flex items-baseline gap-2 pt-1.5">
          <span class="flex-1 min-w-0 font-semibold text-on-surface">{{ t.title }}</span>
          <time class="shrink-0 text-label text-on-surface-variant nums" :datetime="new Date(t.at).toISOString()">{{ clock(t.at) }}</time>
        </div>
        <div v-if="t.body" class="text-on-surface-variant">{{ t.body }}</div>
        <div v-if="t.detail" class="text-on-surface-variant">{{ t.detail }}</div>
        <a v-if="t.reportUrl" :href="t.reportUrl" target="_blank" rel="noopener" class="text-primary text-label font-semibold hover:underline">{{ text.common.reportToDeveloper }}</a>
        <div v-if="t.codeLine" class="text-on-surface-variant text-label mt-0.5">{{ t.codeLine }}</div>
      </div>
      <button class="tap state-layer size-8 shrink-0 rounded-full flex items-center justify-center text-on-surface-variant cursor-pointer" :aria-label="text.common.close" @click="dismiss(t.id)"><Icon name="close" :size="20" /></button>
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { ref } from "vue";
import Icon from "./BaseIcon.vue";
import { toasts, dismiss } from "../composables/toasts.ts";
import { TOAST_LOOK, toastClock } from "../utils/toast-look.ts";
import { text } from "../text/index.ts";

const LOOK = TOAST_LOOK;
const clock = toastClock;

// ── 밀어 치우기(마우스 · 터치 · 펜) ──
// 폭의 30% 를 넘기거나 빠르게 튕기면(0.5px/ms 이상, 16px 이상) 치운다. 못 미치면 제자리로 돌아간다.
// 치운 알림은 끌던 자리에서 오른쪽으로 마저 빠지도록 사라질 때까지 위치를 쥐고 있는다(after-leave 에서 놓는다)
type Drag = { id: number; startX: number; dx: number; width: number; lastX: number; lastT: number; speed: number; live: boolean };
const drag = ref<Drag | null>(null);

function styleOf(id: number) {
  const d = drag.value;
  if (!d || d.id !== id) return undefined;
  return { translate: `${d.dx}px 0`, opacity: String(1 - Math.min(d.dx / d.width, 1) * 0.5), ...(d.live && { transition: "none" }) };
}

function onDown(event: PointerEvent, id: number) {
  if (drag.value || (event.target as Element).closest("a, button")) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const el = event.currentTarget as HTMLElement;
  el.setPointerCapture(event.pointerId);
  drag.value = { id, startX: event.clientX, dx: 0, width: el.offsetWidth, lastX: event.clientX, lastT: event.timeStamp, speed: 0, live: true };
}

function onMove(event: PointerEvent) {
  const d = drag.value;
  if (!d?.live) return;
  // 왼쪽으로는 끌리지 않는다
  d.dx = Math.max(0, event.clientX - d.startX);
  const dt = event.timeStamp - d.lastT;
  if (dt > 0) d.speed = (event.clientX - d.lastX) / dt;
  d.lastX = event.clientX;
  d.lastT = event.timeStamp;
}

// 밀어 치운 알림이 다 빠졌으면 쥐고 있던 위치를 놓는다(다른 알림을 끄는 중이면 그대로)
function onLeft() {
  if (drag.value && !drag.value.live) drag.value = null;
}

function onUp() {
  const d = drag.value;
  if (!d?.live) return;
  d.live = false;
  if (d.dx > d.width * 0.3 || (d.speed > 0.5 && d.dx > 16)) dismiss(d.id);
  else drag.value = null;
}
</script>

<style scoped>
.toast-time {
  transform: scaleX(0);
  animation: toast-time linear forwards;
}
@keyframes toast-time {
  to {
    transform: scaleX(1);
  }
}
</style>
