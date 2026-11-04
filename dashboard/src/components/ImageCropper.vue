<template>
  <!-- 이미지에서 쓸 영역을 선택하는 편집 면(편집 창 안에 둔다). 틀은 aspect(가로 ÷ 세로)를 지킨다.
       turn 이면 90도 회전, 좌우 반전 버튼도 둔다. 영역은 원본을 돌리고 그다음 뒤집은 이미지의 px 로 다룬다(봇이 원본에 같은 차례로 적용한다).
       이미지는 원본 그대로 두고 CSS 로 돌려 보인다(움직이는 GIF, WebP 가 움직인다) -->
  <div class="flex flex-col gap-3">
    <!-- 보는 창: 편집 창 폭 전체, 처음 맞춘 높이. 이미지가 창보다 작으면 가운데, 확대해서 넘치면 그 안에서 스크롤한다.
               둘레에 틈을 두어 이미지 가장자리에 붙은 핸들도 잘리지 않게 한다 -->
    <div ref="viewportEl" class="w-full" :class="zoom > 1 ? 'overflow-auto' : 'overflow-hidden'" :style="{ height: `${viewHeight + EDGE * 2}px` }">
      <div class="flex min-w-full min-h-full w-max h-max" :class="zoom > 1 && 'cursor-grab'" :style="{ padding: `${EDGE}px` }" @pointerdown="panStart">
        <div class="relative m-auto shrink-0 select-none touch-none" :style="{ width: `${size.width * scale}px`, height: `${size.height * scale}px` }">
          <!-- 이미지와 바깥을 어둡게 덮는 그림자는 이미지 안에서만(큰 그림자를 이미지 밖으로 내지 않게 자른다) -->
          <div class="absolute inset-0 overflow-hidden rounded-lg">
            <img v-if="url" :src="url" alt="" class="absolute max-w-none pointer-events-none" :style="imageStyle(scale)" draggable="false" />
            <div class="absolute shadow-[0_0_0_9999px_rgb(0_0_0/0.55)]" :style="box"></div>
          </div>
          <!-- 선택한 영역의 틀과 핸들은 자르지 않는 레이어에(이미지 밖으로 나와도 보이고 잡힌다). 안을 드래그하면 옮긴다. 핸들은 보이는 것보다 넓게 잡힌다 -->
          <div class="absolute outline-2 outline-white cursor-move" :style="box" @pointerdown="start($event, 'move')">
            <span v-for="corner in CORNERS" :key="corner" class="absolute size-4 -m-2 rounded-full bg-white shadow before:absolute before:-inset-2" :class="[corner.includes('n') ? 'top-0' : 'bottom-0', corner.includes('w') ? 'left-0' : 'right-0', corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize']" @pointerdown.stop="start($event, corner)"></span>
          </div>
        </div>
      </div>
    </div>
    <!-- 화면 확대: 작은 아이콘, 슬라이더, 큰 아이콘(디스코드의 이미지 편집과 같은 형태). 그 옆에 회전, 반전 -->
    <div class="flex items-center justify-center gap-3 text-on-surface-variant">
      <Icon name="image" :size="16" aria-hidden="true" />
      <input v-model.number="zoomStep" type="range" min="0" max="100" step="1" class="m3-slider m3-slider-thin w-48" :style="{ '--v': zoomStep / 100 }" :aria-label="T.zoom" :disabled="!ready" />
      <Icon name="image" :size="24" aria-hidden="true" />
      <template v-if="turn">
        <button type="button" :class="iconButton(40)" :disabled="!ready" :aria-label="T.rotate" v-tooltip="T.rotate" @click="turnRight"><Icon name="rotate_right" /></button>
        <button type="button" :class="iconButton(40)" :disabled="!ready" :aria-label="T.flip" v-tooltip="T.flip" @click="mirror"><Icon name="flip" /></button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import Icon from "./BaseIcon.vue";
import { iconButton } from "../utils/icon-button.ts";
import { text } from "../text/index.ts";
const T = text.appearance.crop;

/** file: 자를 이미지. aspect: 가로 ÷ 세로(1 이면 정사각형). turn: 회전, 반전 버튼을 둔다 */
const props = withDefaults(defineProps<{ file: File | null; aspect: number; turn?: boolean }>(), { turn: false });

type Corner = "nw" | "ne" | "sw" | "se";
type Rotation = 0 | 90 | 180 | 270;
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
/** 틀의 가장 작은 짧은 변(원본 px) */
const MIN_SIDE = 16;
/** 보는 창 둘레의 틈(px). 이미지 가장자리의 핸들(반지름 8px)과 넓게 잡히는 범위(8px)가 들어가 스크롤이 생기지 않게 */
const EDGE = 16;
/** 화면 확대의 상한(배) */
const MAX_ZOOM = 5;

const url = ref("");
/** 원본 크기(EXIF 방향대로 세운 것, 브라우저가 보이는 대로) */
const natural = reactive({ width: 0, height: 0 });
/** 원본에 적용하는 회전(시계 방향, 도)과 그다음 좌우 반전 */
const rotate = ref<Rotation>(0);
const flip = ref(false);
/** 선택한 영역(돌리고 뒤집은 이미지의 px) */
const sel = reactive({ x: 0, y: 0, w: 0, h: 0 });
/** 화면 px ÷ 원본 px(확대 전) */
const fitScale = ref(1);
let image: HTMLImageElement | null = null;

const ready = computed(() => natural.width > 0);
/** 돌린 이미지의 크기(90도, 270도면 가로세로가 바뀐다) */
const size = computed(() => (rotate.value % 180 ? { width: natural.height, height: natural.width } : { width: natural.width, height: natural.height }));
/** 보는 창 높이. 돌릴 수 있으면 어느 방향이든 들어가는 높이로 둬 돌릴 때 창이 들썩이지 않게 */
const viewHeight = computed(() => (props.turn ? Math.max(natural.width, natural.height) : size.value.height) * fitScale.value);

const viewportEl = ref<HTMLElement | null>(null);
/** 화면 확대: 0 ~ 100 을 1 배 ~ MAX_ZOOM 배로, 지수로 */
const zoomStep = ref(0);
const zoom = computed(() => Math.pow(MAX_ZOOM, zoomStep.value / 100));
const scale = computed(() => fitScale.value * zoom.value);
const box = computed(() => ({ left: `${sel.x * scale.value}px`, top: `${sel.y * scale.value}px`, width: `${sel.w * scale.value}px`, height: `${sel.h * scale.value}px` }));

/**
 * 돌린 이미지 크기 × k 인 상자 안에 원본 이미지를 돌려 놓는 스타일(img 에 absolute, max-w-none 과 함께).
 * CSS transform 은 오른쪽부터 적용돼 "회전 뒤 반전"이 scaleX(-1) rotate() 차례다
 */
function imageStyle(k: number) {
  return {
    width: `${natural.width * k}px`,
    height: `${natural.height * k}px`,
    left: `${((size.value.width - natural.width) * k) / 2}px`,
    top: `${((size.value.height - natural.height) * k) / 2}px`,
    transform: `${flip.value ? "scaleX(-1) " : ""}rotate(${rotate.value}deg)`,
  };
}

/** 비율을 지키며 가장 크게, 가운데 */
function fit() {
  const { width, height } = size.value;
  const w = Math.min(width, height * props.aspect);
  const h = w / props.aspect;
  Object.assign(sel, { x: (width - w) / 2, y: (height - h) / 2, w, h });
}

/** 회전, 반전을 처음으로 하고 틀을 맞춘다 */
function reset() {
  rotate.value = 0;
  flip.value = false;
  fit();
}

// 보이는 이미지를 시계 방향으로 90도. 뒤집혀 보이는 중이면 원본은 반대로 돌려야 같은 결과다(반전 뒤 회전 = 반대 회전 뒤 반전)
function turnRight() {
  const { height } = size.value;
  rotate.value = ((rotate.value + (flip.value ? 270 : 90)) % 360) as Rotation;
  // 틀도 같이 돌린다. 정사각형이 아닌 틀은 비율이 바뀌어 새로 맞춘다
  if (props.aspect !== 1) return fit();
  Object.assign(sel, { x: height - sel.y - sel.h, y: sel.x, w: sel.h, h: sel.w });
}
function mirror() {
  flip.value = !flip.value;
  sel.x = size.value.width - sel.x - sel.w;
}

watch(
  () => props.file,
  (file) => {
    if (url.value) URL.revokeObjectURL(url.value);
    url.value = "";
    image = null;
    natural.width = natural.height = 0;
    zoomStep.value = 0;
    rotate.value = 0;
    flip.value = false;
    if (!file) return;
    const src = (url.value = URL.createObjectURL(file));
    const img = new Image();
    img.onload = () => {
      if (url.value !== src) return;
      image = img;
      natural.width = img.naturalWidth;
      natural.height = img.naturalHeight;
      // 보는 창 안쪽 폭(틈을 뺀 것), 화면 높이의 60% 안에. 돌릴 수 있으면 긴 변이 어느 쪽으로 가도 들어가게
      const room = (viewportEl.value?.clientWidth ?? Math.min(524, innerWidth - 72)) - EDGE * 2;
      const long = Math.max(natural.width, natural.height);
      const [w, h] = props.turn ? [long, long] : [natural.width, natural.height];
      fitScale.value = Math.min(1, room / w, (innerHeight * 0.6) / h);
      fit();
    };
    img.src = src;
  },
  { immediate: true },
);

onBeforeUnmount(() => url.value && URL.revokeObjectURL(url.value));

// 확대해도 보는 창의 가운데가 이미지의 같은 곳에 남게(스크롤할 수 있는 폭, 높이에 대한 비율로)
watch(zoom, async () => {
  const el = viewportEl.value;
  if (!el) return;
  const cx = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth;
  const cy = (el.scrollTop + el.clientHeight / 2) / el.scrollHeight;
  await nextTick();
  el.scrollLeft = cx * el.scrollWidth - el.clientWidth / 2;
  el.scrollTop = cy * el.scrollHeight - el.clientHeight / 2;
});

/** 확대했을 때 틀 바깥(빈 곳 포함)을 드래그하면 보는 창을 옮긴다 */
function panStart(e: PointerEvent) {
  const el = viewportEl.value;
  if (!el || zoom.value <= 1) return;
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  const from = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
  target.onpointermove = (m) => {
    el.scrollLeft = from.left - (m.clientX - from.x);
    el.scrollTop = from.top - (m.clientY - from.y);
  };
  target.onpointerup = target.onpointercancel = () => (target.onpointermove = target.onpointerup = target.onpointercancel = null);
}

// 드래그: 옮기기는 틀 전체, 모서리는 반대쪽 모서리를 붙잡고 비율을 지키며 키우거나 줄인다
let drag: { mode: "move" | Corner; px: number; py: number; from: { x: number; y: number; w: number; h: number } } | null = null;
function start(e: PointerEvent, mode: "move" | Corner) {
  e.stopPropagation();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  drag = { mode, px: e.clientX, py: e.clientY, from: { ...sel } };
  const el = e.currentTarget as HTMLElement;
  el.onpointermove = moveTo;
  el.onpointerup = el.onpointercancel = () => {
    drag = null;
    el.onpointermove = el.onpointerup = el.onpointercancel = null;
  };
}
function moveTo(e: PointerEvent) {
  if (!drag) return;
  const dx = (e.clientX - drag.px) / scale.value;
  const dy = (e.clientY - drag.py) / scale.value;
  const f = drag.from;
  const { width, height } = size.value;
  if (drag.mode === "move") {
    sel.x = Math.min(Math.max(0, f.x + dx), width - f.w);
    sel.y = Math.min(Math.max(0, f.y + dy), height - f.h);
    return;
  }
  const west = drag.mode.includes("w");
  const north = drag.mode.includes("n");
  // 붙잡은 반대 모서리
  const ax = west ? f.x + f.w : f.x;
  const ay = north ? f.y + f.h : f.y;
  // 드래그한 만큼 넓이를 바꾸되 비율을 지키고, 이미지 안에 머물 만큼만
  const room = Math.min(west ? ax : width - ax, (north ? ay : height - ay) * props.aspect);
  const wanted = Math.max(Math.abs(f.w + (west ? -dx : dx)), Math.abs(f.h + (north ? -dy : dy)) * props.aspect);
  const w = Math.min(Math.max(wanted, MIN_SIDE * Math.max(1, props.aspect)), room);
  const h = w / props.aspect;
  Object.assign(sel, { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h });
}

/**
 * 부르는 쪽(편집 창)이 쓰는 것. sel, size: 돌리고 뒤집은 이미지의 px. image: 읽은 원본(읽기 전 null).
 * imageStyle 로 같은 돌림을 미리보기에도 쓴다
 */
defineExpose({ url, natural, size, sel, rotate, flip, ready, image: () => image, imageStyle, reset });
</script>
