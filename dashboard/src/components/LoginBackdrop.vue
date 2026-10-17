<template>
  <!-- 로그인 배경 하나를 틀(부모 크기)에 그린다. 로그인 화면과 운영자 패널의 화면 판(로그인 화면으로 보기)이 같이 쓴다.
       파일은 봇이 크롭 · 구간을 적용해 구운 것이라 꽉 채우고(object-fit cover) 보일 자리만 고른다. 정지 그림은 폭별 그림에서 틀 폭 × 배율에 맞는 것.
       영상은 HLS(코덱마다 목록 하나). 고르는 규칙 · 내리기는 login-background/pick, 능동 조절은 adapt(adaptive 일 때만, 로그인 화면).
       흐림은 덮개(backdrop-filter, 틀 폭의 %), 덮개는 화면 색을 진하기만큼. 장면 색은 장면이 바뀔 때만 1초 동안 넘어간다:
       paintTheme 이면 화면 색 시스템(theme.ts setPageSeed)을 칠하고(효과 full), 아니면 · 효과 cover 면 덮개 색만 넘긴다.
       반복은 브라우저에 맡기고(loop) 끝에 닿기 전 · 처음으로 돌아간 때에 전환 효과(멈춘 장면 겹치기 · 덮개 색 · 검게 · 흐림)를 걸고 거둔다.
       영상이 보이고 재생 중이면 맨 위 1px 점의 불투명도를 늘 바꿔 주사율을 붙잡는다(안드로이드 크롬이 30 · 60 을 오가며 장면을 버리지 않게, research §11.8 A9) -->
  <!-- 틀 · 흐리는 층은 부모의 둥근 모서리를 이어받는다(backdrop-filter 는 부모의 둥근 자르기를 따르지 않고 네모로 흐려 모서리 밖까지 번진다) -->
  <!-- 꾸밈 층이다: 안의 효과 층(z-index)이 바깥(로그인 단추 묶음) 위로 올라가지 않게 쌓임을 가두고(isolate), 누르기는 통과시킨다 -->
  <div ref="frameEl" class="absolute inset-0 isolate overflow-hidden rounded-[inherit] bg-black pointer-events-none" aria-hidden="true">
    <img v-if="still" :src="still.src" :srcset="still.srcset" :sizes="`${Math.max(1, Math.round(frame.width))}px`" alt="" class="absolute inset-0 size-full object-cover" :style="place" draggable="false" />
    <video v-if="codec" :key="codec" ref="videoEl" muted playsinline autoplay loop preload="auto" class="absolute inset-0 size-full object-cover transition-opacity duration-500" :class="started ? 'opacity-100' : 'opacity-0'" :style="place" @playing="onPlaying" @waiting="adapter?.waited()" @stalled="adapter?.waited()" @pause="adapter?.paused(true)" @play="adapter?.paused(false)"></video>
    <canvas ref="freezeEl" class="absolute inset-0 size-full object-cover opacity-0" :style="place"></canvas>
    <div ref="pulseEl" class="absolute inset-0 rounded-[inherit] opacity-0" :style="{ backdropFilter: `blur(${frame.width * 0.03}px)` }"></div>
    <div class="absolute inset-0 rounded-[inherit]" :style="{ backgroundColor: `color-mix(in srgb, var(--md-surface) ${look.cover}%, transparent)`, backdropFilter: blurPx ? `blur(${blurPx}px)` : undefined }"></div>
    <!-- 덮개 색만 넘길 때: 두 장을 겹쳐 위 장의 불투명도만 바꾼다(브라우저가 페이지를 다시 계산하지 않고 합성만 한다) -->
    <div v-for="(sheet, i) in sheets" :key="i" class="absolute inset-0 rounded-[inherit] will-change-[opacity]" :style="{ backgroundColor: sheet.color ? `color-mix(in srgb, ${sheet.color} ${look.cover}%, transparent)` : 'transparent', opacity: sheet.on ? 1 : 0, zIndex: sheet.top ? 1 : 0, transition: sheet.ms ? `opacity ${sheet.ms}ms linear` : 'none' }"></div>
    <div ref="dipEl" class="absolute inset-0 z-2 rounded-[inherit] opacity-0" :style="{ backgroundColor: look.seam.kind === 'black' ? '#000' : 'var(--md-surface)' }"></div>
    <span v-if="holding" class="hold-tick absolute left-0 top-0 z-3 size-px"></span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { argbFromHex } from "@material/material-color-utilities";
import type { LoginBackground, LoginBackgroundLook } from "../../../src/dashboard/contract/login-background.ts";
import { blurCapped, judge, ladderOf, neededShort, rungsOf, type Step, type Verdict, type Rung } from "../login-background/pick.ts";
import { startAdapter, type Adapter } from "../login-background/adapt.ts";
import { hasMse, nativeHls, playHls, type HlsPlayer } from "../login-background/hls.ts";
import { paletteOf } from "../theme/palette.ts";
import { dark, releasePageSeed, setPageSeed } from "../theme/theme.ts";
import { readStored, writeStored } from "../utils/storage.ts";

type Shown = Exclude<LoginBackground, { kind: "none" }>;
/** bg: 그릴 배경, look: 화면 값과 보일 자리, adaptive: 능동 조절(로그인 화면), paintTheme: 화면 색 시스템을 칠한다(로그인 화면) */
const props = withDefaults(defineProps<{ bg: Shown; look: LoginBackgroundLook; adaptive?: boolean; paintTheme?: boolean }>(), { adaptive: false, paintTheme: false });
/** stale: 파일을 못 받았다(배경이 바뀌었을 수 있다. 부모가 배경 정보를 다시 읽는다) */
const emit = defineEmits<{ stale: [] }>();

/** 장면 색이 넘어가는 시간 · 처음 색 */
const SCENE_MS = 1000;
const FIRST_MS = 700;
/** 멈춘 장면 겹치기를 뜨는 때(끝에서 몇 장면 앞) */
const FREEZE_FRAMES = 1.5;
/** 기억한 칸(다음 방문의 시작점). 배경 · 내려갈 차례가 같을 때만 쓴다 */
const STEP_KEY = "login-bg:step";

const frameEl = ref<HTMLElement | null>(null);
const videoEl = ref<HTMLVideoElement | null>(null);
const freezeEl = ref<HTMLCanvasElement | null>(null);
const pulseEl = ref<HTMLElement | null>(null);
const dipEl = ref<HTMLElement | null>(null);
const frame = reactive({ width: 0, height: 0 });
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const place = computed(() => ({ objectPosition: `${props.look.position.x}% ${props.look.position.y}%` }));
/** 흐림(px): 화면 폭의 % 라 틀 폭에 곱한다(작은 틀에서는 그만큼 작게) */
const blurPx = computed(() => (frame.width * props.look.blur) / 100);
/** 정지 그림: 폭별 그림(작은 것부터). 틀 폭 × 배율에 맞는 것은 브라우저가 고른다 */
const still = computed(() => {
  const stills = [...props.bg.stills].sort((a, b) => a.width - b.width);
  if (!stills.length) return null;
  return { src: stills[stills.length - 1].url, srcset: stills.map((one) => `${one.url} ${one.width}w`).join(", ") };
});

// ── 내려갈 차례 · 지금 칸 ──

const ladder = shallowRef<Step[]>([]);
const index = ref(0);
const step = computed<Step | null>(() => ladder.value[index.value] ?? null);
const codec = computed(() => step.value?.codec ?? null);
const signature = () => `${props.bg.id}|${ladder.value.map((one) => `${one.codec}:${one.cap}:${one.effect}`).join(",")}`;
function recall(): number | null {
  try {
    const got = JSON.parse(readStored(STEP_KEY) ?? "null") as { sig: string; index: number } | null;
    return got && got.sig === signature() ? got.index : null;
  } catch {
    return null;
  }
}
const remember = (at: number) => writeStored(STEP_KEY, JSON.stringify({ sig: signature(), index: at }));

let rungs: Rung[] = [];
async function plan() {
  const video = props.bg.kind === "video" ? props.bg : null;
  rungs = video ? rungsOf(video.streams) : [];
  const canPlay = hasMse() || nativeHls(document.createElement("video"));
  const reduced = reducedMotion.matches || !rungs.length || !canPlay;
  const verdicts = new Map<Rung, Verdict>(await Promise.all(rungs.map(async (rung) => [rung, await judge(rung)] as const)));
  const aspect = rungs[0] ? rungs[0].width / rungs[0].height : 16 / 9;
  const view = { width: frame.width || innerWidth, height: frame.height || innerHeight, dpr: devicePixelRatio };
  ladder.value = ladderOf(rungs, verdicts, neededShort(view, aspect, props.look.blur), { reduced, capFhd: blurCapped(view, props.look.blur) });
  index.value = props.adaptive ? Math.min(recall() ?? 0, ladder.value.length - 1) : 0;
}

/** 다른 코덱의 첫 칸(그 코덱을 못 틀 때). 없으면 정지 그림 */
function nextCodec() {
  const now = codec.value;
  const at = ladder.value.findIndex((one, i) => i > index.value && one.codec !== now);
  index.value = at < 0 ? ladder.value.length - 1 : at;
}

// ── HLS ──

let player: HlsPlayer | null = null;
let attaching = 0;
const started = ref(false);
async function attach() {
  player?.destroy();
  player = null;
  started.value = false;
  const video = videoEl.value;
  const now = step.value;
  if (!video || !now?.codec || props.bg.kind !== "video") return;
  const stream = props.bg.streams.find((one) => one.codec === now.codec);
  if (!stream) return nextCodec();
  const mine = ++attaching;
  const got = await playHls(video, stream.url, now.cap, {
    onStall: () => adapter?.waited(),
    onFatal: ({ load }) => {
      if (mine !== attaching) return;
      // 받기 오류면 배경이 바뀌었을 수 있다(부모가 다시 읽는다). 그동안 · 같은 배경이면 다음 코덱, 다 실패하면 정지 그림
      if (load) emit("stale");
      nextCodec();
    },
  });
  if (mine === attaching) player = got;
  else got.destroy();
}
// 코덱이 바뀌면(영상 칸이 새로 생기면) 목록을 붙이고, 같은 코덱이면 상한만 바꾼다
watch(videoEl, () => void attach(), { flush: "post" });
watch(
  () => step.value?.cap,
  (cap) => player?.cap(cap ?? null),
);

// ── 장면 색 · 효과 ──

const OWNER = Symbol("login-backdrop");
const sheets = reactive([0, 1].map(() => ({ color: "", on: false, top: false, ms: 0 })));
let topSheet = 0;
/** 덮개 색만 넘긴다(위 장을 바꿔 그 장의 불투명도를 올린다) */
function coverTo(hex: string | null, ms: number) {
  const surface = hex ? paletteOf(argbFromHex(hex), dark.value)["--md-surface"] : "";
  topSheet = 1 - topSheet;
  const next = sheets[topSheet];
  const prev = sheets[1 - topSheet];
  Object.assign(next, { color: surface, on: false, top: true, ms: 0 });
  prev.top = false;
  requestAnimationFrame(() => Object.assign(next, { on: Boolean(surface), ms }));
}
const clearCover = () => sheets.forEach((one) => Object.assign(one, { color: "", on: false, ms: 0 }));

const scenes = computed(() => (props.bg.kind === "video" ? props.bg.scenes : []));
const sceneAt = (t: number) => scenes.value.reduce((found, scene, i) => (t >= scene.at ? i : found), -1);
const colorAt = (i: number) => (i >= 0 ? (scenes.value[i]?.color ?? props.bg.color) : props.bg.color);
/** 이 칸의 효과로 칠하는 법: 화면 전체(테마) · 덮개만 · 고정. 영상 따라 색 바꾸기를 끄면 고정 */
const effect = computed(() => (props.look.follow && codec.value ? (step.value?.effect ?? "fixed") : "fixed"));
let lastScene = -2;
function paintScene(i: number, ms: number) {
  const hex = colorAt(i);
  const mode = effect.value;
  if (props.paintTheme) setPageSeed(OWNER, mode === "full" ? hex : props.bg.color, ms);
  if (mode === "cover" || (mode === "full" && !props.paintTheme)) coverTo(hex, ms);
  else clearCover();
}
watch(effect, () => {
  lastScene = sceneAt(videoEl.value?.currentTime ?? 0);
  paintScene(lastScene, FIRST_MS);
});

// ── 재생 위치를 장면마다 본다: 장면 바뀜 · 반복 전환 효과 ──

/** 불투명도를 ms 동안 to 로(0 이면 바로) */
function fade(el: HTMLElement | null, to: number, ms: number) {
  if (!el) return;
  el.style.transition = ms ? `opacity ${ms}ms linear` : "none";
  if (!ms) void el.offsetWidth;
  el.style.opacity = String(to);
}
let armed = false;
function release(ms: number) {
  fade(freezeEl.value, 0, ms);
  fade(pulseEl.value, 0, ms / 2);
  fade(dipEl.value, 0, ms / 2);
  armed = false;
}
let watching = 0;
let lastTime = 0;
function follow() {
  const video = videoEl.value;
  if (!video) return;
  const mine = ++watching;
  const fps = props.bg.kind === "video" ? (props.bg.streams[0]?.rungs[0]?.frameRate ?? 30) : 30;
  /** 끝에 닿기 전에 전환 효과를 건다 */
  const arm = (t: number, end: number) => {
    const { kind, seconds } = props.look.seam;
    if (kind === "freeze" && t >= end - FREEZE_FRAMES / fps) {
      const canvas = freezeEl.value;
      if (!canvas || !video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      fade(canvas, 1, 0);
      armed = true;
      return;
    }
    const layer = kind === "blur" ? pulseEl.value : kind === "cover" || kind === "black" ? dipEl.value : null;
    if (layer && t >= end - seconds / 2) {
      fade(layer, 1, (seconds * 1000) / 2);
      armed = true;
    }
  };
  const at = (t: number) => {
    // 처음으로 돌아갔다: 건 효과를 거둔다
    if (t + 0.5 < lastTime && armed) release(props.look.seam.seconds * 1000);
    lastTime = t;
    const i = sceneAt(t);
    if (i !== lastScene) {
      if (lastScene !== -2) paintScene(i, SCENE_MS);
      lastScene = i;
    }
    if (Number.isFinite(video.duration) && !armed) arm(t, video.duration);
  };
  const next = () => {
    if (mine !== watching || video.paused) return;
    if (typeof video.requestVideoFrameCallback === "function")
      video.requestVideoFrameCallback((_, meta) => {
        at(meta.mediaTime);
        next();
      });
    else
      requestAnimationFrame(() => {
        at(video.currentTime);
        next();
      });
  };
  next();
}
function onPlaying() {
  started.value = true;
  follow();
}
// 효과 종류 · 길이를 바꾸거나 다른 배경이 오면 남은 효과를 바로 치운다
watch(
  () => [props.look.seam.kind, props.look.seam.seconds, props.bg.id],
  () => release(0),
);

// ── 주사율 붙잡기 · 화면 숨김 ──

const visible = ref(!document.hidden);
const holding = computed(() => started.value && Boolean(codec.value) && visible.value && inView.value && !reducedMotion.matches);
function onVisibility() {
  visible.value = !document.hidden;
  adapter?.hidden(document.hidden);
  if (!document.hidden && inView.value && videoEl.value?.paused)
    void videoEl.value.play().catch(() => {
      // 자동 재생이 막혔다(정지 그림이 그대로 보인다)
    });
}

// ── 능동 조절 · 멈춤 감시 ──

let adapter: Adapter | null = null;
function startAdapting() {
  adapter?.stop();
  adapter = null;
  if (!props.adaptive || ladder.value.length < 2) return;
  const h264At = ladder.value.findIndex((one) => one.codec === "h264");
  adapter = startAdapter({
    video: () => (codec.value ? videoEl.value : null),
    index: () => index.value,
    count: ladder.value.length,
    h264At,
    go: (at) => (index.value = at),
    network: () => ({ peak: rungs.find((rung) => rung.codec === codec.value && Math.min(rung.width, rung.height) === player?.info.short)?.bandwidth ?? 0, bandwidth: player?.info.bandwidth ?? 0 }),
    remember,
    fps: rungs[0]?.frameRate ?? 30,
  });
}
// 보이는 동안 재생 위치가 6초 그대로면 다시 틀고, 다음에도 그대로면 그 자리부터 다시 붙인다
let guard = 0;
let stuckFor = 0;
let tries = 0;
let guardTime = -1;
function startGuard() {
  guard = window.setInterval(() => {
    const video = codec.value ? videoEl.value : null;
    if (!video || document.hidden || !inView.value || !started.value) return;
    stuckFor = video.currentTime === guardTime ? stuckFor + 2 : 0;
    guardTime = video.currentTime;
    if (stuckFor === 0) tries = 0;
    if (stuckFor < 6) return;
    stuckFor = 0;
    tries++;
    if (tries === 1) {
      void video.play().catch(() => {
        // 다음에 다시 붙인다
      });
      return;
    }
    const at = video.currentTime;
    void attach().then(() => {
      if (videoEl.value) videoEl.value.currentTime = at;
    });
  }, 2000);
}

async function begin() {
  watching++;
  release(0);
  clearCover();
  await plan();
  lastScene = -2;
  paintScene(-1, FIRST_MS);
  startAdapting();
  if (videoEl.value) void attach();
}
// 다른 배경이 오면 차례부터 다시(흐림의 1080p 상한도 이때 본다. 화면 판에서 흐림을 바꾸는 동안은 다시 정하지 않는다)
watch(
  () => props.bg.id,
  () => void begin(),
);

// 틀이 보이지 않으면(운영자 패널의 다른 탭 · 접힌 곳) 영상을 멈춘다. 로그인 화면은 늘 보인다
const inView = ref(true);
let seen: IntersectionObserver | null = null;
watch(inView, (on) => {
  const video = videoEl.value;
  if (!video) return;
  if (!on) video.pause();
  else if (!document.hidden)
    void video.play().catch(() => {
      // 자동 재생이 막혔다(정지 그림이 그대로 보인다)
    });
});

let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    frame.width = entry.contentRect.width;
    frame.height = entry.contentRect.height;
  });
  if (frameEl.value) observer.observe(frameEl.value);
  seen = new IntersectionObserver(([entry]) => (inView.value = entry.isIntersecting));
  if (frameEl.value) seen.observe(frameEl.value);
  document.addEventListener("visibilitychange", onVisibility);
  startGuard();
  void begin();
});
onBeforeUnmount(() => {
  watching++;
  attaching++;
  observer?.disconnect();
  seen?.disconnect();
  document.removeEventListener("visibilitychange", onVisibility);
  clearInterval(guard);
  adapter?.stop();
  player?.destroy();
  releasePageSeed(OWNER);
});
</script>

<style scoped>
/* 주사율 붙잡기: 0 이면 크롬이 건너뛰고, 가려지면 바뀐 것으로 치지 않을 수 있어 맨 위 1px 점을 1 ~ 2% 사이로 */
.hold-tick {
  background: #000;
  animation: hold-tick 1s linear infinite alternate;
}
@keyframes hold-tick {
  from {
    opacity: 0.01;
  }
  to {
    opacity: 0.02;
  }
}
</style>
