<template>
  <!-- 재생 · 일시정지(모양은 스포티파이를 따른다): 채운 동그라미, 재생 · 일시정지 모두 같은 모양. 올리면 살짝 커지고 누르면 살짝 눌린다 -->
  <button type="button" class="tap flex items-center justify-center shrink-0 rounded-full cursor-pointer bg-primary text-on-primary transition-[scale,background-color] duration-150 hover:not-disabled:scale-105 active:not-disabled:scale-95 disabled:cursor-not-allowed disabled:bg-on-surface/12 disabled:text-on-surface/38" :class="sizeClass" v-tooltip="running ? '일시정지' : '재생'">
    <Icon :name="running ? 'pause' : 'play_arrow'" :size="iconSize" fill :weight="500" />
  </button>
</template>

<script setup lang="ts">
import Icon from "./BaseIcon.vue";

// 기본은 서버 화면의 재생 버튼 64(구글 Media3 전체 플레이어 63 의 근사) · 아이콘 32(M3E L 아이콘. 스포티파이처럼 동그라미의 절반쯤)
withDefaults(defineProps<{ running: boolean; sizeClass?: string; iconSize?: number }>(), { sizeClass: "size-16", iconSize: 32 });
</script>
