<template>
  <!-- 창 하나(Hyprland 의 창 자리). 바탕화면 위에 간격을 두고 놓인다. 머리(이름 · 아이콘 · 오른쪽 조작)는 있을 때만 -->
  <section class="@container/win window pane relative flex flex-col min-h-0 min-w-0 rounded-(--r-window) p-(--pad-window)">
    <PaneHeader v-if="title || $slots.actions" :title="title" :icon="icon" class="mb-3 shrink-0">
      <template v-if="$slots.badge" #badge><slot name="badge" /></template>
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    </PaneHeader>
    <slot />
  </section>
</template>

<script setup lang="ts">
import PaneHeader from "../components/PaneHeader.vue";

withDefaults(defineProps<{ title?: string; icon?: string }>(), { title: "", icon: "" });
</script>
