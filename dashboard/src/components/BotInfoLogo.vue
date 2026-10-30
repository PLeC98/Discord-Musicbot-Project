<template>
  <!-- 봇 정보 탭의 로고(fastfetch 의 로고 자리). 봇 프로필 그림을 옥탄트 블록 그림처럼 그린다: 칸(1ch × 한 줄)을 2 × 4 조각으로 보고 칸마다 두 색만 쓴다.
       움직이는 그림은 프레임마다 그린다. 프로필이 없거나 그림을 읽지 못하면 음표 -->
  <div ref="rootEl">
    <canvas v-if="pictures.length" ref="canvasEl" :width="W" :height="H" class="block [image-rendering:pixelated]" :style="{ width: `${COLS}ch`, height: `calc(var(--term-line) * ${ROWS})` }"></canvas>
    <template v-else>
      <div v-for="(line, i) in LOGO" :key="i" class="flex" :class="i < LOGO_SPLIT ? 'text-primary' : 'text-tertiary'">
        <span v-for="(c, j) in line" :key="j" class="w-[1ch] h-(--term-line)" :class="BLOCK[c]"></span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useDocumentVisibility, useElementVisibility, useMediaQuery } from "@vueuse/core";

const props = defineProps<{ src: string | null }>();

// 크기: 20줄 높이에 가로는 정사각형에 가장 가까운 칸 수(한 줄 17px · 한 칸 7px 이라 48칸). 그림은 칸마다 2 × 4 조각
const ROWS = 20;
const COLS = 48;
const W = COLS * 2;
const H = ROWS * 4;

const LOGO = ["        ▄▄▄▄▄▄▄▄▄▄", "        █▀▀▀▀▀▀▀▀█", "        █        █", "        █        █", "        █        █", "    ▄▄▄▄█    ▄▄▄▄█", "   ██████   ██████", "   ▀████▀   ▀████▀"];
// 위 다섯 줄(음표 머리 · 기둥)은 primary, 아래(음표 알)는 tertiary(fastfetch 로고의 두 색)
const LOGO_SPLIT = 5;
// 블록 글자 → 칸을 채우는 면(전체 · 위 절반 · 아래 절반)
const BLOCK: Record<string, string> = { "█": "bg-current", "▀": "bg-[linear-gradient(currentColor_50%,transparent_0)]", "▄": "bg-[linear-gradient(transparent_50%,currentColor_0)]" };

type Picture = { image: ImageData; ms: number };
const pictures = ref<Picture[]>([]);
const rootEl = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);

const colorAt = (d: Uint8ClampedArray, i: number) => [d[i], d[i + 1], d[i + 2], d[i + 3]];
const distance = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 + (a[3] - b[3]) ** 2;

/** 조각 색들을 두 무리로 나눈다(가장 먼 두 조각에서 시작하는 2-평균). 조각마다 무리의 평균색 */
function splitTwo(px: number[][]): number[][] {
  let seeds = [px[0], px[0]];
  let far = -1;
  for (let a = 0; a < px.length; a++)
    for (let b = a + 1; b < px.length; b++) {
      const e = distance(px[a], px[b]);
      if (e > far) [seeds, far] = [[px[a], px[b]], e];
    }
  let side: number[] = [];
  for (let pass = 0; pass < 3; pass++) {
    side = px.map((p) => (distance(p, seeds[0]) <= distance(p, seeds[1]) ? 0 : 1));
    seeds = seeds.map((seed, k) => {
      const mine = px.filter((_, q) => side[q] === k);
      return mine.length ? [0, 1, 2, 3].map((ch) => mine.reduce((s, p) => s + p[ch], 0) / mine.length) : seed;
    });
  }
  return side.map((k) => seeds[k]);
}

/** 칸마다 2 × 4 조각을 두 색으로 칠한 그림 */
function twoTone(d: Uint8ClampedArray): ImageData {
  const out = new ImageData(W, H);
  for (let cy = 0; cy < ROWS; cy++)
    for (let cx = 0; cx < COLS; cx++) {
      const at = Array.from({ length: 8 }, (_, q) => ((cy * 4 + (q >> 1)) * W + cx * 2 + (q & 1)) * 4);
      splitTwo(at.map((i) => colorAt(d, i))).forEach((c, q) => out.data.set(c, at[q]));
    }
  return out;
}

/** 한 장면을 W × H 로 줄여 두 색 그림으로 */
function pictureOf(source: CanvasImageSource) {
  const ctx = new OffscreenCanvas(W, H).getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, W, H);
  return twoTone(ctx.getImageData(0, 0, W, H).data);
}

// 브라우저처럼 GIF 지연 10ms 이하는 100ms 로 보인다(옛 GIF 호환 규칙)
const frameMs = (us: number | null) => (us === null || us <= 10_000 ? 100 : us / 1000);

/** 프레임마다 두 색 그림. ImageDecoder 가 없거나 이 형식을 못 풀면 첫 장면 하나 */
async function picturesOf(src: string): Promise<Picture[]> {
  const blob = await (await fetch(src)).blob();
  if (!("ImageDecoder" in window) || !(await ImageDecoder.isTypeSupported(blob.type))) {
    const bitmap = await createImageBitmap(blob);
    return [{ image: pictureOf(bitmap), ms: 0 }];
  }
  const decoder = new ImageDecoder({ data: blob.stream(), type: blob.type });
  try {
    await decoder.completed;
    const out: Picture[] = [];
    for (let i = 0; i < decoder.tracks.selectedTrack!.frameCount; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      out.push({ image: pictureOf(image), ms: frameMs(image.duration) });
      image.close();
    }
    return out;
  } finally {
    decoder.close();
  }
}

let loaded = 0;
watch(
  () => props.src,
  async (src) => {
    const mine = ++loaded;
    pictures.value = [];
    if (!src) return;
    try {
      const next = await picturesOf(src);
      if (mine === loaded) pictures.value = next;
    } catch {
      // 받지 못했거나 풀지 못했다: 음표로 둔다
    }
  },
  { immediate: true },
);

// 재생: 보일 때만(탭 · 창이 가려지면 멈춘다), 움직임 줄이기면 첫 장면에 둔다
const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
const onScreen = useElementVisibility(rootEl);
const pageVisible = useDocumentVisibility();
const playing = computed(() => pictures.value.length > 1 && !reduced.value && onScreen.value && pageVisible.value === "visible");
let frame = 0;
let timer = 0;

function show() {
  canvasEl.value?.getContext("2d")?.putImageData(pictures.value[frame].image, 0, 0);
}
function step() {
  frame = (frame + 1) % pictures.value.length;
  show();
  timer = window.setTimeout(step, pictures.value[frame].ms);
}
watch([pictures, canvasEl], () => {
  frame = 0;
  if (pictures.value.length) show();
});
watch(
  playing,
  (on) => {
    clearTimeout(timer);
    if (on) timer = window.setTimeout(step, pictures.value[frame].ms);
  },
  { immediate: true },
);
onUnmounted(() => clearTimeout(timer));
</script>
