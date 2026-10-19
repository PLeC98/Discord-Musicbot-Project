<template>
  <!-- 앨범아트 크게 보기. 바깥을 누르거나 Esc 로 닫는다. 어두운 막 위라 글은 모드와 상관없이 흰색 -->
  <Teleport to="body">
    <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
      <div v-if="open && track?.thumbnail" class="fixed inset-0 z-300 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-4 p-6 cursor-zoom-out" role="dialog" aria-modal="true" :aria-label="T.albumArt(songTitle(track.title))" @click="open = false">
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
import { artOf } from "../../../src/rules/track-art.ts";
import type { Content } from "../theme/art.ts";
import { text } from "../text/index.ts";
const T = text.player;

/** content: 띠를 뺀 내용의 비율(theme/art 의 useArtContent). 큰 그림도 같은 틀이라 같은 비율로 뺀다 */
const props = defineProps<{ track: { thumbnail?: string | null; title: string | null; artist?: string | null } | null | undefined; content: Content }>();
const open = defineModel<boolean>("open", { required: true });

onKeyStroke("Escape", () => (open.value = false));

// 큰 그림이 따로 있으면(유튜브 maxresdefault, rules/track-art) 먼저 써 보고, 없으면(작은 대체 그림이 온다) 지금 그림으로
const wideFailed = ref(false);
const big = computed(() => artOf(props.track?.thumbnail, "large") ?? "");
const wide = computed(() => !wideFailed.value && big.value !== (props.track?.thumbnail ?? ""));
const large = computed(() => (wide.value ? big.value : (props.track?.thumbnail ?? "")));

// 그림 크기를 받은 뒤 원래 비율로 표시한다(네 방향 검은 띠는 뺀다: 틀을 내용의 비율로 두고 가운데를 채운다).
// 화면에 맞춰 키우되(폭 90% · 높이 65% 안) 그림이 가진 화소(띠를 뺀 내용)의 1.5배까지만: 큰 그림은 크게, 작은 그림은 뭉개지지 않을 만큼
const UPSCALE_MAX = 1.5;
const size = ref<{ w: number; h: number } | null>(null);
watch(
  () => props.track?.thumbnail,
  () => (wideFailed.value = false),
);
watch(large, () => (size.value = null));
function loaded(e: Event) {
  const img = e.target as HTMLImageElement;
  // 유튜브는 큰 썸네일이 없으면 작은 대체 그림(120×90)을 준다
  if (wide.value && img.naturalWidth < 200) wideFailed.value = true;
  else size.value = { w: img.naturalWidth, h: img.naturalHeight };
}
// 큰 그림이 없으면 지금 그림으로, 지금 그림도 못 불러오면 보일 것이 없어 닫는다
function failed() {
  if (wide.value) wideFailed.value = true;
  else open.value = false;
}
const box = computed(() => {
  const s = size.value;
  if (!s) return null;
  const aspect = (s.w * props.content.w) / (s.h * props.content.h);
  const cap = s.w * props.content.w * UPSCALE_MAX;
  return { aspectRatio: String(aspect), width: `min(${Math.round(cap)}px, 90vw, calc(65dvh * ${aspect.toFixed(4)}))` };
});
</script>
