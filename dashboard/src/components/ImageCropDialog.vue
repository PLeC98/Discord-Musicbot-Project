<template>
  <!-- 그림에서 쓸 영역을 선택하는 대화상자(이미지 편집하기). 파비콘이 쓰고, 로그인 배경의 크롭도 쓴다.
       aspect(가로 ÷ 세로)를 지키는 틀을 끌어 옮기고 네 모서리로 크기를 바꾼다. 처음 틀은 그 비율로 가장 크게, 가운데. 바깥은 어둡게 덮는다.
       아래 화면 확대로 그림을 키우면 보는 창은 그대로 두고 그 안에서 스크롤한다(틀 바깥을 끌어도 옮겨진다).
       재설정은 처음 틀로 되돌린다. "적용하기"를 누르면 선택한 영역을 원본 해상도로(긴 변 maxSide 까지) 잘라 png 로 넘긴다. 바깥을 누르거나 Esc 면 닫는다 -->
  <Teleport to="body">
    <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
      <div v-if="open" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" tabindex="-1" @click.self="open = false">
        <div role="dialog" aria-modal="true" :aria-label="T.title" class="rounded-2xl bg-surface-container-high p-5 w-full max-w-xl flex flex-col gap-3 animate-[art-in_350ms_var(--ease-spring-fast)]">
          <h3 class="text-xl font-round font-semibold">{{ T.title }}</h3>

          <!-- 보는 창: 편집 창 폭 전체 · 처음 맞춘 높이. 그림이 창보다 작으면 가운데, 확대해서 넘치면 그 안에서 스크롤한다.
               둘레에 틈을 두어 그림 가장자리에 붙은 핸들도 잘리지 않게 한다 -->
          <div ref="viewportEl" class="w-full" :class="zoom > 1 ? 'overflow-auto' : 'overflow-hidden'" :style="{ height: `${view.height + EDGE * 2}px` }">
            <div class="flex min-w-full min-h-full w-max h-max" :class="zoom > 1 && 'cursor-grab'" :style="{ padding: `${EDGE}px` }" @pointerdown="panStart">
              <div class="relative m-auto shrink-0 select-none touch-none" :style="{ width: `${view.width * zoom}px`, height: `${view.height * zoom}px` }">
                <!-- 그림과 어둡게 덮기는 그림 안에서만(큰 그림자를 그림 밖으로 내지 않게 자른다) -->
                <div class="absolute inset-0 overflow-hidden rounded-lg">
                  <img v-if="url" :src="url" alt="" class="block size-full pointer-events-none" draggable="false" />
                  <div class="absolute shadow-[0_0_0_9999px_rgb(0_0_0/0.55)]" :style="box"></div>
                </div>
                <!-- 선택한 영역의 틀과 핸들은 자르지 않는 레이어에(그림 밖으로 나와도 보이고 잡힌다). 안을 끌면 옮긴다. 핸들은 보이는 것보다 넓게 잡힌다 -->
                <div class="absolute outline-2 outline-white cursor-move" :style="box" @pointerdown="start($event, 'move')">
                  <span v-for="corner in CORNERS" :key="corner" class="absolute size-4 -m-2 rounded-full bg-white shadow before:absolute before:-inset-2" :class="[corner.includes('n') ? 'top-0' : 'bottom-0', corner.includes('w') ? 'left-0' : 'right-0', corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize']" @pointerdown.stop="start($event, corner)"></span>
                </div>
              </div>
            </div>
          </div>
          <!-- 화면 확대: 작은 그림 · 슬라이더 · 큰 그림(디스코드의 이미지 편집과 같은 형태), 가운데 -->
          <div class="flex items-center justify-center gap-3 text-on-surface-variant">
            <Icon name="image" :size="16" aria-hidden="true" />
            <input v-model.number="zoomStep" type="range" min="0" max="100" step="1" class="m3-slider m3-slider-thin w-48" :style="{ '--v': zoomStep / 100 }" :aria-label="T.zoom" :disabled="!natural.width" />
            <Icon name="image" :size="24" aria-hidden="true" />
          </div>

          <p class="text-xs text-on-surface-variant nums">
            {{ T.picked(Math.round(sel.w), Math.round(sel.h)) }}<template v-if="target && sel.w < target"> · {{ T.tooSmall(target) }}</template>
          </p>
          <div class="flex gap-2 justify-end">
            <!-- 처음 열렸을 때의 틀(그 비율로 가장 크게, 가운데)로 되돌린다 -->
            <BaseButton variant="ghost" class="mr-auto" :disabled="!natural.width" @click="fit">{{ T.reset }}</BaseButton>
            <BaseButton variant="ghost" @click="open = false">{{ text.common.cancel }}</BaseButton>
            <BaseButton :disabled="!natural.width" @click="finish">{{ T.use }}</BaseButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useCloseLayer } from "../composables/close-layer.ts";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import { text } from "../text/index.ts";
const T = text.appearance.crop;

/** file: 자를 그림. aspect: 가로 ÷ 세로(1 이면 정사각형). target: 쓸 크기(한 변 px, 그보다 작게 선택하면 알린다). maxSide: 넘기는 긴 변의 상한(쓰는 곳이 필요한 만큼, 안 주면 아주 큰 원본을 그대로 넘기지 않을 만큼) */
const props = withDefaults(defineProps<{ file: File | null; aspect: number; target?: number; maxSide?: number }>(), { target: undefined, maxSide: 2048 });
const open = defineModel<boolean>({ required: true });
useCloseLayer(open, () => (open.value = false));
const emit = defineEmits<{ done: [blob: Blob] }>();

type Corner = "nw" | "ne" | "sw" | "se";
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
/** 틀의 가장 작은 짧은 변(원본 px) */
const MIN_SIDE = 16;
/** 보는 창 둘레의 틈(px). 그림 가장자리의 핸들(반지름 8)과 넓게 잡히는 범위(8)가 들어가 스크롤이 생기지 않게 */
const EDGE = 16;
/** 화면 확대의 상한(배) */
const MAX_ZOOM = 5;

const url = ref("");
const natural = reactive({ width: 0, height: 0 });
/** 화면에 보이는 그림 크기. 대화상자 폭 · 화면 높이의 60% 안에 맞춘다 */
const view = reactive({ width: 0, height: 0 });
/** 선택한 영역(원본 px) */
const sel = reactive({ x: 0, y: 0, w: 0, h: 0 });
let image: HTMLImageElement | null = null;

const viewportEl = ref<HTMLElement | null>(null);
/** 화면 확대: 0 ~ 100 을 1 배 ~ MAX_ZOOM 배로, 지수로 */
const zoomStep = ref(0);
const zoom = computed(() => Math.pow(MAX_ZOOM, zoomStep.value / 100));
const scale = computed(() => (natural.width ? (view.width * zoom.value) / natural.width : 1));
const box = computed(() => ({ left: `${sel.x * scale.value}px`, top: `${sel.y * scale.value}px`, width: `${sel.w * scale.value}px`, height: `${sel.h * scale.value}px` }));

/** 비율을 지키며 가장 크게, 가운데 */
function fit() {
  const w = Math.min(natural.width, natural.height * props.aspect);
  const h = w / props.aspect;
  Object.assign(sel, { x: (natural.width - w) / 2, y: (natural.height - h) / 2, w, h });
}

watch(
  () => [open.value, props.file] as const,
  ([isOpen, file]) => {
    if (url.value) URL.revokeObjectURL(url.value);
    url.value = "";
    natural.width = natural.height = 0;
    zoomStep.value = 0;
    if (!isOpen || !file) return;
    url.value = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      image = img;
      natural.width = img.naturalWidth;
      natural.height = img.naturalHeight;
      // 보는 창 안쪽 폭(틈을 뺀 것) · 화면 높이의 60% 안에
      const room = (viewportEl.value?.clientWidth ?? Math.min(524, innerWidth - 72)) - EDGE * 2;
      const k = Math.min(1, room / natural.width, (innerHeight * 0.6) / natural.height);
      view.width = Math.round(natural.width * k);
      view.height = Math.round(natural.height * k);
      fit();
    };
    img.src = url.value;
  },
  { immediate: true },
);

// 확대해도 보는 창의 가운데가 그림의 같은 곳에 남게(스크롤할 수 있는 폭 · 높이에 대한 비율로)
watch(zoom, async () => {
  const el = viewportEl.value;
  if (!el) return;
  const cx = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth;
  const cy = (el.scrollTop + el.clientHeight / 2) / el.scrollHeight;
  await nextTick();
  el.scrollLeft = cx * el.scrollWidth - el.clientWidth / 2;
  el.scrollTop = cy * el.scrollHeight - el.clientHeight / 2;
});

/** 확대했을 때 틀 바깥(빈 곳 포함)을 끌면 보는 창을 옮긴다 */
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

// 끌기: 옮기기는 틀 전체, 모서리는 반대쪽 모서리를 붙잡고 비율을 지키며 키우거나 줄인다
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
  if (drag.mode === "move") {
    sel.x = Math.min(Math.max(0, f.x + dx), natural.width - f.w);
    sel.y = Math.min(Math.max(0, f.y + dy), natural.height - f.h);
    return;
  }
  const west = drag.mode.includes("w");
  const north = drag.mode.includes("n");
  // 붙잡은 반대 모서리
  const ax = west ? f.x + f.w : f.x;
  const ay = north ? f.y + f.h : f.y;
  // 끈 만큼 넓이를 바꾸되 비율을 지키고, 그림 안에 머물 만큼만
  const room = Math.min(west ? ax : natural.width - ax, (north ? ay : natural.height - ay) * props.aspect);
  const wanted = Math.max(Math.abs(f.w + (west ? -dx : dx)), Math.abs(f.h + (north ? -dy : dy)) * props.aspect);
  const w = Math.min(Math.max(wanted, MIN_SIDE * Math.max(1, props.aspect)), room);
  const h = w / props.aspect;
  Object.assign(sel, { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h });
}

/** 선택한 영역을 원본 해상도로(긴 변 maxSide 까지) 잘라 png 로 넘긴다 */
function finish() {
  if (!image) return;
  const k = Math.min(1, props.maxSide / Math.max(sel.w, sel.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sel.w * k));
  canvas.height = Math.max(1, Math.round(sel.h * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, sel.x, sel.y, sel.w, sel.h, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((blob) => {
    if (!blob) return;
    emit("done", blob);
    open.value = false;
  }, "image/png");
}
</script>
