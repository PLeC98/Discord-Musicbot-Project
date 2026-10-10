// 화면 테마: 밝기(어둡게 · 밝게 · 시스템)와 바탕색. 바탕색은 보고 있는 곡의 앨범아트에서 온다.
// 서버 화면을 보고 있으면 그 서버의 곡, 아니면 내가 듣는 곡(재생 바), 둘 다 없으면 기본색

import { computed, reactive, ref, watch } from "vue";
import { argbFromHex } from "@material/material-color-utilities";
import { DEFAULT_SEED, paletteOf } from "./palette.ts";
import { backdropOf, seedOf, type BackdropKind } from "./art.ts";
import { blendTo, setNow } from "./blend.ts";
import { readStored, writeStored } from "../utils/storage.ts";

type Mode = "dark" | "light" | "system";
const MODES: Mode[] = ["dark", "light", "system"];
const STORAGE_KEY = "theme:mode";

const stored = readStored(STORAGE_KEY);
const mode = ref<Mode>(MODES.includes(stored as Mode) ? (stored as Mode) : "dark");
const systemDark = ref(window.matchMedia("(prefers-color-scheme: dark)").matches);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => (systemDark.value = e.matches));
const dark = computed(() => (mode.value === "system" ? systemDark.value : mode.value === "dark"));

/** 화면 설정(계정 메뉴의 설정). 앨범아트 색 · 배경화면을 끄면 기본색 · 그라데이션, clock 은 PC 시계 */
type Prefs = { artColor: boolean; artWallpaper: boolean; clock: boolean };
const PREFS_KEY = "theme:prefs";
const prefs = reactive<Prefs>({ artColor: true, artWallpaper: true, clock: true });
try {
  Object.assign(prefs, JSON.parse(readStored(PREFS_KEY) ?? "{}"));
} catch {
  // 망가진 값이면 기본값
}
function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefs[key] = value;
  writeStored(PREFS_KEY, JSON.stringify(prefs));
}

/**
 * 앨범아트의 자리. page 가 앞선다. page 가 HOLD 면 서버 화면을 여는 중이라 지금 색을 붙잡아 둔다(옮겨 가는 길에 다른 색을 들르지 않게).
 * page 가 NO_ART 면 그 화면의 서버에 곡이 없다: 듣는 곡으로 내려가지 않고 운영자 색(brandSeed)을 쓴다. null 은 "화면이 정하지 않음"이라 듣는 곡을 쓴다
 */
const HOLD = Symbol("hold");
const NO_ART = Symbol("no-art");
const art = reactive({ page: null as string | null | typeof HOLD | typeof NO_ART, pageKind: "song" as BackdropKind, listening: null as string | null });
/** 색을 뽑을 그림. null 이면 운영자 색 */
const wanted = computed((previous?: string | null) => {
  if (art.page === HOLD) return previous ?? null;
  if (art.page === NO_ART) return null;
  return art.page ?? art.listening;
});
/** 그 그림의 쓰임(배경화면 값이 다르다). 화면이 깐 그림이면 화면이 정한 쓰임, 듣는 곡이면 song */
const wantedKind = computed((): BackdropKind => (typeof art.page === "string" ? art.pageKind : "song"));
/** 배경화면에 깔린 그림. 색과 같은 때에 바뀐다(그림을 읽고 색을 뽑은 뒤). baked 면 미리 흐린 그림(art.ts backdropOf), 아니면 CSS 로 흐린다. kind 는 그림의 쓰임 */
type Wallpaper = { src: string; baked: boolean; kind: BackdropKind };
const shown = ref<Wallpaper | null>(null);
const wallpaper = computed(() => (prefs.artWallpaper ? shown.value : null));

/**
 * 앨범아트가 없을 때(곡이 없음 · 앨범아트 색 사용을 끔)의 바탕색. 운영자가 정한 임베드 색(EMBED_COLOR, /api/bot 의 brandColor).
 * 받기 전에는 지난번에 받은 색(이 브라우저에 기억), 그것도 없으면 기본색
 */
const BRAND_KEY = "theme:brand";
const HEX = /^#[0-9a-f]{6}$/i;
const storedBrand = readStored(BRAND_KEY);
const brandSeed = ref(storedBrand && HEX.test(storedBrand) ? argbFromHex(storedBrand) : DEFAULT_SEED);
function setBrandColor(hex: string | null | undefined) {
  if (!hex || !HEX.test(hex)) return;
  brandSeed.value = argbFromHex(hex);
  writeStored(BRAND_KEY, hex);
}

const seed = ref(brandSeed.value);
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

/** 색 · 배경이 옮겨 가는 시간. 배경화면의 겹침(AppWallpaper)도 같은 시간이다 */
const SHIFT_MS = 700;

/**
 * 색 역할을 깐다. 처음 그릴 때 · 움직임을 줄인 때는 바로, 그 밖은 모든 역할을 한 박자로 옮긴다(blend).
 * 배경화면은 같은 때에 바꿔 같은 시간 동안 겹친다
 */
let painted = false;
function paint() {
  const root = document.documentElement;
  const target = paletteOf(seed.value, dark.value);
  if (!painted || reduced.matches) setNow(target);
  // 화면이 바뀐 바로 그 프레임(새 화면 그리기)이 지나간 뒤에 시작한다. 첫걸음이 무거운 프레임에 걸리지 않게
  else requestAnimationFrame(() => requestAnimationFrame(() => blendTo(target, SHIFT_MS)));
  painted = true;
  root.dataset.theme = dark.value ? "dark" : "light";
  root.style.colorScheme = dark.value ? "dark" : "light";
}

let asked = 0;
watch(
  [wanted, wantedKind, () => prefs.artColor, brandSeed, dark],
  async ([url, kind, follow, , isDark]) => {
    const mine = ++asked;
    // 다음 곡은 미리 읽어 두므로(prefetchArt) 대개 바로 나온다. 배경은 모드마다 밝기 띠가 달라 모드가 바뀌면 다시 만든다
    const [found, backdrop] = await Promise.all([url && follow ? seedOf(url) : brandSeed.value, url ? backdropOf(url, isDark, kind) : null]);
    // 늦게 온 옛 그림의 색이 새 색을 덮지 않게. 그림을 못 읽었으면 색은 두고 배경만
    if (mine !== asked) return;
    if (found !== null) seed.value = found;
    shown.value = url ? { src: backdrop ?? url, baked: Boolean(backdrop), kind } : null;
    paint();
  },
  { immediate: true },
);

/**
 * 화면이 자기 그림을 깐다(art.page). 쓰임(kind)으로 배경화면 값을 고른다(로그인 화면의 봇 프사는 avatar).
 * 깐 화면이 주인이 되고, 치울 때는 주인만 치운다.
 * 화면이 바뀌면 새 화면이 먼저 깔고 옛 화면의 정리(onUnmounted)가 뒤에 돈다. 아무나 치우면 새 화면이 깐 것을 지운다
 */
let pageOwner: symbol | null = null;
function setPageArt(owner: symbol, url: string | null | typeof HOLD | typeof NO_ART, kind: BackdropKind = "song") {
  pageOwner = owner;
  art.page = url;
  art.pageKind = kind;
}
function releasePageArt(owner: symbol) {
  if (pageOwner !== owner) return;
  pageOwner = null;
  art.page = null;
}

/** 곧 틀 곡의 그림을 미리 읽어 색을 뽑고 배경을 흐려 둔다(곡이 바뀌는 순간 바로 옮겨 가게). 브라우저가 한가할 때 한다 */
const idle: (run: () => void) => void = "requestIdleCallback" in window ? (run) => requestIdleCallback(run, { timeout: 2000 }) : (run) => setTimeout(run, 200);
function prefetchArt(url: string | null | undefined) {
  if (url) idle(() => void Promise.all([seedOf(url), backdropOf(url, dark.value)]));
}

function setMode(next: Mode) {
  mode.value = next;
  writeStored(STORAGE_KEY, next);
}

export { art, dark, HOLD, mode, NO_ART, prefetchArt, prefs, releasePageArt, setBrandColor, setMode, setPageArt, setPref, wallpaper, MODES, SHIFT_MS };
export type { Mode, Prefs, Wallpaper };
