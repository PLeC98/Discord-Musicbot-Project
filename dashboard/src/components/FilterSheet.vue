<template>
  <!-- 필터 창. 휴대폰은 바텀 시트(M3 모달 바텀 시트), 그 밖(태블릿, 좁은 PC 창)은 가운데 팝업(M3 대화상자). 안의 필터는 선택하는 대로 바로 반영된다(적용 버튼이 없다).
       팝업은 드래그만 없고 나머지(헤더의 초기화, 뒤 누르기, 기기의 뒤로, Esc 로 닫기)는 같다.
       시트 드래그: 핸들, 헤더는 늘, 내용은 맨 위에서 아래로 드래그할 때(대기열 시트와 같은 손짓) -->
  <Teleport to="body">
    <!-- 팝업: 뒤는 서서히 어두워지고 창은 가운데서 조금 커지며 나타난다 -->
    <BaseDialog v-if="!isPhone" :open="open" width="md" padding="none" class="max-h-[calc(100dvh-2rem)] flex flex-col" :aria-label="title" @close="emit('close')">
      <header class="flex items-center gap-3 px-6 pt-5 pb-3">
        <Icon name="tune" :size="22" class="text-on-surface-variant" />
        <h2 class="flex-1 text-lg font-semibold">{{ title }}</h2>
        <BaseButton variant="ghost" size="sm" @click="emit('reset')"><Icon name="restart_alt" :size="18" />{{ T.reset }}</BaseButton>
      </header>
      <div class="flex-1 min-h-0 overflow-y-auto px-6 pb-6 flex flex-col gap-5">
        <slot />
      </div>
    </BaseDialog>
    <!-- 바텀 시트: 뒤는 서서히 어두워지고 시트는 아래에서 미끄러져 올라온다(올라올 때 spring, 내려갈 때 가속 곡선 200ms) -->
    <Transition v-else name="sheet" :duration="{ enter: 460, leave: 200 }">
      <div v-if="open" class="fixed inset-0 z-300">
        <div class="sheet-scrim absolute inset-0 bg-black/50" :style="{ opacity: scrimOpacity }" @click="emit('close')"></div>
        <section ref="panel" role="dialog" aria-modal="true" :aria-label="title" class="sheet-panel absolute inset-x-0 bottom-0 max-h-[85dvh] flex flex-col rounded-t-2xl bg-surface-container-low shadow-[0_-2px_12px_rgb(0_0_0/0.18)]" :class="{ 'is-dragging': drag !== null, 'is-settling': settling }" :style="{ '--drag': `${drag ?? 0}px` }">
          <div class="touch-none select-none cursor-grab active:cursor-grabbing" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
            <div class="flex justify-center pt-3 pb-1"><span class="w-8 h-1 rounded-full bg-on-surface-variant/40"></span></div>
            <header class="flex items-center gap-3 px-4 h-12">
              <Icon name="tune" :size="22" class="text-on-surface-variant" />
              <h2 class="flex-1 text-lg font-semibold">{{ title }}</h2>
              <BaseButton variant="ghost" size="sm" @pointerdown.stop @click="emit('reset')"><Icon name="restart_alt" :size="18" />{{ T.reset }}</BaseButton>
            </header>
          </div>
          <div ref="body" class="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-1 pb-[calc(1.25rem+env(safe-area-inset-bottom))] flex flex-col gap-5" @touchstart.passive="touchStart" @touchmove="touchMove" @touchend="touchEnd" @touchcancel="touchEnd">
            <slot />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Icon from "./BaseIcon.vue";
import BaseButton from "./BaseButton.vue";
import BaseDialog from "./BaseDialog.vue";
import { useCloseLayer } from "../composables/close-layer.ts";
import { useMediaQuery } from "@vueuse/core";
import { PHONE_QUERY } from "../utils/breakpoints.ts";
import { text } from "../text/index.ts";

const props = withDefaults(defineProps<{ open: boolean; title?: string }>(), { title: text.fields.filter });
const emit = defineEmits<{ close: []; reset: [] }>();
const T = text.common;
// 휴대폰은 바텀 시트, 그 밖은 가운데 팝업
const isPhone = useMediaQuery(PHONE_QUERY);

// Esc, 기기의 뒤로는 시트를 닫는다(위에 연 드롭다운이 있으면 그것부터). 팝업은 BaseDialog 가 같은 일을 한다
useCloseLayer(
  computed(() => props.open && isPhone.value),
  () => emit("close"),
);
watch(
  () => props.open,
  () => (drag.value = null),
);

// ── 드래그 ──
const panel = ref<HTMLElement | null>(null);
const body = ref<HTMLElement | null>(null);
/** 드래그하는 동안 내린 거리(px). 아니면 null */
const drag = ref<number | null>(null);
/** 놓은 뒤 제자리로 돌아가는 동안 */
const settling = ref(false);
const height = () => panel.value?.offsetHeight ?? 1;
const scrimOpacity = computed(() => (drag.value === null ? undefined : String(Math.max(0, 1 - drag.value / height()))));

let start: { id: number; y: number } | null = null;
let last = { y: 0, t: 0, v: 0 };
const follow = (y: number, t: number, from: number) => {
  drag.value = Math.max(0, y - from);
  const dt = t - last.t;
  if (dt > 0) last = { y, t, v: (y - last.y) / dt };
};
/** 놓았다: 4분의 1 넘게 내렸거나 아래로 빠르게 튕겼으면 닫고(남은 길은 닫히는 애니메이션이 간다), 아니면 제자리로 */
function release() {
  const d = drag.value ?? 0;
  if (d > height() / 4 || last.v > 0.5) {
    emit("close");
    return;
  }
  settling.value = true;
  drag.value = null;
  window.setTimeout(() => (settling.value = false), 460);
}

// 핸들, 헤더: 마우스, 손가락 모두
function down(e: PointerEvent) {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  (e.currentTarget as Element).setPointerCapture(e.pointerId);
  start = { id: e.pointerId, y: e.clientY };
  last = { y: e.clientY, t: e.timeStamp, v: 0 };
}
function move(e: PointerEvent) {
  if (!start || e.pointerId !== start.id) return;
  if (drag.value === null && Math.abs(e.clientY - start.y) < 4) return;
  follow(e.clientY, e.timeStamp, start.y);
}
function up(e: PointerEvent) {
  if (!start || e.pointerId !== start.id) return;
  start = null;
  if (drag.value !== null) release();
}

// 내용: 맨 위에서 아래로 드래그하면 시트가 따라 내려온다(그 밖은 내용 스크롤). 첫 움직임에서 정하고, 시트가 맡으면 그 손짓 내내 스크롤을 막는다
let touch: { y: number; mode: "sheet" | "native" | null } | null = null;
function touchStart(e: TouchEvent) {
  if (e.touches.length !== 1) return void (touch = null);
  touch = { y: e.touches[0].clientY, mode: null };
  last = { y: touch.y, t: e.timeStamp, v: 0 };
}
function touchMove(e: TouchEvent) {
  if (!touch || e.touches.length !== 1) return;
  const y = e.touches[0].clientY;
  if (!touch.mode) {
    if (Math.abs(y - touch.y) < 6) return;
    touch.mode = y > touch.y && (body.value?.scrollTop ?? 0) <= 0 ? "sheet" : "native";
    touch.y = y;
  }
  if (touch.mode !== "sheet") return;
  if (e.cancelable) e.preventDefault();
  follow(y, e.timeStamp, touch.y);
}
function touchEnd() {
  if (touch?.mode === "sheet") release();
  touch = null;
}
</script>

<style>
/* 시트의 위치: 드래그하는 동안 내린 거리(--drag). 드래그하는 동안은 손가락을 바로 따라가고, 놓아 제자리로 돌아갈 때만 미끄러진다 */
.sheet-panel {
  translate: 0 var(--drag, 0px);
}
.sheet-panel.is-settling {
  transition: translate 460ms var(--ease-spring);
}
/* 오버레이는 서서히, 시트는 미끄러져. 둘이 따로 움직이도록 루트에는 걸지 않는다(시트가 흐려지지 않게). 드래그해서 내린 뒤 닫으면 그 자리에서 마저 내려간다 */
.sheet-enter-active > .sheet-scrim {
  transition: opacity 250ms var(--ease-effects);
}
.sheet-enter-active > section {
  transition: translate 460ms var(--ease-spring);
}
.sheet-leave-active > .sheet-scrim {
  transition: opacity 160ms var(--ease-effects);
}
.sheet-leave-active > section {
  transition: translate 200ms var(--ease-accelerate);
}
.sheet-enter-from > .sheet-scrim,
.sheet-leave-to > .sheet-scrim {
  opacity: 0 !important;
}
.sheet-enter-from > section,
.sheet-leave-to > section {
  translate: 0 100%;
}
</style>
