<template>
  <!-- 앨범아트. 그림이 없거나 불러오지 못하면(곡이 빠진 뒤 늦게 불린 그림 등) 아이콘으로 대체.
       크기 · 모서리는 부모가 완성된 클래스 문자열로 넘긴다(Tailwind는 조립된 클래스명을 못 본다). -->
  <span v-if="shown" class="shrink-0 overflow-hidden" :class="sizeClass">
    <img :src="shown" alt="" loading="lazy" decoding="async" class="size-full object-cover" :style="zoom > 1 ? { scale: zoom } : undefined" @error="broken = shown" />
  </span>
  <span v-else class="shrink-0 bg-secondary-container text-on-secondary-container flex items-center justify-center" :class="sizeClass">
    <Icon name="music_note" :size="iconSize" />
  </span>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "./BaseIcon.vue";
import { useArtZoom } from "../theme/art.ts";
import type { PlayingView } from "../../../src/dashboard/contract/player.ts";

const props = withDefaults(defineProps<{ track?: Pick<PlayingView, "thumbnail"> | null; sizeClass: string; iconSize?: number }>(), { track: null, iconSize: 24 });

// 불러오지 못한 주소. 주소가 바뀌면 다시 그린다
const broken = ref<string | null>(null);
const shown = computed(() => (props.track?.thumbnail && props.track.thumbnail !== broken.value ? props.track.thumbnail : null));

// 위아래 검은 띠는 키워서 감춘다(theme/art 가 픽셀로 잰다)
const zoom = useArtZoom(() => props.track?.thumbnail);
</script>
