<template>
  <section class="@container/card pane relative rounded-(--r-window) p-(--pad-window)">
    <PaneHeader v-if="title || icon || $slots.actions" :title="title" :icon="icon" class="mb-3">
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    </PaneHeader>
    <slot />
  </section>
</template>

<script setup lang="ts">
// 유리 카드(서버 화면의 창과 같은 모양: 반지름 · 여백 · 머리). 제목이 특수한 카드는 title 없이 slot 마크업으로 직접.
import PaneHeader from "./PaneHeader.vue";

withDefaults(defineProps<{ title?: string; icon?: string }>(), { title: "", icon: "" });
</script>
