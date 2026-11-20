<template>
  <!-- 접으면 첫 줄만(끝에 말줄임), 펴면 전체가 보이는 글. 알림 카드(NoticeCard)의 제목과 본문이 쓴다.
       높이는 잰 두 값(한 줄, 전체) 사이를 스프링으로 오간다. grid 0fr ↔ 1fr은 한 줄을 남길 수 없고, minmax(1lh, …)는 한 줄보다 커질 때까지 멈춰 있어 펼 때 늦게 시작한다.
       말줄임은 다 접힌 뒤에만 붙이고 펴기 시작할 때 뗀다(접히는 동안 붙이면 줄이 한 번에 바뀐다) -->
  <div class="overflow-hidden transition-[height] spring" :style="height" @transitionend.self="clamped = !open">
    <div ref="el" class="whitespace-pre-line" :class="clamped && 'line-clamp-1'">{{ text }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useResizeObserver } from "@vueuse/core";

const props = defineProps<{ text: string; open: boolean }>();

const clamped = ref(!props.open);
watch(
  () => props.open,
  (on) => on && (clamped.value = false),
);
// 한 줄(줄 높이)과 전체(말줄임을 뗀 글의 높이). 재기 전에는 정하지 않는다(auto)
const el = ref<HTMLElement | null>(null);
const line = ref(0);
const full = ref(0);
useResizeObserver(el, () => {
  if (!el.value) return;
  line.value = parseFloat(getComputedStyle(el.value).lineHeight);
  if (!clamped.value) full.value = el.value.offsetHeight;
});
const height = computed(() => (line.value ? { height: `${props.open ? Math.max(full.value, line.value) : line.value}px` } : undefined));
</script>
