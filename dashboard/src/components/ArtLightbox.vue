<template>
  <!-- 앨범아트 크게 보기. 바깥을 누르거나 Esc 로 닫는다. 어두운 막 위라 글은 모드와 상관없이 흰색 -->
  <Teleport to="body">
    <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
      <div v-if="open && track?.thumbnail" class="fixed inset-0 z-300 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-4 p-6 cursor-zoom-out" role="dialog" aria-modal="true" :aria-label="`${songTitle(track.title)} 앨범아트`" @click="open = false">
        <div class="relative rounded-2xl overflow-hidden bg-surface-container-high shadow-[0_1px_3px_rgb(0_0_0/0.3),0_4px_8px_3px_rgb(0_0_0/0.15)]" :class="box ? 'animate-[art-in_400ms_var(--ease-spring-fast)]' : 'opacity-0 size-40'" :style="box ?? undefined">
          <img :src="large" alt="" class="size-full object-cover" @load="loaded" @error="failed" />
        </div>
        <div class="text-center text-white max-w-[min(90vw,32rem)]">
          <div class="text-xl font-round font-semibold line-clamp-2">{{ songTitle(track.title) }}</div>
          <div v-if="track.artist" class="mt-1 text-base opacity-80 truncate">{{ track.artist }}</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onKeyStroke } from "@vueuse/core";
import { songTitle } from "../../../src/ui/text/ko/labels.ts";
import { rem } from "../utils/rem.ts";

/** zoom: 작은 아트의 위아래 검은 띠를 감추는 배율(theme/art 의 useArtZoom) */
const props = defineProps<{ track: { thumbnail?: string | null; title: string | null; artist?: string | null } | null | undefined; zoom: number }>();
const open = defineModel<boolean>("open", { required: true });

onKeyStroke("Escape", () => (open.value = false));

// 유튜브는 큰 썸네일(띠 없는 16:9)을 먼저 써 보고, 없으면(작은 자리 그림이 온다) 지금 그림으로
const YT_SMALL = /^(https:\/\/i\.ytimg\.com\/vi\/[^/]+\/)(hq|sd|mq)?default\.jpg$/;
const wideFailed = ref(false);
const wide = computed(() => !wideFailed.value && YT_SMALL.test(props.track?.thumbnail ?? ""));
const large = computed(() => {
  const url = props.track?.thumbnail ?? "";
  return wide.value ? url.replace(YT_SMALL, "$1maxresdefault.jpg") : url;
});

// 그림 크기를 받은 뒤 원래 비율로 띄운다(위아래 검은 띠는 뺀다). 긴 변은 28rem(448) 까지, 그림 원래 크기의 1.5배까지만 키운다
const MAX_REM = 28;
const size = ref<{ w: number; h: number } | null>(null);
watch(
  () => props.track?.thumbnail,
  () => (wideFailed.value = false),
);
watch(large, () => (size.value = null));
function loaded(e: Event) {
  const img = e.target as HTMLImageElement;
  // 유튜브는 큰 썸네일이 없으면 작은 자리 그림(120×90)을 준다
  if (wide.value && img.naturalWidth < 200) wideFailed.value = true;
  else size.value = { w: img.naturalWidth, h: img.naturalHeight };
}
function failed() {
  if (wide.value) wideFailed.value = true;
  else size.value = { w: 1, h: 1 };
}
const box = computed(() => {
  const s = size.value;
  if (!s) return null;
  const aspect = s.w / (wide.value ? s.h : s.h / props.zoom);
  const cap = Math.min(rem(MAX_REM) * Math.min(1, aspect), s.w * 1.5);
  return { aspectRatio: String(aspect), width: `min(${Math.round(cap)}px, 90vw, calc(65dvh * ${aspect.toFixed(4)}))` };
});
</script>
