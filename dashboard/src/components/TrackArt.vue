<template>
  <!-- 앨범아트. 직접 링크는 아트를 알 수 없어 아이콘으로 대체.
       크기 · 모서리는 부모가 완성된 클래스 문자열로 넘긴다(Tailwind는 조립된 클래스명을 못 본다). -->
  <span v-if="track?.thumbnail" class="shrink-0 overflow-hidden" :class="sizeClass">
    <img :src="track.thumbnail" alt="" loading="lazy" decoding="async" class="size-full object-cover" :style="zoom > 1 ? { scale: zoom } : undefined" />
  </span>
  <span v-else class="shrink-0 bg-secondary-container text-on-secondary-container flex items-center justify-center" :class="sizeClass">
    <Icon name="music_note" :size="iconSize" />
  </span>
</template>

<script setup lang="ts">
import Icon from "./BaseIcon.vue";
import { useArtZoom } from "../theme/art.ts";
import type { PlayingView } from "../../../src/dashboard/contract/player.ts";

const props = withDefaults(defineProps<{ track?: Pick<PlayingView, "thumbnail"> | null; sizeClass: string; iconSize?: number }>(), { track: null, iconSize: 24 });

// 위아래 검은 띠는 키워서 감춘다(theme/art 가 픽셀로 잰다)
const zoom = useArtZoom(() => props.track?.thumbnail);
</script>
