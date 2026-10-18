<template>
  <!-- 배경 편집 창의 시간 막대(2026-10-13 사용자, 프리미어 · 베가스 스타일). 영상은 편집 창이 쥐고, 이것은 시각 · 구간 · 썸네일을 보이고 바꾸자고 알린다.
       위: 지금 시각(시:분:초;프레임) · 10초 전 · 1프레임 전 · 재생/일시정지 · 1프레임 뒤 · 10초 뒤 · 썸네일 설정.
       가운데: 시간 눈금(확대에 맞춰 간격이 바뀐다)에 재생 위치 · 썸네일 마커, 마커에서 띠 아래까지 줄. 띠는 일정 간격으로 뜬 장면을 깔고, 구간 밖은 어둡게, 양 끝 핸들로 구간.
       눈금이나 띠를 누르거나 끌면 그 위치로. 아래: 왼쪽 확대, 오른쪽 시작 · 끝 · 썸네일 시각(누르면 그 위치로).
       장면은 봇이 가져올 때 만든 장면 띠(GET …/:id/strip, 격자 WebP 한 장)를 셀마다 잘라 깐다. 띠가 아직 없으면 빈 띠 -->
  <!-- 키로 다루려고 포커스를 받는다. 공통 포커스 테두리(3px) 대신 시간 막대 영역에 가는 1px 테두리로 포커스를 보인다(2026-10-13 사용자) -->
  <div class="group/tl flex flex-col gap-2 select-none outline-none focus-visible:outline-none" tabindex="0" @keydown="onKey">
    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <span class="flex items-center gap-2">
        <span class="font-mono text-sm nums">{{ tc(now) }}</span>
        <!-- 구간 반복 재생(끄면 구간 끝에서 멈춘다) -->
        <button type="button" :class="[ICON_BTN, 'size-9', loop && 'bg-secondary-container! text-on-secondary-container!']" :aria-pressed="loop" :aria-label="T.loop" v-tooltip="loop ? T.loopOn : T.loopOff" @click="emit('loop')"><Icon name="repeat" :size="20" /></button>
      </span>
      <div class="flex items-center gap-0.5">
        <!-- 재생 위치를 구간 시작 · 끝으로(편집기의 In · Out, 키 I · O) -->
        <BaseButton size="sm" variant="secondary" class="mr-1" v-tooltip="T.markInTip" @click="markIn">{{ T.markIn }}</BaseButton>
        <button type="button" :class="[ICON_BTN, 'size-9']" :aria-label="T.back10" v-tooltip="T.back10" @click="emit('seek', now - 10)"><Icon name="skip_previous" :size="20" /></button>
        <button type="button" :class="[ICON_BTN, 'size-9']" :aria-label="T.backFrame" v-tooltip="T.backFrame" @click="emit('seek', now - 1 / fps)"><Icon name="chevron_right" :size="22" class="rotate-180" /></button>
        <button type="button" :class="[ICON_BTN, 'size-11']" class="bg-primary! text-on-primary!" :aria-label="playing ? T.pause : T.play" @click="emit('toggle')"><Icon :name="playing ? 'pause' : 'play_arrow'" :size="24" fill /></button>
        <button type="button" :class="[ICON_BTN, 'size-9']" :aria-label="T.nextFrame" v-tooltip="T.nextFrame" @click="emit('seek', now + 1 / fps)"><Icon name="chevron_right" :size="22" /></button>
        <button type="button" :class="[ICON_BTN, 'size-9']" :aria-label="T.next10" v-tooltip="T.next10" @click="emit('seek', now + 10)"><Icon name="skip_next" :size="20" /></button>
        <BaseButton size="sm" variant="secondary" class="ml-1" v-tooltip="T.markOutTip" @click="markOut">{{ T.markOut }}</BaseButton>
      </div>
      <BaseButton size="sm" variant="secondary" class="justify-self-end" @click="emit('thumb')">{{ T.useAsThumb }}</BaseButton>
    </div>

    <!-- 가로 스크롤 공간을 늘 비워 둔다(확대해서 스크롤바가 생겨도 창 높이가 그대로) -->
    <div ref="scrollEl" class="overflow-x-scroll overflow-y-hidden rounded-lg bg-surface-container-highest outline outline-1 outline-transparent transition-[outline-color] duration-150 group-focus/tl:outline-primary" :style="SCROLLBAR" @scroll="scrollLeft = ($event.target as HTMLElement).scrollLeft">
      <!-- 시간 0 · 끝은 양옆 PAD 안쪽. 그 바깥은 구간 핸들 · 마커 머리가 들어갈 빈 공간(넘치는 것은 잘라 스크롤이 생기지 않게) -->
      <div ref="contentEl" class="relative overflow-hidden cursor-ew-resize touch-none" :style="{ width: `${contentWidth}px` }" @pointerdown="scrubStart">
        <!-- 시간 눈금 -->
        <div class="relative h-7 border-b border-outline-variant">
          <template v-for="tick in ticks" :key="tick.t">
            <span class="absolute bottom-0 w-px bg-on-surface-variant/60" :class="tick.major ? 'h-3' : 'h-1.5'" :style="{ left: `${x(tick.t)}px` }"></span>
            <span v-if="tick.major" class="absolute top-0.5 ml-1 text-2xs font-mono text-on-surface-variant whitespace-nowrap" :style="{ left: `${x(tick.t)}px` }">{{ tick.label }}</span>
          </template>
          <!-- 썸네일 마커(◆) · 재생 위치 마커(▼) -->
          <span v-if="thumbAt !== null" class="absolute bottom-0.5 size-3 -ml-1.5 rotate-45 bg-tertiary cursor-pointer" :style="{ left: `${x(thumbAt)}px` }" v-tooltip="T.thumbMark" @pointerdown.stop="emit('seek', thumbAt)"></span>
          <span class="absolute bottom-0 -ml-2 w-4 h-3 bg-primary [clip-path:polygon(0_0,100%_0,100%_45%,50%_100%,0_45%)] pointer-events-none" :style="{ left: `${x(now)}px` }"></span>
        </div>
        <!-- 띠: 장면 · 구간 -->
        <div class="relative" :style="{ height: `${BAR_H}px` }">
          <!-- 장면 · 구간 밖 어둡게: 시간이 있는 곳(PAD 안쪽)만 -->
          <div class="absolute inset-y-0 overflow-hidden bg-black" :style="{ left: `${PAD}px`, right: `${PAD}px` }">
            <span v-for="tile in tiles" :key="tile.left" class="absolute top-0 h-full bg-no-repeat pointer-events-none" :style="tile.style"></span>
            <span class="absolute inset-y-0 left-0 bg-black/65 pointer-events-none" :style="{ width: `${x(range[0]) - PAD}px` }"></span>
            <span class="absolute inset-y-0 right-0 bg-black/65 pointer-events-none" :style="{ left: `${x(range[1]) - PAD}px` }"></span>
          </div>
          <!-- 구간 틀: 핸들이 구간 바깥에 붙는다(핸들 안쪽 끝이 구간 끝) -->
          <span class="absolute inset-y-0 rounded-md border-y-2 border-primary pointer-events-none" :style="{ left: `${x(range[0]) - HANDLE_W}px`, width: `${x(range[1]) - x(range[0]) + HANDLE_W * 2}px` }"></span>
          <span v-for="side in [0, 1] as const" :key="side" class="absolute inset-y-0 bg-primary cursor-ew-resize flex items-center justify-center" :class="side ? 'rounded-r-md' : 'rounded-l-md'" :style="{ left: `${side ? x(range[1]) : x(range[0]) - HANDLE_W}px`, width: `${HANDLE_W}px` }" :aria-label="side ? T.end : T.start" v-tooltip="side ? T.end : T.start" @pointerdown.stop="rangeStart($event, side)"><span class="h-5 w-0.5 rounded-full bg-on-primary/70"></span></span>
        </div>
        <!-- 마커에서 띠 아래까지 뻗은 줄 -->
        <span v-if="thumbAt !== null" class="absolute top-6 bottom-0 w-px -ml-px bg-tertiary pointer-events-none" :style="{ left: `${x(thumbAt)}px` }"></span>
        <span class="absolute top-6 bottom-0 w-0.5 -ml-px bg-primary pointer-events-none" :style="{ left: `${x(now)}px` }"></span>
      </div>
    </div>

    <!-- 아래: 왼쪽 확대, 오른쪽 시작 · 끝 · 썸네일 시각(누르면 그 위치로) · 구간 길이 -->
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs nums">
      <label class="flex items-center gap-2">
        <span class="text-on-surface-variant">{{ T.zoom }}</span>
        <input v-model.number="zoomStep" type="range" min="0" max="100" step="1" class="m3-slider m3-slider-thin w-36" :style="{ '--v': zoomStep / 100 }" :aria-label="T.zoom" />
        <span class="w-10">{{ zoom < 10 ? zoom.toFixed(1) : Math.round(zoom) }}×</span>
      </label>
      <span class="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
        <button v-for="one in points" :key="one.label" type="button" class="flex items-center gap-1.5 cursor-pointer hover:underline" @click="emit('seek', one.t)">
          <span class="size-2 rounded-full" :class="one.dot"></span>{{ one.label }} <span class="font-mono">{{ tc(one.t) }}</span>
        </button>
        <span class="text-on-surface-variant">{{ T.length(range[1] - range[0]) }}</span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import { ICON_BTN } from "../utils/icon-button.ts";
import type { LoginBackgroundStrip } from "../../../src/dashboard/contract/login-background.ts";
import { text } from "../text/index.ts";
const T = text.loginBackground.timeline;

/** strip: 장면 띠(주소와 모양, 없으면 빈 띠). aspect: 가로 ÷ 세로. now · range · thumbAt 은 초 */
const props = defineProps<{ strip: { url: string; shape: LoginBackgroundStrip } | null; duration: number; fps: number; aspect: number; now: number; playing: boolean; range: [number, number]; thumbAt: number | null; loop: boolean }>();
/** peek: 구간 핸들을 끄는 동안 그 장면만 보여 달라(재생 위치는 그대로), peekEnd: 놓았으니 재생 위치로 돌아가 달라 */
const emit = defineEmits<{ seek: [t: number]; peek: [t: number]; peekEnd: []; toggle: []; range: [range: [number, number]]; thumb: []; loop: [] }>();

/** 시간 막대의 가로 스크롤바는 다른 곳보다 굵게(끌어서 옮기기 쉽게, 2026-10-13 사용자). 핸들은 가장자리 3px 를 비운 나머지 */
const SCROLLBAR = { "--sb-size": "1rem", scrollbarWidth: "auto" as const };
/** 구간 핸들의 폭(px) */
const HANDLE_W = 12;
/** 시간 0 · 끝 바깥의 빈 공간(px): 구간이 끝까지 닿아도 바깥에 붙는 핸들 · 마커 머리가 들어간다 */
const PAD = HANDLE_W;
/** 띠의 높이(px) */
const BAR_H = 64;
/** 눈금 간격 후보(초). 프레임 단위는 fps 로 */
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

const scrollEl = ref<HTMLElement | null>(null);
const contentEl = ref<HTMLElement | null>(null);
const viewWidth = ref(600);
const scrollLeft = ref(0);
const zoomStep = ref(0);
let observer: ResizeObserver | null = null;

/** 확대: 0 ~ 100 을 1 배 ~ (가장 크면 화면에 5초 남짓)배로, 지수로 */
const maxZoom = computed(() => Math.min(64, Math.max(1, props.duration / 5)));
const zoom = computed(() => Math.pow(maxZoom.value, zoomStep.value / 100));
const contentWidth = computed(() => Math.max(1, Math.round(viewWidth.value * zoom.value)));
/** 시간이 있는 폭(양옆 PAD 를 뺀 것) */
const pxPerSec = computed(() => (props.duration ? Math.max(1, contentWidth.value - PAD * 2) / props.duration : 0));
const x = (t: number) => PAD + t * pxPerSec.value;
const tileW = computed(() => Math.round(BAR_H * (props.strip ? props.strip.shape.width / props.strip.shape.height : props.aspect || 16 / 9)));
const fpsInt = computed(() => Math.max(1, Math.round(props.fps || 30)));

/** 시:분:초;프레임 */
function tc(t: number) {
  const total = Math.floor(Math.max(0, t) * fpsInt.value + 1e-6);
  const ff = total % fpsInt.value;
  const s = Math.floor(total / fpsInt.value);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)};${p(ff)}`;
}

/** 보이는 만큼의 눈금: 큰 눈금은 80px 넘게 띄우고 이름을 단다. 작은 눈금은 그 아래 후보 중 8px 넘는 것 */
const ticks = computed(() => {
  if (!pxPerSec.value) return [];
  const candidates = [1 / fpsInt.value, 2 / fpsInt.value, 5 / fpsInt.value, 10 / fpsInt.value, ...STEPS].filter((step, i, all) => all.indexOf(step) === i).sort((a, b) => a - b);
  const major = candidates.find((step) => step * pxPerSec.value >= 80) ?? candidates[candidates.length - 1];
  const minor = [...candidates].reverse().find((step) => step < major && step * pxPerSec.value >= 8 && Math.abs(major / step - Math.round(major / step)) < 1e-6) ?? major;
  // 눈금은 작은 간격의 정수 배로 센다(더해 가면 소수 오차가 쌓인다)
  const every = Math.round(major / minor);
  const first = Math.max(0, Math.floor((scrollLeft.value - PAD) / pxPerSec.value / minor));
  const last = Math.min(Math.floor(props.duration / minor + 1e-6), Math.ceil((scrollLeft.value + viewWidth.value - PAD) / pxPerSec.value / minor));
  const label = (t: number) => (major < 1 ? tc(t).slice(3) : props.duration >= 3600 ? tc(t).slice(0, 8) : tc(t).slice(3, 8));
  const out: Array<{ t: number; major: boolean; label: string }> = [];
  for (let k = first; k <= last; k++) {
    const t = k * minor;
    out.push({ t, major: k % every === 0, label: k % every === 0 ? label(t) : "" });
  }
  return out;
});

/** 보이는 만큼의 장면 셀: 셀 가운데 시각의 장면을 띠 그림에서 잘라(배경 위치) 깐다 */
const tiles = computed(() => {
  const strip = props.strip;
  if (!strip || !strip.shape.count || !props.duration) return [];
  const { count, every, columns, width, height } = strip.shape;
  const k = BAR_H / height;
  const rows = Math.ceil(count / columns);
  const inner = contentWidth.value - PAD * 2;
  const first = Math.max(0, Math.floor((scrollLeft.value - PAD) / tileW.value));
  const last = Math.ceil((scrollLeft.value + viewWidth.value - PAD) / tileW.value);
  const out: Array<{ left: number; style: Record<string, string> }> = [];
  for (let i = first; i <= last; i++) {
    const left = i * tileW.value;
    if (left >= inner) break;
    const t = (left + tileW.value / 2) / pxPerSec.value;
    const at = Math.min(count - 1, Math.floor(t / every));
    const col = at % columns;
    const row = Math.floor(at / columns);
    out.push({ left, style: { left: `${left}px`, width: `${tileW.value}px`, backgroundImage: `url("${strip.url}")`, backgroundSize: `${columns * width * k}px ${rows * height * k}px`, backgroundPosition: `${-col * width * k}px ${-row * height * k}px` } });
  }
  return out;
});

const points = computed(() => [{ label: T.start, t: props.range[0], dot: "bg-primary" }, { label: T.end, t: props.range[1], dot: "bg-primary" }, ...(props.thumbAt !== null ? [{ label: T.thumbMark, t: props.thumbAt, dot: "bg-tertiary" }] : [])]);

// ── 누르기 · 끌기 ──

/** 누른 위치의 시각(자르지 않음) · 영상 안으로 자른 것 */
const rawTimeAt = (clientX: number) => (clientX - contentEl.value!.getBoundingClientRect().left - PAD) / pxPerSec.value;
const timeAt = (clientX: number) => Math.min(Math.max(0, rawTimeAt(clientX)), props.duration);
function scrubStart(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  emit("seek", timeAt(e.clientX));
  el.onpointermove = (m) => emit("seek", timeAt(m.clientX));
  el.onpointerup = el.onpointercancel = () => (el.onpointermove = el.onpointerup = el.onpointercancel = null);
}
/** 구간 핸들: 서로 1초 안으로는 붙지 않는다. 끄는 동안 재생 위치는 그대로 두고 화면만 핸들 장면을 보이고, 놓으면 재생 위치로 돌아간다 */
function rangeStart(e: PointerEvent, side: 0 | 1) {
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  // 핸들은 구간 바깥에 붙어 있어 누른 위치와 구간 끝이 다르다. 그 차이를 기억해 잡자마자 튀지 않게
  const grab = rawTimeAt(e.clientX) - props.range[side];
  emit("peek", props.range[side]);
  el.onpointermove = (m) => {
    const t = Math.min(Math.max(0, rawTimeAt(m.clientX) - grab), props.duration);
    const next: [number, number] = [...props.range];
    next[side] = side === 0 ? Math.min(t, next[1] - 1) : Math.max(t, next[0] + 1);
    emit("range", next);
    emit("peek", next[side]);
  };
  el.onpointerup = el.onpointercancel = () => {
    el.onpointermove = el.onpointerup = el.onpointercancel = null;
    emit("peekEnd");
  };
}

/** 재생 위치를 구간 시작으로. 끝을 넘으면 끝을 1초 뒤로 민다(영상 안에서) */
function markIn() {
  const t = Math.min(props.now, props.duration - 1);
  emit("range", [t, Math.min(props.duration, Math.max(props.range[1], t + 1))]);
}
/** 재생 위치를 구간 끝으로. 시작보다 앞이면 시작을 1초 앞으로 민다 */
function markOut() {
  const t = Math.max(props.now, 1);
  emit("range", [Math.max(0, Math.min(props.range[0], t - 1)), t]);
}

/** 키: 스페이스 재생 · 좌우 1프레임 · Shift+좌우 10초 · I 시작점 · O 끝점 */
function onKey(e: KeyboardEvent) {
  const step = e.shiftKey ? 10 : 1 / fpsInt.value;
  if (e.key === " ") emit("toggle");
  else if (e.key === "i" || e.key === "I") markIn();
  else if (e.key === "o" || e.key === "O") markOut();
  else if (e.key === "ArrowLeft") emit("seek", props.now - step);
  else if (e.key === "ArrowRight") emit("seek", props.now + step);
  else return;
  e.preventDefault();
}

// 확대해도 재생 위치가 화면의 같은 위치에 남게, 재생 위치가 화면 밖으로 나가면 따라간다
watch(zoom, async (next, prev) => {
  const el = scrollEl.value;
  if (!el || !props.duration) return;
  const onScreen = PAD + props.now * ((viewWidth.value * prev - PAD * 2) / props.duration) - el.scrollLeft;
  await nextTick();
  el.scrollLeft = x(props.now) - onScreen;
});
watch(
  () => props.now,
  (t) => {
    const el = scrollEl.value;
    if (!el) return;
    const at = x(t);
    if (at < el.scrollLeft || at > el.scrollLeft + el.clientWidth - 8) el.scrollLeft = Math.max(0, at - el.clientWidth * 0.2);
  },
);

onMounted(() => {
  observer = new ResizeObserver(([entry]) => (viewWidth.value = entry.contentRect.width));
  if (scrollEl.value) observer.observe(scrollEl.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>
