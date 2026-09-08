<template>
  <!-- 앨범아트 — 직접 링크는 아트를 알 수 없어 아이콘으로 대체.
       크기는 부모가 완성된 클래스 문자열로 넘긴다(Tailwind는 조립된 클래스명을 못 본다). -->
  <img v-if="track?.thumbnail" :src="track.thumbnail" alt="" class="shrink-0 rounded-lg object-cover border border-white/10" :class="sizeClass" />
  <span v-else class="shrink-0 rounded-lg bg-white/7 border border-white/10 flex items-center justify-center text-muted" :class="sizeClass">
    <Icon name="audio-file" :size="20" />
  </span>
</template>

<script setup>
import Icon from "./BaseIcon.vue";

defineProps({
  track: { type: Object, default: null },
  sizeClass: { type: String, required: true },
});
</script>
