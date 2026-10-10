// 앨범아트 읽기: 대표색과, 위아래 검은 띠를 빼고 정사각형으로 채우는 배율.
// 목록의 작은 아트는 픽셀을 읽지 않는다(대기열이 100곡이면 100번 읽게 된다)
// 썸네일 서버(유튜브 · 스포티파이 · 사운드클라우드)가 CORS 를 열어 두어 브라우저가 픽셀을 읽을 수 있다.
// 못 읽으면(막힌 곳 · 그림 없음) 색은 null, 배율은 주소로 짐작한 값이다

import { ref, watch, type Ref } from "vue";
import { QuantizerCelebi, Score } from "@material/material-color-utilities";
import { COLORLESS } from "./palette.ts";
import { labToRgb, rgbToLab } from "./oklab.ts";

// 색을 뽑을 때 읽는 크기(40×40). 대표색 하나를 고르는 데는 이 정도면 충분하고, 더 크면 양자화가 프레임을 넘긴다
const SIDE = 40;
const MAX_ZOOM = 2;
const SNAP = 0.08;

/** 주소만 보고 짐작한 배율(픽셀을 읽기 전). 유튜브 4:3 썸네일은 16:9 영상이 가운데 3/4 에 있다 */
const guessZoom = (url: string | null | undefined) => (url && /ytimg\.com\/vi(_webp)?\/[^/]+\/(hq|sd)?default\.(jpg|webp)/.test(url) ? 4 / 3 : 1);

// 그림 읽기 · 띠 재기 · 색 뽑기를 따로 기억한다. 색 뽑기(양자화)는 무거워 정말 필요한 그림만 한다.
// 기억에는 상한을 둔다(오래 켜 두면 곡이 수백 곡 넘어간다). 최근에 쓴 것부터 남기고 오래된 것을 놓는다.
// 원본 그림은 디코딩된 채로 들고 있어 무겁다(480×360 이면 0.7MB, 큰 그림이면 몇 MB): 색 뽑기 · 배경을 만든 뒤에는 거의 다시 쓰지 않으므로 몇 장만
const images = new Map<string, Promise<HTMLImageElement | null>>();
const contents = new Map<string, Promise<number>>();
const seeds = new Map<string, Promise<number | null>>();
const KEEP = { images: 8, small: 64, backdrops: 24 };

function remember<T>(map: Map<string, Promise<T>>, key: string, make: () => Promise<T>, keep: number, drop?: (gone: Promise<T>) => void): Promise<T> {
  let found = map.get(key);
  if (found) {
    // 최근에 쓴 것을 뒤로(Map 은 넣은 차례를 지킨다)
    map.delete(key);
    map.set(key, found);
    return found;
  }
  found = make();
  map.set(key, found);
  while (map.size > keep) {
    const [oldest, gone] = map.entries().next().value!;
    map.delete(oldest);
    drop?.(gone);
  }
  return found;
}

const imageOf = (url: string) =>
  remember(
    images,
    url,
    () =>
      new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.decoding = "async";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      }),
    KEEP.images,
  );

/** 위아래 검은 띠를 뺀 내용의 높이 비율(0~1). 줄마다 밝기를 보고 어두운 줄이 이어지는 데까지를 띠로 본다 */
function measure(img: HTMLImageElement): number {
  const w = 48;
  const h = Math.max(8, Math.round((w * img.naturalHeight) / img.naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 1;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const dark = (row: number) => {
    let max = 0;
    for (let x = 0; x < w; x++) {
      const i = (row * w + x) * 4;
      max = Math.max(max, data[i], data[i + 1], data[i + 2]);
    }
    return max < 28;
  };
  let top = 0;
  while (top < h / 2 && dark(top)) top++;
  let bottom = h - 1;
  while (bottom > h / 2 && dark(bottom)) bottom--;
  return Math.max(0.3, (bottom - top + 1) / h);
}

const contentOf = (url: string) =>
  remember(
    contents,
    url,
    async () => {
      const img = await imageOf(url);
      return img ? measure(img) : 1;
    },
    KEEP.small,
  );

/** 그림 주소의 대표색(ARGB). 띠를 뺀 가운데 정사각형에서 뽑는다. 못 읽으면 null, 쓸 만한 색이 없는 그림(흑백 · 거의 무채색)이면 COLORLESS(회색 테마) */
const seedOf = (url: string) =>
  remember(
    seeds,
    url,
    async () => {
      const img = await imageOf(url);
      if (!img) return null;
      const content = await contentOf(url);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = SIDE;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      const crop = Math.min(img.naturalWidth, img.naturalHeight * content);
      ctx.drawImage(img, (img.naturalWidth - crop) / 2, (img.naturalHeight - crop) / 2, crop, crop, 0, 0, SIDE, SIDE);
      const data = ctx.getImageData(0, 0, SIDE, SIDE).data;
      const pixels: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 255) continue;
        pixels.push(((255 << 24) | (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) >>> 0);
      }
      const [best] = Score.score(QuantizerCelebi.quantize(pixels, 64), { desired: 1, filter: true, fallbackColorARGB: COLORLESS });
      return best ?? null;
    },
    KEEP.small,
  );

// 배경화면용으로 미리 흐린 그림. 큰 겹을 CSS 로 흐리면 두 겹이 엇갈려 번지는 동안 매 프레임 두 겹을 다시 흐린다(무겁다).
// 한 번 만들어 두면 겹침은 다 된 그림 두 장을 섞기만 한다. 정한 폭으로 줄인 뒤 흐린다: 흐림은 그 폭 대비 비율이라 원본 해상도 · 화면 크기와 무관하게 같은 정도로 번진다.
// 밝기는 모드에 맞는 띠로 옮긴다(OKLab L, 색조는 그대로): 하얀 그림이 어두운 모드에서 글자와 부딪히거나, 까만 그림이 밝은 모드에서 그러지 않게.
// 그림의 쓰임마다 값이 다르다(BACKDROP_LOOKS)
type Band = { lo: number; hi: number; chroma: number };
type BakeLook = {
  /** 줄일 폭(px). upTo 면 상한: 그보다 작은 그림은 받은 그대로 */
  width: number;
  upTo: boolean;
  /** 흐림. 폭 대비 비율 */
  blur: number;
  saturate: number;
  /** 밝기 띠 세기(원래 색과 섞는 비율, 0 이면 띠 없음) · 모드마다 범위 */
  band: number;
  range: { dark: Band; light: Band };
  /** webp 품질 */
  quality: number;
  /** 위아래 검은 띠(레터박스)를 잘라 내는가 */
  crop: boolean;
};
/** 띠의 채도 상한을 끈다(OKLab 채도는 0.4 를 넘지 않는다) */
const NO_CAP = 1;
/** 모드마다 앨범아트 배경 밝기 띠(OKLab L 0~1)와 채도 상한. 어두운 모드 면은 L 0.13 쯤, 밝은 모드 면은 0.98 쯤이다 */
const BAND = { dark: { lo: 0.16, hi: 0.36, chroma: 0.1 }, light: { lo: 0.86, hi: 0.95, chroma: 0.07 } };
const BACKDROP_LOOKS = {
  // 지금 곡의 앨범아트(배경은 들러리). 아주 작게(64 폭) 만들어 브라우저가 늘리며 부드럽게 번지게 하고, 흐림은 살짝(1px) 준다
  // (2026-10-09 사용자가 배경 실험 페이지에서 고른 값. 192 폭은 늘렸을 때 압축 자국이 네모나게 보였다)
  song: { width: 64, upTo: false, blur: 1 / 64, saturate: 1.6, band: 1, range: BAND, quality: 0.92, crop: true },
  // 로그인 화면의 봇 프사(배경이 시계 · 버튼과 함께 주인공). 받은 그대로의 해상도로 그림을 살리고(768 폭 상한: 네 자리 폭부터 만드는 시간이 확 는다),
  // 흐림은 옅게, 채도는 그대로. 압축은 거의 하지 않는다(1.00 은 크기가 네 배쯤 뛴다). 2026-10-10 사용자가 배경 실험 페이지에서 고른 값
  avatar: { width: 768, upTo: true, blur: 0.005, saturate: 1, band: 0.5, range: { dark: { lo: 0.2, hi: 0.45, chroma: NO_CAP }, light: { lo: 0.8, hi: 0.95, chroma: NO_CAP } }, quality: 0.99, crop: false },
} satisfies Record<string, BakeLook>;
type BackdropKind = keyof typeof BACKDROP_LOOKS;
const backdrops = new Map<string, Promise<string | null>>();

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/** 픽셀마다 밝기를 띠 안으로 옮기고(어두운 것은 띠 아래쪽, 밝은 것은 위쪽: 무늬는 남는다) 채도를 묶는다. mix 는 원래 색과 섞는 비율(1 이면 띠 그대로) */
function intoBand(data: Uint8ClampedArray, band: Band, mix = 1) {
  for (let i = 0; i < data.length; i += 4) {
    const [L, a, b] = rgbToLab(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    const C = Math.hypot(a, b);
    const keep = C > band.chroma ? band.chroma / C : 1;
    const [r2, g2, b2] = labToRgb(band.lo + (band.hi - band.lo) * L, a * keep, b * keep);
    data[i] += (clamp255(r2) - data[i]) * mix;
    data[i + 1] += (clamp255(g2) - data[i + 1]) * mix;
    data[i + 2] += (clamp255(b2) - data[i + 2]) * mix;
  }
}

/** 배경화면 그림을 만든다(기억하지 않는다). 굽는 값을 바꿔 보는 개발 도구도 부른다 */
async function bakeBackdrop(url: string, dark: boolean, look: BakeLook): Promise<string | null> {
  const img = await imageOf(url);
  if (!img) return null;
  const content = look.crop ? await contentOf(url) : 1;
  const srcH = img.naturalHeight * content;
  const w = look.upTo ? Math.min(look.width, img.naturalWidth) : look.width;
  const blur = look.blur * w;
  const h = Math.max(1, Math.round((w * srcH) / img.naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.filter = `blur(${blur}px) saturate(${look.saturate})`;
  // 가장자리가 투명하게 번지지 않게 흐림 폭만큼 넘치게 그린다
  const pad = blur * 2;
  ctx.drawImage(img, 0, (img.naturalHeight - srcH) / 2, img.naturalWidth, srcH, -pad, -pad, w + pad * 2, h + pad * 2);
  try {
    const pixels = ctx.getImageData(0, 0, w, h);
    if (look.band > 0) intoBand(pixels.data, dark ? look.range.dark : look.range.light, look.band);
    ctx.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", look.quality));
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    // 픽셀을 못 읽는 그림(막힌 곳)
    return null;
  }
}

/** 쓰임(kind)의 값으로 흐리고 모드의 밝기 띠로 옮긴 배경화면 그림의 주소(blob). 못 읽으면 null(CSS 로 흐린다). 밀려나면 blob 을 놓는다 */
const backdropOf = (url: string, dark: boolean, kind: BackdropKind = "song") =>
  remember(
    backdrops,
    `${kind} ${dark ? "dark" : "light"} ${url}`,
    () => bakeBackdrop(url, dark, BACKDROP_LOOKS[kind]),
    KEEP.backdrops,
    (gone) => void gone.then((blob) => blob && URL.revokeObjectURL(blob)),
  );

/**
 * 아트를 정사각형으로 채우는 배율(띠를 뺀다). measured 가 아니면 주소로 짐작만 한다(작은 아트 · 목록은 픽셀을 읽지 않는다).
 * measured 면 픽셀로 띠를 재서 바꾼다(최대 2배)
 */
function useArtZoom(url: () => string | null | undefined, measured = false): Ref<number> {
  const zoom = ref(guessZoom(url()));
  watch(
    url,
    async (now) => {
      zoom.value = guessZoom(now);
      if (!now || !measured) return;
      const img = await imageOf(now);
      if (!img || url() !== now) return;
      const content = await contentOf(now);
      if (url() !== now) return;
      const measuredZoom = Math.min(MAX_ZOOM, img.naturalWidth >= img.naturalHeight ? 1 / content : 1);
      // 잰 값은 줄 단위라 조금 모자라 검은 띠가 한 줄 남는다. 주소로 아는 값(4:3 썸네일의 16:9 = 4/3)에 가까우면 그 값을 쓴다
      const guessed = guessZoom(now);
      zoom.value = Math.abs(measuredZoom - guessed) < SNAP ? guessed : measuredZoom;
    },
    { immediate: true },
  );
  return zoom;
}

export { BACKDROP_LOOKS, backdropOf, bakeBackdrop, seedOf, useArtZoom };
export type { BackdropKind, BakeLook };
