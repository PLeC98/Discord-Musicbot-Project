<!--
  색 선택. 견본 동그라미를 누르면 판이 열린다. 판: 채도 · 밝기 판, 색상 막대, 값 입력란(HEX · RGB · HSV 중 선택한 형식). 값은 #RRGGBB(대문자)로 올린다.
  브라우저의 색 선택(input type=color)은 브라우저 · 운영체제마다 모양이 달라 쓰지 않는다.

  입력하다 만 값처럼 색이 아니면 fallback 색으로 보인다.
  판 안에서는 HSV 를 그대로 들고 있다. #RRGGBB · RGB 로는 채도나 밝기가 0 일 때 색상이 사라져,
  검정까지 끌었다 돌아오면 색상이 빨강으로 튄다. 바깥 값이 판의 색과 달라졌을 때만(글로 입력했을 때) 다시 읽는다.
-->
<template>
  <span ref="root" class="relative inline-flex shrink-0">
    <button ref="trigger" type="button" class="tap size-6 rounded-full border border-outline-variant cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" :style="{ background: shown }" :aria-label="label" :aria-expanded="open" aria-haspopup="dialog" v-tooltip="label" @click="open = !open"></button>

    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-190" @mousedown="open = false"></div>

      <!-- 메뉴 면(이모지 선택과 같다): 바탕 surface-container-low · 모서리 16. 안쪽 둘레 12, 맨 아래 기본 색으로(40 + 선) -->
      <div v-if="open" ref="panel" role="dialog" :aria-label="label" :class="PANEL" :style="popoverStyle" @keydown.esc.stop="close">
        <div class="flex flex-col gap-3 p-3">
          <!-- 채도(가로) · 밝기(세로) 판. 화살표로 1%, Shift 를 같이 누르면 10% -->
          <div ref="area" role="slider" tabindex="0" :aria-label="T.colorArea" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(hsv.s * 100)" :aria-valuetext="T.colorAreaValue(Math.round(hsv.s * 100), Math.round(hsv.v * 100))" class="relative h-40 rounded-md cursor-crosshair touch-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" :style="{ background: areaPaint }" @pointerdown="grab" @pointermove="drag" @keydown="nudge">
            <span class="pointer-events-none absolute size-5 -translate-1/2 rounded-full border-2 border-white ring-1 ring-black/30 shadow-md" :style="{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }"></span>
          </div>

          <input type="range" min="0" max="359" step="1" :value="Math.round(hsv.h)" :aria-label="T.colorHue" class="hue" :style="{ '--hue': `hsl(${hsv.h} 100% 50%)` }" @input="set({ h: +valueOf($event) })" />

          <!-- 값 입력란의 형식: 이어 붙은 버튼 그룹(하나 선택). 선택한 형식은 브라우저가 기억한다 -->
          <div class="flex gap-0.5" role="radiogroup" :aria-label="T.colorFormat">
            <button v-for="(one, i) in FORMATS" :key="one" type="button" role="radio" :aria-checked="format === one" :class="segment(format === one, i, FORMATS.length)" @click="pickFormat(one)">{{ one.toUpperCase() }}</button>
          </div>

          <!-- 선택한 색 견본(40, 입력란과 같은 높이) + 값 입력란. 입력란 밑에 짧은 이름. 수는 화살표로 1, Shift 를 같이 누르면 10 -->
          <div class="flex items-start gap-2">
            <span class="size-10 shrink-0 rounded-full border border-outline-variant" :style="{ background: hex }"></span>
            <label v-if="format === 'hex'" class="flex-1 min-w-0 flex flex-col items-center">
              <input :value="hex" spellcheck="false" maxlength="7" :aria-label="T.colorHex" :class="[FIELD, 'w-full px-3! text-center font-mono']" @input="typeHex" @change="settleHex" @keydown.enter="settleHex" />
              <span :class="CHANNEL_NAME">HEX</span>
            </label>
            <label v-for="one in channels" v-else :key="one.key" class="flex-1 min-w-0 flex flex-col items-center">
              <input :value="one.value" inputmode="numeric" maxlength="3" :aria-label="T.colorChannel[one.key]" :class="[FIELD, 'w-full px-1! text-center font-mono']" @input="typeChannel($event, one)" @blur="settleChannel($event, one)" @keydown="stepChannel($event, one)" />
              <span :class="CHANNEL_NAME">{{ one.key.toUpperCase() }}</span>
            </label>
          </div>
        </div>

        <button v-if="clearable" type="button" class="state-layer shrink-0 h-10 w-full border-t border-outline-variant/50 text-sm text-on-surface-variant cursor-pointer" @click="clear">{{ T.colorDefault }}</button>
      </div>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch, type CSSProperties } from "vue";
import { hexToHsv, hsvToHex, hsvToRgb, isHex, keepHue, parseHex, rgbToHsv, type Hsv } from "../utils/color.ts";
import { coveredBottom } from "../composables/anchored-panel.ts";
import { valueOf } from "../utils/dom.ts";
import { rem } from "../utils/rem.ts";
import { FIELD } from "../utils/field.ts";
import { segment } from "../utils/segment.ts";
import { readStored, writeStored } from "../utils/storage.ts";
import { text } from "../text/index.ts";
const T = text.fields;

const props = defineProps<{
  /** 입력란의 값. 비었거나 아직 색이 아니면 fallback 으로 보인다 */
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
// 값을 비우면 기본 색이다. 이미 비었으면 기본 색으로 버튼을 보이지 않는다
const clearable = computed(() => props.modelValue.trim() !== "");

const hsv = ref<Hsv>(hexToHsv(shown.value));
const hex = computed(() => hsvToHex(hsv.value));
watch(shown, (now) => {
  if (now !== hex.value) hsv.value = keepHue(hexToHsv(now), hsv.value);
});

// 판 바탕: 아래로 갈수록 검정, 왼쪽으로 갈수록 흰색, 맨 밑은 지금 색상의 가장 진한 색
const areaPaint = computed(() => `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.value.h} 100% 50%)`);

function set(next: Partial<Hsv>) {
  hsv.value = { ...hsv.value, ...next };
  emit("update:modelValue", hex.value);
}

/** 다른 형식(HEX · RGB)으로 지정한 색. 검정 · 무채색이면 지금 색상을 남긴다 */
function adopt(next: Hsv) {
  hsv.value = keepHue(next, hsv.value);
  emit("update:modelValue", hex.value);
}

const unit = (n: number) => Math.min(1, Math.max(0, n));

// 값 입력란의 형식. 못 읽거나 못 쓰는 환경(사생활 보호 창 등)이면 HEX 로 시작한다
const FORMATS = ["hex", "rgb", "hsv"] as const;
type Format = (typeof FORMATS)[number];
const FORMAT_KEY = "colorPicker.format";
const stored = readStored(FORMAT_KEY);
const format = ref<Format>(FORMATS.find((one) => one === stored) ?? "hex");
function pickFormat(one: Format) {
  format.value = one;
  writeStored(FORMAT_KEY, one);
}

// HEX 입력란: 여섯 자리가 되면 바로 받는다(# 은 없어도 된다). 세 자리(#RGB)는 다 입력했을 때(Enter · 입력란을 떠날 때) 늘려 받고, 색이 아니면 지금 색으로 되돌린다
function typeHex(event: Event) {
  const typed = valueOf(event).trim().replace(/^#/, "");
  const parsed = typed.length === 6 ? parseHex(typed) : null;
  if (parsed) adopt(hexToHsv(parsed));
}

function settleHex(event: Event) {
  const input = event.target as HTMLInputElement;
  const parsed = parseHex(input.value);
  if (parsed && parsed !== hex.value) adopt(hexToHsv(parsed));
  input.value = hex.value;
}

// RGB(0~255) · HSV(색상 0~359 · 채도 · 밝기 0~100) 입력란
type ChannelKey = "r" | "g" | "b" | "h" | "s" | "v";
type Channel = { key: ChannelKey; max: number; value: number };
const channels = computed<Channel[]>(() => {
  if (format.value === "rgb") {
    const rgb = hsvToRgb(hsv.value);
    return [
      { key: "r", max: 255, value: rgb.r },
      { key: "g", max: 255, value: rgb.g },
      { key: "b", max: 255, value: rgb.b },
    ];
  }
  return [
    { key: "h", max: 359, value: Math.round(hsv.value.h) },
    { key: "s", max: 100, value: Math.round(hsv.value.s * 100) },
    { key: "v", max: 100, value: Math.round(hsv.value.v * 100) },
  ];
});

function setChannel(one: Channel, n: number) {
  const value = Math.min(one.max, Math.max(0, Math.round(n)));
  if (one.key === "r" || one.key === "g" || one.key === "b") adopt(rgbToHsv({ ...hsvToRgb(hsv.value), [one.key]: value }));
  else set({ [one.key]: one.key === "h" ? value : value / 100 });
  return value;
}

// 숫자만 받고 넘치면 끝값으로. 지운 글자 · 줄인 값은 입력란에 바로 되돌린다(값이 같으면 Vue 가 다시 그리지 않는다)
function typeChannel(event: Event, one: Channel) {
  const input = event.target as HTMLInputElement;
  const digits = input.value.replace(/\D/g, "");
  if (!digits) {
    input.value = "";
    return;
  }
  input.value = String(setChannel(one, Number(digits)));
}

// 비운 채 떠나면 지금 값으로
function settleChannel(event: Event, one: Channel) {
  const input = event.target as HTMLInputElement;
  if (!input.value) input.value = String(channels.value.find((now) => now.key === one.key)?.value ?? one.value);
}

function stepChannel(event: KeyboardEvent, one: Channel) {
  const dir = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
  if (!dir) return;
  event.preventDefault();
  setChannel(one, one.value + dir * (event.shiftKey ? 10 : 1));
}

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

// 판을 표시할 위치: 동그라미 아래, 넘치면 위(아래 재생바가 가리는 만큼은 빼고). 왼쪽은 동그라미에 맞추고 화면 안에 둔다
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

const CHANNEL_NAME = "mt-1 text-2xs text-on-surface-variant";
const PANEL = "fixed z-200 flex flex-col overflow-hidden rounded-lg pane-menu bg-surface-container-low!";
</script>

<style scoped>
/* 색상 막대: 빨강에서 한 바퀴 돌아 빨강. 핸들은 지금 색상을 채운 흰 테두리 동그라미(판의 핸들과 같다) */
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
