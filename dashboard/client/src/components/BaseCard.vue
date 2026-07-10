<template>
  <div class="bg-surface backdrop-blur-xl backdrop-saturate-[1.6] border border-line rounded-2xl p-5 shadow-card inset-shadow-glass">
    <div v-if="title" class="text-xs font-bold uppercase tracking-[0.09em] text-[rgba(196,181,253,0.65)] mb-2">{{ title }}</div>
    <slot />
  </div>
</template>

<script setup>
// 글래스모피즘 카드 — 구 .card/.card-title. 제목이 특수한 카드는 title 없이 slot 마크업으로 직접.
defineProps({ title: { type: String, default: "" } });
</script>
