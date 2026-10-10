<template>
  <!-- 휴대폰 서버 화면(스포티파이식)의 대기열 판(M3 아래 판, bottom sheet). 화면 아래에 늘 머리가 보이고(접힘) 끌어 올리면 반 · 끝까지.
       머리(손잡이 · 제목 · 곡 수 · 조작)를 끌거나 누른다. 누르면 접힘 ↔ 반. 반 이상이면 뒤를 어둡게 하고 뒤를 누르면 접힌다.
       끄는 동안 손가락을 따라오고, 놓으면 빠르기 · 가까운 단계로 간다. 높이는 바탕화면 높이(--desk-h)에서 잰다.
       끝까지 펼치기 전에는 내용도 판을 끈다(스포티파이처럼 목록을 굴리려 하면 판이 먼저 올라온다): 안의 목록은 구르지 않고(반만 보일 때 목록 아래가 화면 밖이라 스크롤바가 밖으로 나갔다),
       위로 끌면 판이 따라오고 끝까지 닿으면 같은 손짓으로 목록이 구른다. 끝까지 펼친 뒤 목록 맨 위에서 아래로 끌면 판이 내려간다. 휠을 내리면 끝까지 펼친다. 입력 · 단추 · 링크 · 순서 바꾸기 손잡이에서 시작한 동작은 그대로 둔다 -->
  <div v-if="shown > 0.01" class="fixed inset-0 z-30 bg-black/40" :class="dragOffset === null && 'transition-opacity duration-300 ease-effects'" :style="{ opacity: shown * 0.9 }" @click="stop = 'peek'"></div>
  <section class="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl bg-surface-container-low shadow-[0_-2px_12px_rgb(0_0_0/0.18)]" :class="dragOffset === null && 'transition-[translate] duration-500 ease-spring'" :style="{ height: `${full}px`, translate: `0 ${full - visible}px` }" :aria-label="T.queue">
    <header :class="compact ? 'pb-1' : 'pb-2'" class="shrink-0 px-4 touch-none select-none cursor-grab active:cursor-grabbing" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
      <!-- 끌기 손잡이(M3 32×4) -->
      <div class="flex justify-center" :class="compact ? 'pt-2 pb-2' : 'pt-3 pb-3'"><span class="w-8 h-1 rounded-full bg-on-surface-variant/40"></span></div>
      <div class="flex items-center gap-3 h-10">
        <span class="size-9 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0"><Icon :name="icon" :size="20" /></span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-semibold text-on-surface truncate">{{ title }}</h2>
            <slot name="badge" />
          </div>
          <!-- 접혔을 때만: 다음 곡 -->
          <p v-if="stop === 'peek' && next" class="-mt-0.5 text-xs text-on-surface-variant truncate">{{ T.upNext(next) }}</p>
        </div>
        <!-- 조작은 끌기에서 뺀다 -->
        <div class="shrink-0 flex items-center gap-2" @pointerdown.stop><slot name="actions" /></div>
      </div>
    </header>
    <!-- 내용: 접힌 동안은 숨기고(초점이 가지 않게), 펼치면 남은 높이를 쓴다 -->
    <!-- 아래 여백은 안의 목록이 굴러가는 내용 안에 둔다(여기 두면 스크롤바가 그만큼 위에서 끝난다) -->
    <div class="flex-1 min-h-0 flex flex-col px-4" :class="stop !== 'full' && 'touch-none [&_.overflow-y-auto]:overflow-hidden'" :inert="stop === 'peek' && dragOffset === null" ref="bodyEl" @pointerdown="bodyDown" @touchstart="touchStart" @touchmove="touchMove" @touchend="touchEnd" @touchcancel="touchEnd" @pointermove="move" @pointerup="up" @pointercancel="up" @wheel="bodyWheel">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "./BaseIcon.vue";
import type { IconName } from "../icons.ts";
import { text } from "../text/index.ts";
const T = text.player;

/** compact: 낮은 화면(휴대폰 가로). 머리를 64 로 줄인다 */
const props = withDefaults(defineProps<{ title: string; icon?: IconName; next?: string; deskHeight: number; compact?: boolean }>(), { icon: "queue_music", next: "", compact: false });

type Stop = "peek" | "half" | "full";
const stop = ref<Stop>("peek");
/** 접힘 · 반 · 끝까지의 보이는 높이(px) */
const peek = computed(() => (props.compact ? 64 : 76));
const full = computed(() => Math.max(peek.value + 100, props.deskHeight - 8));
const heights = computed<Record<Stop, number>>(() => ({ peek: peek.value, half: Math.round(full.value * 0.6), full: full.value }));

// 끄는 동안 보이는 높이(아니면 null)
const dragOffset = ref<number | null>(null);
const visible = computed(() => dragOffset.value ?? heights.value[stop.value]);
/** 펼친 정도(접힘 0 ~ 끝까지 1). 뒤 막의 진하기 */
const shown = computed(() => Math.min(1, Math.max(0, (visible.value - peek.value) / (full.value - peek.value))));

let start: { id: number; y: number; h: number; body: boolean } | null = null;
let moved = false;
let last = { y: 0, t: 0, v: 0 };

function down(e: PointerEvent) {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  (e.currentTarget as Element).setPointerCapture(e.pointerId);
  start = { id: e.pointerId, y: e.clientY, h: visible.value, body: false };
  moved = false;
  last = { y: e.clientY, t: e.timeStamp, v: 0 };
}
function move(e: PointerEvent) {
  if (!start || e.pointerId !== start.id) return;
  const dy = e.clientY - start.y;
  if (!moved && Math.abs(dy) < 6) return;
  // 내용에서 시작했으면 움직이기 시작할 때 잡는다(누르기 · 입력은 그대로 가게)
  if (!moved && start.body) (e.currentTarget as Element).setPointerCapture(e.pointerId);
  moved = true;
  dragOffset.value = Math.min(full.value, Math.max(peek.value, start.h - dy));
  const dt = e.timeStamp - last.t;
  if (dt > 0) last = { y: e.clientY, t: e.timeStamp, v: (e.clientY - last.y) / dt };
}
function up(e: PointerEvent) {
  if (!start || e.pointerId !== start.id) return;
  if (!moved) {
    // 머리를 눌렀다: 접힘 ↔ 반(내용을 누른 것은 안의 것이 받는다)
    if (!start.body) stop.value = stop.value === "peek" ? "half" : "peek";
  } else settle(dragOffset.value ?? visible.value, last.v);
  dragOffset.value = null;
  start = null;
}
/** 놓은 높이 h · 빠르기 v(px/ms, 위로 튕기면 음수)로 단계를 정한다. 빠르게 튕기면 그 방향으로 한 단계 */
function settle(h: number, v: number) {
  const order: Stop[] = ["peek", "half", "full"];
  stop.value = v < -0.5 ? order[Math.min(2, order.indexOf(nearest(h, "up")))] : v > 0.5 ? order[Math.max(0, order.indexOf(nearest(h, "down")))] : nearest(h);
}
// 내용에서 판 끌기(끝까지 펼치기 전만). 안의 조작에서 시작한 것은 받지 않는다
const OWN = "input, textarea, select, button, a, [role=slider], .touch-none";
function bodyDown(e: PointerEvent) {
  if (e.pointerType !== "mouse" || stop.value === "full" || e.button !== 0) return;
  if ((e.target as Element).closest(OWN)) return;
  start = { id: e.pointerId, y: e.clientY, h: visible.value, body: true };
  moved = false;
  last = { y: e.clientY, t: e.timeStamp, v: 0 };
}
// ── 손가락: 판과 목록을 한 손짓으로 잇는다(스포티파이처럼) ──
// 끝까지 펼치기 전: 위로 끌면 판이 올라오고, 끝까지 닿은 뒤 남은 움직임은 같은 손짓으로 목록을 굴린다(놓으면 그 빠르기로 관성).
// 끝까지 펼친 뒤: 목록 맨 위에서 아래로 끌면 목록 대신 판이 내려간다. 그 밖(목록을 굴리던 중 · 위로)은 브라우저가 굴린다.
// 첫 움직임에서 정하고, 판을 맡으면 그 손짓 내내 브라우저 굴리기를 막는다(touchmove 를 preventDefault)
const bodyEl = ref<HTMLElement | null>(null);
const scroller = () => bodyEl.value?.querySelector<HTMLElement>(".overflow-y-auto") ?? null;
let touch: { y: number; h: number; top: number; mode: "sheet" | "native" | null; lastY: number; lastT: number; v: number } | null = null;
let glide = 0;

function touchStart(e: TouchEvent) {
  cancelAnimationFrame(glide);
  if (e.touches.length !== 1 || (e.target as Element).closest(OWN)) return void (touch = null);
  const y = e.touches[0].clientY;
  touch = { y, h: visible.value, top: scroller()?.scrollTop ?? 0, mode: null, lastY: y, lastT: e.timeStamp, v: 0 };
}
// 처음 움직인 쪽으로 누가 맡을지 정한다: 판(sheet) 또는 목록 굴리기(native). 아직 문턱 안이면 false
function pickMode(t: NonNullable<typeof touch>, y: number) {
  const dy = y - t.y;
  if (Math.abs(dy) < 6) return false;
  const list = scroller();
  const atTop = !list || list.scrollTop <= 0;
  t.mode = stop.value !== "full" || (atTop && dy > 0) ? "sheet" : "native";
  // 판을 맡은 곳에서 다시 잰다(움직임 문턱만큼 튀지 않게)
  t.y = y;
  t.h = visible.value;
  t.top = list?.scrollTop ?? 0;
  return true;
}
function touchMove(e: TouchEvent) {
  if (!touch || e.touches.length !== 1) return;
  const y = e.touches[0].clientY;
  if (!touch.mode && !pickMode(touch, y)) return;
  if (touch.mode !== "sheet") return;
  if (e.cancelable) e.preventDefault();
  const list = scroller();
  let want = touch.h - (y - touch.y);
  // 끝까지 넘친 만큼은 목록을 굴린다(되돌아 내리면 목록이 먼저 돌아오고 그다음 판이 내려간다)
  if (want > full.value) {
    if (list) list.scrollTop = touch.top + (want - full.value);
    want = full.value;
  } else if (list && list.scrollTop !== touch.top) list.scrollTop = touch.top;
  dragOffset.value = Math.max(peek.value, want);
  const dt = e.timeStamp - touch.lastT;
  if (dt > 0) touch = { ...touch, v: (y - touch.lastY) / dt, lastY: y, lastT: e.timeStamp };
}
function touchEnd() {
  if (!touch) return;
  if (touch.mode === "sheet") {
    const h = dragOffset.value ?? visible.value;
    const list = scroller();
    if (h >= full.value - 1 && list && list.scrollTop > touch.top) {
      // 목록을 굴리던 끝: 끝까지 펼친 채 그 빠르기로 미끄러진다
      stop.value = "full";
      coast(list, -touch.v);
    } else settle(h, touch.v);
    dragOffset.value = null;
  }
  touch = null;
}
/** 목록 관성: 빠르기 v(px/ms, 아래로 굴리면 양수)를 프레임마다 줄여 가며 굴린다 */
function coast(list: HTMLElement, v: number) {
  let speed = v * 16;
  const step = () => {
    if (Math.abs(speed) < 0.5) return;
    list.scrollTop += speed;
    speed *= 0.95;
    glide = requestAnimationFrame(step);
  };
  glide = requestAnimationFrame(step);
}

/** 끝까지 펼치기 전에 휠을 내리면 끝까지 */
function bodyWheel(e: WheelEvent) {
  if (stop.value === "full" || e.deltaY <= 0) return;
  e.preventDefault();
  stop.value = "full";
}

/** h 에 가장 가까운 단계. dir 이 있으면 그 방향 쪽 단계 */
function nearest(h: number, dir?: "up" | "down"): Stop {
  const list = (Object.entries(heights.value) as [Stop, number][]).sort((a, b) => a[1] - b[1]);
  if (dir === "up") return (list.find(([, v]) => v > h) ?? list[list.length - 1])[0];
  if (dir === "down") return ([...list].reverse().find(([, v]) => v < h) ?? list[0])[0];
  return list.reduce((best, cur) => (Math.abs(cur[1] - h) < Math.abs(best[1] - h) ? cur : best))[0];
}

/** 밖에서 열고 닫는다(대기열 단추 등) */
function open(to: Stop = "half") {
  stop.value = to;
}
defineExpose({ open });
</script>
