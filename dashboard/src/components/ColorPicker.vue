<!--
  색 고르기. 견본 동그라미를 누르면 판이 뜬다. 판: 채도 · 밝기 판, 색상 막대, 고른 색. 값은 #RRGGBB(대문자)로 올린다.
  브라우저의 색 고르기(input type=color)는 브라우저 · 운영체제마다 모양이 달라 쓰지 않는다.

  값을 글로 적는 칸은 부르는 쪽이 따로 둔다. 적다 만 값처럼 색이 아니면 fallback 색으로 보인다.
  판 안에서는 HSV 를 그대로 들고 있다. #RRGGBB 로는 채도나 밝기가 0 일 때 색상이 사라져,
  검정까지 끌었다 돌아오면 색상이 빨강으로 튄다. 바깥 값이 판의 색과 달라졌을 때만(글로 적었을 때) 다시 읽는다.
-->
<template>
  <span ref="root" class="relative inline-flex shrink-0">
    <button ref="trigger" type="button" class="tap size-6 rounded-full border border-outline-variant cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" :style="{ background: shown }" :aria-label="label" :aria-expanded="open" aria-haspopup="dialog" v-tooltip="label" @click="open = !open"></button>

    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-190" @mousedown="open = false"></div>

      <!-- 메뉴 면(이모지 고르기와 같다): 바탕 surface-container-low · 모서리 16. 안쪽 둘레 12, 맨 아래 기본 색으로(40 + 선) -->
      <div v-if="open" ref="panel" role="dialog" :aria-label="label" :class="PANEL" :style="popoverStyle" @keydown.esc.stop="close">
        <div class="flex flex-col gap-3 p-3">
          <!-- 채도(가로) · 밝기(세로) 판. 화살표로 1%, Shift 를 같이 누르면 10% -->
          <div ref="area" role="slider" tabindex="0" :aria-label="T.colorArea" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(hsv.s * 100)" :aria-valuetext="T.colorAreaValue(Math.round(hsv.s * 100), Math.round(hsv.v * 100))" class="relative h-40 rounded-md cursor-crosshair touch-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" :style="{ background: areaPaint }" @pointerdown="grab" @pointermove="drag" @keydown="nudge">
            <span class="pointer-events-none absolute size-5 -translate-1/2 rounded-full border-2 border-white ring-1 ring-black/30 shadow-md" :style="{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }"></span>
          </div>

          <input type="range" min="0" max="359" step="1" :value="Math.round(hsv.h)" :aria-label="T.colorHue" class="hue" :style="{ '--hue': `hsl(${hsv.h} 100% 50%)` }" @input="set({ h: +valueOf($event) })" />

          <div class="flex items-center gap-3">
            <span class="size-8 shrink-0 rounded-full border border-outline-variant" :style="{ background: hex }"></span>
            <span class="font-mono text-sm text-on-surface select-all">{{ hex }}</span>
          </div>
        </div>

        <button v-if="clearable" type="button" class="state-layer shrink-0 h-10 w-full border-t border-outline-variant/50 text-sm text-on-surface-variant cursor-pointer" @click="clear">{{ T.colorDefault }}</button>
      </div>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch, type CSSProperties } from "vue";
import { hexToHsv, hsvToHex, isHex, type Hsv } from "../utils/color.ts";
import { coveredBottom } from "../composables/anchored-panel.ts";
import { valueOf } from "../utils/dom.ts";
import { rem } from "../utils/rem.ts";
import { text } from "../text/index.ts";
const T = text.fields;

const props = defineProps<{
  /** 칸의 값. 비었거나 아직 색이 아니면 fallback 으로 보인다 */
  modelValue: string;
  /** 값이 없을 때의 색(기본값) */
  fallback: string;
  /** 견본 동그라미 · 판의 이름(툴팁 · 읽어 주기) */
  label: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const open = ref(false);
const root = useTemplateRef<HTMLElement>("root");
const trigger = useTemplateRef<HTMLButtonElement>("trigger");
const panel = useTemplateRef<HTMLElement>("panel");
const area = useTemplateRef<HTMLElement>("area");
const popoverStyle = ref<CSSProperties>({});

const shown = computed(() => {
  const value = props.modelValue.trim();
  return isHex(value) ? value.toUpperCase() : props.fallback.toUpperCase();
});
// 값을 비우면 기본 색이다. 이미 비었으면 기본 색으로 단추를 보이지 않는다
const clearable = computed(() => props.modelValue.trim() !== "");

const hsv = ref<Hsv>(hexToHsv(shown.value));
const hex = computed(() => hsvToHex(hsv.value));
watch(shown, (now) => {
  if (now !== hex.value) hsv.value = hexToHsv(now);
});

// 판 바탕: 아래로 갈수록 검정, 왼쪽으로 갈수록 흰색, 맨 밑은 지금 색상의 가장 진한 색
const areaPaint = computed(() => `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.value.h} 100% 50%)`);

function set(next: Partial<Hsv>) {
  hsv.value = { ...hsv.value, ...next };
  emit("update:modelValue", hex.value);
}

const unit = (n: number) => Math.min(1, Math.max(0, n));

function pick(event: PointerEvent) {
  const rect = area.value?.getBoundingClientRect();
  if (!rect?.width || !rect.height) return;
  set({ s: unit((event.clientX - rect.left) / rect.width), v: unit(1 - (event.clientY - rect.top) / rect.height) });
}

function grab(event: PointerEvent) {
  if (event.button !== 0) return;
  area.value?.setPointerCapture(event.pointerId);
  area.value?.focus();
  pick(event);
}

function drag(event: PointerEvent) {
  if (area.value?.hasPointerCapture(event.pointerId)) pick(event);
}

const ARROWS: Record<string, [ds: number, dv: number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

function nudge(event: KeyboardEvent) {
  const arrow = ARROWS[event.key];
  if (!arrow) return;
  event.preventDefault();
  const step = event.shiftKey ? 0.1 : 0.01;
  set({ s: unit(hsv.value.s + arrow[0] * step), v: unit(hsv.value.v + arrow[1] * step) });
}

function close() {
  open.value = false;
  trigger.value?.focus();
}

function clear() {
  emit("update:modelValue", "");
  close();
}

// 판을 띄울 자리: 동그라미 아래, 넘치면 위(아래 재생바가 가리는 만큼은 자리가 아니다). 왼쪽은 동그라미에 맞추고 화면 안에 둔다
const WIDTH_REM = 16;
function place() {
  const rect = root.value?.getBoundingClientRect();
  if (!rect || !root.value) return;
  const width = rem(WIDTH_REM);
  const height = panel.value?.offsetHeight ?? rem(18);
  const floor = window.innerHeight - coveredBottom(root.value);
  const below = rect.bottom + 4;
  const top = below + height > floor ? Math.max(8, rect.top - height - 4) : below;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  popoverStyle.value = { top: `${Math.round(top)}px`, left: `${Math.round(left)}px`, width: `${width}px` };
}

// 판은 화면 기준으로 놓이므로 페이지가 움직이면 다시 놓는다. 안쪽 스크롤 상자도 잡게 capture 로 듣는다
const listen = (add: boolean) => {
  if (add) {
    window.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
  } else {
    window.removeEventListener("scroll", place, { capture: true });
    window.removeEventListener("resize", place);
  }
};

watch(open, async (isOpen) => {
  listen(isOpen);
  if (!isOpen) return;
  place();
  await nextTick();
  place(); // 그린 뒤 실제 높이로 다시(위로 뒤집을지)
  area.value?.focus();
});

onBeforeUnmount(() => listen(false));

const PANEL = "fixed z-200 flex flex-col overflow-hidden rounded-lg pane-menu bg-surface-container-low!";
</script>

<style scoped>
/* 색상 막대: 빨강에서 한 바퀴 돌아 빨강. 손잡이는 지금 색상을 채운 흰 테두리 동그라미(판의 손잡이와 같다) */
.hue {
  width: 100%;
  height: 12px;
  margin: 0;
  border-radius: 999px;
  background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}

.hue::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border: 2px solid #fff;
  border-radius: 999px;
  background: var(--hue);
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.3),
    0 1px 3px rgb(0 0 0 / 0.3);
}

.hue::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 2px solid #fff;
  border-radius: 999px;
  background: var(--hue);
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.3),
    0 1px 3px rgb(0 0 0 / 0.3);
}

.hue::-moz-range-track {
  background: transparent;
}

.hue:focus-visible {
  outline: 2px solid var(--md-primary);
  outline-offset: 4px;
}
</style>
