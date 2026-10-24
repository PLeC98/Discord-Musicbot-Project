<template>
  <!-- 돌려서 고르는 휠(알람 앱처럼). 세 줄이 보이고 가운데가 고른 값. 끝에서 처음으로 이어진다(같은 값을 다섯 벌 늘어놓고 가운데 벌로 되돌린다).
       손가락으로 밀기 · 마우스 휠(한 번 굴리면 step 만큼, OS · 브라우저의 스크롤 양과 상관없이) · 마우스로 끌기 · 위아래 화살표. 가운데를 누르면 그 자리가 입력칸이 되어 직접 친다(Enter · 다른 곳을 누르면 반영, Esc 는 그만) -->
  <div class="relative select-none" :style="{ height: `${rowPx * 3}px` }">
    <!-- 가운데 띠 -->
    <div class="pointer-events-none absolute inset-x-0 rounded-(--r-row) bg-secondary-container" :style="{ top: `${rowPx}px`, height: `${rowPx}px` }"></div>
    <div
      ref="list"
      class="relative h-full overflow-y-scroll scrollbar-none snap-y snap-mandatory overscroll-contain outline-none cursor-grab active:cursor-grabbing [mask-image:linear-gradient(to_bottom,transparent,black_30%,black_70%,transparent)]"
      tabindex="0"
      role="spinbutton"
      :aria-label="label"
      :aria-valuenow="modelValue"
      :aria-valuemin="0"
      :aria-valuemax="count - 1"
      @scroll="onScroll"
      @wheel.prevent="onWheel"
      @keydown.up.prevent="stepBy(-1)"
      @keydown.down.prevent="stepBy(1)"
      @keydown.enter.prevent="startTyping"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
    >
      <div :style="{ height: `${rowPx}px` }"></div>
      <button v-for="i in count * COPIES" :key="i" type="button" tabindex="-1" class="snap-center w-full flex items-center justify-center nums cursor-pointer" :class="[big ? 'text-2xl' : 'text-lg', (i - 1) % count === modelValue ? 'font-semibold text-on-secondary-container' : 'text-on-surface-variant']" :style="{ height: `${rowPx}px` }" @click="clickRow(i - 1)">
        {{ pad((i - 1) % count) }}
      </button>
      <div :style="{ height: `${rowPx}px` }"></div>
    </div>
    <!-- 직접 치기: 가운데 띠 자리에 입력칸 -->
    <input v-if="typing" ref="field" v-model="draft" inputmode="numeric" maxlength="2" :class="big ? 'text-2xl' : 'text-lg'" class="absolute inset-x-0 text-center font-semibold nums rounded-(--r-row) bg-surface-container-highest border border-primary outline-none" :style="{ top: `${rowPx}px`, height: `${rowPx}px` }" :aria-label="label" @keydown.enter.prevent="commit" @keydown.esc.stop.prevent="typing = false" @blur="commit" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";

/** count: 값의 수(0 ~ count-1, 시 24 · 분 60). step: 마우스 휠 한 번에 움직이는 양(그 배수로 맞춘다). big: 한 줄 40 · 글자 24(남는 자리가 넓을 때) */
const props = withDefaults(defineProps<{ modelValue: number; count: number; label: string; step?: number; big?: boolean }>(), { step: 1, big: false });
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

/** 한 줄 높이(px) */
const rowPx = computed(() => (props.big ? 40 : 32));
const COPIES = 5;
const MIDDLE = Math.floor(COPIES / 2);
const pad = (n: number) => String(n).padStart(2, "0");

const list = ref<HTMLElement | null>(null);
// 줄 i(0 부터, 늘어놓은 전체에서)가 가운데에 오는 스크롤 위치. 앞의 빈 줄 하나가 있어 i * 줄 높이다
const topOf = (i: number) => i * rowPx.value;
const rowNow = () => Math.round((list.value?.scrollTop ?? 0) / rowPx.value);

// 값으로 맞춘다. 바로 맞출 때는 가운데 벌로, 미끄러질 때는 지금 자리에서 가까운 쪽으로(59 → 0 이 한 바퀴를 거꾸로 돌지 않게).
// 가운데 벌을 벗어나 있으면 같은 그림인 가운데 벌로 먼저 옮겨 두어 끝에 닿지 않게 한다
function show(value: number, smooth = false) {
  const el = list.value;
  if (!el) return;
  const c = props.count;
  if (!smooth) return el.scrollTo({ top: topOf(MIDDLE * c + value), behavior: "instant" });
  let now = rowNow();
  const mid = MIDDLE * c + (((now % c) + c) % c);
  if (now !== mid) el.scrollTop = topOf((now = mid));
  let diff = (((value - now) % c) + c) % c;
  if (diff > c / 2) diff -= c;
  el.scrollTo({ top: topOf(now + diff), behavior: "smooth" });
}
onMounted(() => show(props.modelValue));
// 줄 높이가 바뀌면(화면을 돌리면) 다시 그린 뒤 같은 값으로 맞춘다
watch(rowPx, () => void nextTick(() => show(props.modelValue)));
watch(
  () => props.modelValue,
  (v) => {
    if (rowNow() % props.count !== v) show(v, true);
  },
);

// 스크롤이 멎으면 가운데 값을 고르고, 가장자리 벌에 와 있으면 같은 값의 가운데 벌로 되돌린다(이어진 것처럼)
let settleTimer: number | undefined;
function onScroll() {
  clearTimeout(settleTimer);
  settleTimer = window.setTimeout(settle, 90);
}
function settle() {
  if (dragging) return;
  const row = rowNow();
  const value = ((row % props.count) + props.count) % props.count;
  if (value !== props.modelValue) emit("update:modelValue", value);
  const copy = Math.floor(row / props.count);
  if (copy !== MIDDLE) show(value);
}
function stepBy(by: number) {
  emit("update:modelValue", (props.modelValue + by + props.count) % props.count);
}

// 마우스 휠: 한 번 "도록"에 step 만큼. 한 번에 크게 오는 것(마우스 휠)은 크기와 상관없이 한 번으로, 잘게 오는 것(터치패드)은 모아서 한 번으로 친다
const NOTCH = 40;
let wheelSum = 0;
let wheelAt = 0;
function onWheel(e: WheelEvent) {
  if (e.timeStamp - wheelAt > 200) wheelSum = 0;
  wheelAt = e.timeStamp;
  const dy = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY : e.deltaY * NOTCH;
  wheelSum = Math.abs(dy) >= NOTCH ? Math.sign(dy) * NOTCH : wheelSum + dy;
  if (Math.abs(wheelSum) < NOTCH) return;
  const down = wheelSum > 0;
  wheelSum = 0;
  // step 의 배수로: 22분에서 아래로 → 25, 위로 → 20
  const s = props.step;
  const next = down ? Math.floor(props.modelValue / s) * s + s : Math.ceil(props.modelValue / s) * s - s;
  emit("update:modelValue", ((next % props.count) + props.count) % props.count);
}

// 줄을 눌렀다: 가운데면 직접 치기, 아니면 그 줄로
function clickRow(i: number) {
  if (moved) return;
  if (i === rowNow()) return startTyping();
  list.value?.scrollTo({ top: topOf(i), behavior: "smooth" });
}

// 마우스로 끌기(손가락 · 휠은 브라우저 스크롤이 한다)
let dragging = false;
let moved = false;
let start = { y: 0, top: 0 };
function down(e: PointerEvent) {
  moved = false;
  if (e.pointerType !== "mouse" || e.button !== 0 || !list.value) return;
  dragging = true;
  start = { y: e.clientY, top: list.value.scrollTop };
  list.value.style.scrollSnapType = "none";
}
function move(e: PointerEvent) {
  if (!dragging || !list.value) return;
  const dy = e.clientY - start.y;
  if (Math.abs(dy) > 3) moved = true;
  list.value.scrollTop = start.top - dy;
}
function up() {
  if (!dragging || !list.value) return;
  dragging = false;
  list.value.style.scrollSnapType = "";
  list.value.scrollTo({ top: topOf(rowNow()), behavior: "smooth" });
}

// 직접 치기
const typing = ref(false);
const draft = ref("");
const field = ref<HTMLInputElement | null>(null);
function startTyping() {
  draft.value = "";
  typing.value = true;
  void nextTick(() => field.value?.focus());
}
// 포커스를 먼저 휠로 돌려준다(스크롤 없이). 값을 넣은 뒤에 돌려주면 그 포커스가 휠이 미끄러져 돌아가는 것을 끊는다
function commit() {
  if (!typing.value) return;
  typing.value = false;
  list.value?.focus({ preventScroll: true });
  const n = Number(draft.value);
  if (draft.value.trim() !== "" && Number.isInteger(n) && n >= 0 && n < props.count) emit("update:modelValue", n);
}
</script>
