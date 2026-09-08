<template>
  <!-- 서버 아이콘 + 재생 중 점 — 레일과 드로어가 같은 목록을 두 번 그리므로 분리 -->
  <span class="relative shrink-0">
    <img v-if="guild.icon" :src="guild.icon" :alt="guild.name" class="size-9 rounded-full border border-white/10 block" />
    <span v-else class="size-9 rounded-full border border-white/10 bg-linear-135 from-accent to-accent-2 text-sm font-bold text-white flex items-center justify-center">{{ guild.name[0] }}</span>
    <span v-if="guild.hasPlayer" v-tooltip="'재생 중'" class="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full bg-success border-2 border-[#070b15]"></span>
  </span>
</template>

<script setup>
defineProps({
  guild: { type: Object, required: true },
});
</script>
