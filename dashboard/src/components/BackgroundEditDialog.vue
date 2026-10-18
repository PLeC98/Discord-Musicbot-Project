<template>
  <!-- 로그인 배경 편집 창. 그림이나 영상에서 쓸 영역(비율 자유)을 선택하고, 영상이면 쓸 구간과 썸네일 장면을 선택한다.
       자른 결과가 아니라 영역(0 ~ 1) · 구간(초) · 썸네일 장면(초)을 넘긴다: 봇이 원본에서 다시 만든다.
       틀은 안을 끌면 옮기고 네 모서리로 크기를 바꾼다. 바깥은 어둡게 덮는다(그림 안에서만), 틀과 핸들은 그림 밖으로 나와도 보인다.
       아래 화면 확대로 그림을 키우면 보는 창은 그대로 두고 그 안에서 스크롤한다(틀 바깥을 끌어도 옮겨진다).
       시간 막대는 BackgroundTimeline(눈금 · 장면 띠 · 구간 · 썸네일 · 확대). 재생은 구간 반복이 켜져 있으면 구간 안에서 돌고(카드에서 선택한 반복 전환 효과를 적용한다), 끄면 구간 끝에서 멈춘다.
       보는 창의 높이는 편집 창의 나머지(제목 · 확대 · 시간 막대 · 버튼)를 뺀 남는 높이에 맞춘다(창 크기를 바꾸면 다시).
       표시하는 것은 봇이 가져올 때 만든 미리보기(GET …/:id/preview, 영상 480p · 그림), 시간 막대의 장면은 장면 띠(GET …/:id/strip).
       예상 저장 공간: 원본을 가져올 때 센 초마다의 세트 크기를 선택한 구간만큼 더한다(구간을 바꾸면 바로). 크롭을 정하거나 구간을 잰 범위 밖으로 넓히면 그것만 다시 센다(세는 중).
       최대 용량을 넘을 것 같으면(어림을 넉넉히 1.3배) 삭제할 수 있는 오래된 기록 수를 알린다(막지 않는다, 구운 뒤 실제 크기로 지킨다) -->
  <Teleport to="body">
    <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
      <div v-if="open && bg" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" tabindex="-1" @keydown.esc="open = false">
        <div ref="dialogEl" role="dialog" aria-modal="true" :aria-label="T.title" class="rounded-2xl bg-surface-container-high p-5 w-full max-w-3xl max-h-[95dvh] overflow-y-auto flex flex-col gap-3 animate-[art-in_350ms_var(--ease-spring-fast)]">
          <h3 class="text-xl font-round font-semibold">{{ T.title }}</h3>

          <!-- 보는 창: 편집 창 폭 전체 · 처음 맞춘 높이. 그 폭을 재서 그림을 맞추고(틀을 그리는 배율이 실제 그림 크기와 같아야 한다),
               그림이 창보다 작으면 가운데, 확대해서 넘치면 그 안에서 스크롤한다. 둘레의 틈에 그림 가장자리의 핸들이 들어간다 -->
          <div ref="viewportEl" class="w-full shrink-0" :class="zoom > 1 ? 'overflow-auto' : 'overflow-hidden'" :style="{ height: `${view.height + EDGE * 2}px` }">
            <div class="flex min-w-full min-h-full w-max h-max" :class="zoom > 1 && 'cursor-grab'" :style="{ padding: `${EDGE}px` }" @pointerdown="panStart">
              <div class="relative m-auto shrink-0 select-none touch-none" :style="{ width: `${view.width * zoom}px`, height: `${view.height * zoom}px` }">
                <div class="absolute inset-0 overflow-hidden rounded-lg bg-black">
                  <video v-if="bg.kind === 'video'" ref="videoEl" :src="src" muted playsinline preload="auto" class="block size-full pointer-events-none" @loadedmetadata="onMeta" @timeupdate="onTime" @ended="onEnded"></video>
                  <img v-else :src="src" alt="" class="block size-full pointer-events-none" draggable="false" @load="onMeta" />
                  <template v-if="bg.kind === 'video'">
                    <canvas ref="freezeEl" class="absolute inset-0 size-full opacity-0"></canvas>
                    <div ref="pulseEl" class="absolute inset-0 opacity-0" :style="{ backdropFilter: `blur(${sel.w * scale * 0.03}px)` }"></div>
                    <div ref="dipEl" class="absolute inset-0 opacity-0" :style="{ backgroundColor: seam.kind === 'black' ? '#000' : 'var(--md-surface)' }"></div>
                  </template>
                  <div v-if="natural.width" class="absolute shadow-[0_0_0_9999px_rgb(0_0_0/0.55)]" :style="box"></div>
                </div>
                <div v-if="natural.width" class="absolute outline-2 outline-white cursor-move" :style="box" @pointerdown="start($event, 'move')">
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

          <!-- 시간 막대(영상만) -->
          <BackgroundTimeline v-if="bg.kind === 'video' && duration" :strip="strip" :duration="duration" :fps="bg.fps || 30" :aspect="natural.width / natural.height" :now="now" :playing="playing" :range="range" :thumb-at="thumbAt" :loop="loop" @loop="loop = !loop" @seek="seek" @peek="peek" @peek-end="peekEnd" @toggle="togglePlay" @range="range = $event" @thumb="thumbAt = clampToRange(now)" />

          <p class="text-xs text-on-surface-variant nums">
            {{ T.picked(Math.round(sel.w * originalScale), Math.round(sel.h * originalScale)) }}<template v-if="bg.kind === 'video' && thumbAt === null"> · {{ T.thumbHint }}</template>
          </p>
          <p class="text-xs nums" :class="evictText ? 'text-tertiary' : 'text-on-surface-variant'">
            {{ estimateBytes === null ? T.counting : T.estimate(formatBytes(estimateBytes)) }}<template v-if="encodeMinutes !== null"> · {{ T.encodeTime(encodeMinutes) }}</template
            ><template v-if="bg.estimate?.rough"> · {{ T.rough }}</template
            ><template v-if="evictText"> · {{ evictText }}</template>
          </p>
          <div class="flex gap-2 justify-end">
            <BaseButton variant="ghost" class="mr-auto" :disabled="!natural.width" @click="reset(false)">{{ T.reset }}</BaseButton>
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
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import { text } from "../text/index.ts";
import { formatBytes } from "../../../src/ui/format.ts";
import { LOGIN_BG_ESTIMATE_MARGIN as ESTIMATE_MARGIN, type LoginBackgroundCrop, type LoginBackgroundEdit, type LoginBackgroundItem, type LoginBackgroundOptions, type LoginBackgroundState } from "../../../src/dashboard/contract/login-background.ts";
import BackgroundTimeline from "./BackgroundTimeline.vue";
import { useSeam } from "../login-background/seam.ts";
const T = text.loginBackground.edit;

/** bg: 편집할 배경(편집을 기다리는 것). state: 한도 · 쓰는 용량 · 기록(예상 저장 공간과 견준다). seam: 구간 반복에 적용할 반복 전환 효과 */
const props = defineProps<{ bg: LoginBackgroundItem | null; state: LoginBackgroundState | null; seam: LoginBackgroundOptions["seam"] }>();
const open = defineModel<boolean>({ required: true });
/** recount: 그 크롭 · 구간으로 다시 세 달라(PUT …/:id/estimate) */
const emit = defineEmits<{ done: [edit: LoginBackgroundEdit]; recount: [id: string, crop: LoginBackgroundCrop, range: [number, number] | null] }>();
const API = "/api/admin/appearance/login-background";
/** 구간을 바꾼 뒤 다시 세기를 요청하기까지(끄는 동안은 요청하지 않는다) */
const RECOUNT_AFTER_MS = 600;

type Corner = "nw" | "ne" | "sw" | "se";
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
/** 틀의 가장 작은 변(원본 px) */
const MIN_SIDE = 64;
/** 보는 창 둘레의 틈(px). 그림 가장자리의 핸들(반지름 8)과 넓게 잡히는 범위(8)가 들어가 스크롤이 생기지 않게 */
const EDGE = 16;
/** 화면 확대의 상한(배) */
const MAX_ZOOM = 5;
/** 처음 선택하는 구간의 길이(초, 영상이 더 짧으면 전체) */
const FIRST_RANGE = 30;

const src = computed(() => (props.bg ? `${API}/${props.bg.id}/preview` : ""));
const strip = computed(() => (props.bg?.strip ? { url: `${API}/${props.bg.id}/strip`, shape: props.bg.strip } : null));
const videoEl = ref<HTMLVideoElement | null>(null);
const freezeEl = ref<HTMLCanvasElement | null>(null);
const pulseEl = ref<HTMLElement | null>(null);
const dipEl = ref<HTMLElement | null>(null);
const seamFx = useSeam({ video: videoEl, freeze: freezeEl, pulse: pulseEl, dip: dipEl }, () => props.seam);
const natural = reactive({ width: 0, height: 0 });
const view = reactive({ width: 640, height: 360 });
const sel = reactive({ x: 0, y: 0, w: 0, h: 0 });
const duration = ref(0);
const range = ref<[number, number]>([0, 0]);
/** 썸네일 장면은 구간 안으로(구간 밖 장면은 굽지 않고, 유튜브는 선택한 구간만 다운로드한다) */
const clampToRange = (t: number) => Math.min(range.value[1], Math.max(range.value[0], t));
watch(range, () => {
  if (thumbAt.value !== null) thumbAt.value = clampToRange(thumbAt.value);
});
const thumbAt = ref<number | null>(null);
const now = ref(0);
const playing = ref(false);

const viewportEl = ref<HTMLElement | null>(null);
const dialogEl = ref<HTMLElement | null>(null);
/** 구간 반복 재생(끄면 구간 끝에서 멈춘다) */
const loop = ref(true);
const fps = computed(() => props.bg?.fps || 30);
/** 화면 확대: 0 ~ 100 을 1 배 ~ MAX_ZOOM 배로, 지수로 */
const zoomStep = ref(0);
const zoom = computed(() => Math.pow(MAX_ZOOM, zoomStep.value / 100));
const scale = computed(() => (natural.width ? (view.width * zoom.value) / natural.width : 1));
/** 미리보기 픽셀 → 원본 픽셀(선택한 영역을 원본 해상도로 보인다) */
const originalScale = computed(() => (natural.width && props.bg?.width ? props.bg.width / natural.width : 1));
const box = computed(() => ({ left: `${sel.x * scale.value}px`, top: `${sel.y * scale.value}px`, width: `${sel.w * scale.value}px`, height: `${sel.h * scale.value}px` }));

/** 어림을 잰 구간 안인지(처음은 전체) */
const inCounted = (counted: [number, number] | null) => !counted || (range.value[0] >= counted[0] - 0.5 && range.value[1] <= counted[1] + 0.5);
/** 예상 저장 공간(바이트, 세는 중이면 null): 영상은 선택한 구간의 초마다 크기를 더하고, 그림은 정지 그림 세트 */
const estimateBytes = computed(() => {
  const est = props.bg?.estimate;
  if (!est || est.counting || keyOf(est.crop) !== cropKey.value) return null;
  if (props.bg?.kind !== "video") return est.stillBytes;
  if (!inCounted(est.counted)) return null;
  const [from, to] = range.value;
  let sum = 0;
  for (let s = Math.floor(from); s < Math.ceil(to); s++) sum += (est.perSecond[s] ?? 0) * (Math.min(to, s + 1) - Math.max(from, s));
  return Math.round(sum);
});
/** 예상 인코딩 시간(분, 영상만): 이 기기에서 잰 굽는 속도 × 구간 길이 */
const encodeMinutes = computed(() => {
  const est = props.bg?.estimate;
  if (props.bg?.kind !== "video" || !est) return null;
  return ((range.value[1] - range.value[0]) * est.encodeRatio) / 60;
});
/** 최대 용량을 넘을 것 같으면: 삭제할 수 있는 오래된 기록 수(지금 쓰는 것 · 이 배경은 빼고, 마지막으로 쓴 지 오래된 것부터) */
const evictText = computed(() => {
  const st = props.state;
  const est = estimateBytes.value;
  if (!st || est === null || !st.limits.maxBytes) return "";
  const need = est * ESTIMATE_MARGIN;
  if (need > st.limits.maxBytes) return T.overAlone;
  let over = st.usedBytes + need - st.limits.maxBytes;
  if (over <= 0) return "";
  // 삭제할 수 있는 것: 다 구운 기록 전부(지금 배경은 새 배경이 걸리면 이전 배경이 되어 맨 마지막)
  const victims = st.list.filter((bg) => bg.phase === "ready" && bg.id !== props.bg?.id).sort((a, b) => Number(a.id === st.current) - Number(b.id === st.current) || a.usedAt - b.usedAt);
  let n = 0;
  for (const bg of victims) {
    if (over <= 0) break;
    over -= bg.bytes;
    n++;
  }
  return n ? T.evict(n) : T.overAlone;
});
/** 지금 틀(0 ~ 1)과 그 키(어림을 센 크롭과 같은지 본다) */
const cropNow = (): LoginBackgroundCrop => (natural.width ? { x: sel.x / natural.width, y: sel.y / natural.height, w: sel.w / natural.width, h: sel.h / natural.height } : { x: 0, y: 0, w: 1, h: 1 });
const keyOf = (crop: LoginBackgroundCrop) => [crop.x, crop.y, crop.w, crop.h].map((v) => v.toFixed(3)).join(",");
const cropKey = ref(keyOf({ x: 0, y: 0, w: 1, h: 1 }));
const rangeNow = (): [number, number] | null => (props.bg?.kind === "video" ? range.value : null);
/** 크롭을 정했다: 어림을 잰 크롭과 다르면 그 크롭 · 구간으로 다시 센다 */
function cropSettled() {
  const crop = cropNow();
  cropKey.value = keyOf(crop);
  const est = props.bg?.estimate;
  if (props.bg && est && keyOf(est.crop) !== cropKey.value) emit("recount", props.bg.id, crop, rangeNow());
}
// 구간을 잰 범위 밖으로 넓혔으면(끄기를 멈춘 뒤) 그 구간을 다시 센다
let recountTimer = 0;
watch(range, () => {
  clearTimeout(recountTimer);
  recountTimer = window.setTimeout(() => {
    const est = props.bg?.estimate;
    if (open.value && props.bg && est && !est.counting && !inCounted(est.counted)) emit("recount", props.bg.id, cropNow(), rangeNow());
  }, RECOUNT_AFTER_MS);
});

/** 틀 · 구간 · 썸네일을 처음으로(편집한 적이 있으면 그것으로) */
function reset(fromEdit = false) {
  const saved = fromEdit ? props.bg?.edit : null;
  const c = saved?.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  Object.assign(sel, { x: c.x * natural.width, y: c.y * natural.height, w: c.w * natural.width, h: c.h * natural.height });
  if (props.bg?.kind === "video") {
    range.value = saved?.range ?? [0, Math.min(duration.value, FIRST_RANGE)];
    thumbAt.value = saved?.thumbAt ?? null;
    seek(range.value[0]);
  }
  cropSettled();
}

function onMeta(event: Event) {
  const el = event.target as HTMLVideoElement | HTMLImageElement;
  natural.width = "videoWidth" in el ? el.videoWidth : el.naturalWidth;
  natural.height = "videoHeight" in el ? el.videoHeight : el.naturalHeight;
  if ("duration" in el) duration.value = Number.isFinite(el.duration) ? el.duration : 0;
  zoomStep.value = 0;
  fit(innerHeight * 0.5);
  reset(true);
  // 시간 막대가 그려진 뒤 남는 높이를 재서 다시 맞춘다
  void nextTick(() => fit());
  // 영상은 열자마자 구간을 돌며 재생한다(소리는 없다)
  if ("play" in el)
    void el
      .play()
      .then(() => {
        playing.value = true;
        follow();
      })
      .catch(() => (playing.value = false));
}

/**
 * 보는 창의 크기: 영역 폭 안 · 남는 높이 안에서 그림 비율대로. 남는 높이는 화면 높이(편집 창의 상한 95%)에서 편집 창의 나머지를 뺀 것.
 * first 를 주면 그 높이를 상한으로(처음 그릴 때, 나머지를 재기 전)
 */
function fit(first?: number) {
  if (!natural.width) return;
  const room = (viewportEl.value?.clientWidth ?? Math.min(728, innerWidth - 72)) - EDGE * 2;
  const rest = dialogEl.value && viewportEl.value ? dialogEl.value.scrollHeight - viewportEl.value.offsetHeight : 0;
  const tall = first ?? Math.max(120, innerHeight * 0.95 - rest - EDGE * 2);
  const k = Math.min(1, room / natural.width, tall / natural.height);
  view.width = Math.floor(natural.width * k);
  view.height = Math.floor(natural.height * k);
}
const onResize = () => fit();
watch(open, (on) => {
  if (on) addEventListener("resize", onResize);
  else removeEventListener("resize", onResize);
});

watch(open, (on) => {
  if (on) return;
  videoEl.value?.pause();
  seamFx.release(0);
  playing.value = false;
  natural.width = natural.height = 0;
});

// ── 영상: 재생 · 구간 ──

/** 그 위치로(영상 안으로 자른다). 구간 밖으로도 갈 수 있다(재생은 구간 안에서 돈다) */
function seek(t: number) {
  seamFx.release(0);
  const at = Math.min(Math.max(0, t), duration.value);
  now.value = at;
  if (videoEl.value) videoEl.value.currentTime = at;
}
/** 재생 중에는 장면마다 시각을 받는다(timeupdate 는 1초에 몇 번뿐이라 시각 · 마커가 튄다). 구간 끝에 닿으면 처음으로 */
function follow() {
  const el = videoEl.value;
  if (!el || el.paused) return;
  // 끝 장면은 구간 끝보다 반 장면쯤 앞에 있다(구간 끝이 영상 끝이면 영상 끝에 닿지 않고 멈춘다): 반 장면 앞에서 처음으로
  const tick = (t: number) => {
    now.value = t;
    if (loop.value) seamFx.near(t, range.value[1], fps.value);
    if (t >= range.value[1] - 0.5 / fps.value && t < range.value[1] + 0.5) atEnd(el);
  };
  if (typeof el.requestVideoFrameCallback === "function") el.requestVideoFrameCallback((_, meta) => (tick(meta.mediaTime), follow()));
  else requestAnimationFrame(() => (tick(el.currentTime), follow()));
}
// 반복을 끄거나 구간 · 효과가 바뀌면 건 효과를 바로 치운다
watch([loop, range, () => props.seam.kind, () => props.seam.seconds], () => seamFx.release(0));
/** 구간 끝: 반복이면 처음으로, 아니면 멈춘다 */
function atEnd(el: HTMLVideoElement) {
  if (loop.value) {
    el.currentTime = range.value[0];
    seamFx.restarted();
    return;
  }
  el.pause();
  playing.value = false;
  now.value = range.value[1];
}
/** 영상 끝에 닿아 멈췄을 때(구간 끝이 영상 끝): 반복이면 처음부터 이어 재생 */
async function onEnded() {
  const el = videoEl.value;
  if (!el || !loop.value) {
    playing.value = false;
    return;
  }
  el.currentTime = range.value[0];
  seamFx.restarted();
  await el.play();
  playing.value = true;
  follow();
}
function onTime() {
  // 멈춰 있을 때 찾아간 위치(재생 중은 follow 가 맡는다). 구간 핸들 장면을 보이는 동안은 재생 위치가 아니다
  if (videoEl.value?.paused && !peeking) now.value = videoEl.value.currentTime;
}

/** 구간 핸들을 끄는 동안: 재생 위치(now)는 그대로 두고 화면만 그 장면(재생 중이면 잠시 멈춘다). 놓으면 재생 위치로 돌아가 이어서 */
let peeking: { wasPlaying: boolean } | null = null;
function peek(t: number) {
  const el = videoEl.value;
  if (!el) return;
  if (!peeking) {
    peeking = { wasPlaying: !el.paused };
    el.pause();
    seamFx.release(0);
  }
  el.currentTime = Math.min(Math.max(0, t), duration.value);
}
async function peekEnd() {
  const el = videoEl.value;
  if (!el || !peeking) return;
  const resume = peeking.wasPlaying;
  peeking = null;
  el.currentTime = now.value;
  if (resume) {
    await el.play();
    follow();
  }
}
async function togglePlay() {
  const el = videoEl.value;
  if (!el) return;
  if (el.paused) {
    if (el.currentTime < range.value[0] || el.currentTime >= range.value[1]) el.currentTime = range.value[0];
    await el.play();
    playing.value = true;
    follow();
  } else {
    el.pause();
    seamFx.release(0);
    playing.value = false;
    now.value = el.currentTime;
  }
}

// ── 틀: 안을 끌면 옮기고, 모서리는 반대 모서리를 붙잡고 비율 자유로 ──

let drag: { mode: "move" | Corner; px: number; py: number; from: { x: number; y: number; w: number; h: number } } | null = null;
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

function start(e: PointerEvent, mode: "move" | Corner) {
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  drag = { mode, px: e.clientX, py: e.clientY, from: { ...sel } };
  el.onpointermove = moveTo;
  el.onpointerup = el.onpointercancel = () => {
    drag = null;
    el.onpointermove = el.onpointerup = el.onpointercancel = null;
    cropSettled();
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
  const ax = west ? f.x + f.w : f.x;
  const ay = north ? f.y + f.h : f.y;
  const w = Math.min(Math.max(MIN_SIDE, f.w + (west ? -dx : dx)), west ? ax : natural.width - ax);
  const h = Math.min(Math.max(MIN_SIDE, f.h + (north ? -dy : dy)), north ? ay : natural.height - ay);
  Object.assign(sel, { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h });
}

function finish() {
  videoEl.value?.pause();
  emit("done", {
    crop: { x: sel.x / natural.width, y: sel.y / natural.height, w: sel.w / natural.width, h: sel.h / natural.height },
    range: props.bg?.kind === "video" ? range.value : null,
    thumbAt: props.bg?.kind === "video" ? (thumbAt.value ?? range.value[0]) : null,
  });
  open.value = false;
}

// 열 때 영상이 이미 읽혀 있으면(같은 주소) 메타데이터 이벤트가 다시 오지 않으므로 직접 맞춘다
watch(open, async (on) => {
  if (!on) return;
  cropKey.value = keyOf(props.bg?.estimate?.crop ?? { x: 0, y: 0, w: 1, h: 1 });
  await nextTick();
  const el = videoEl.value;
  if (el && el.readyState >= 1) onMeta({ target: el } as unknown as Event);
});
</script>
