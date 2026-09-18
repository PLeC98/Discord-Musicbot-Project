<!--
  이모지를 Twemoji 그림으로 그린다 — 디스코드가 보여 주는 것과 같은 그림이다.

  폰트로 그리지 않는 이유: 웹폰트로 쓸 수 있는 Twemoji(twemoji-colr-font)는 COLRv0이라 원본 SVG와
  모양이 조금 다르고 Twemoji 15.0에서 멈춰 있어, 그 뒤에 늘어난 이모지가 두부로 보였다.

  그림을 못 받아오면(CDN이 막혔거나 아직 없는 이모지) 글자로 되돌린다. 그때 쓰는 .emoji 글꼴이
  그 대비다 — @font-face는 실제로 이 자리가 그려질 때만 내려받으므로 평소에는 값이 들지 않는다.
-->
<template>
  <img v-if="!failed" :src="url" :alt="char" :width="size" :height="size" class="inline-block select-none" draggable="false" loading="lazy" decoding="async" @error="next" />
  <span v-else class="emoji leading-none" :style="{ fontSize: `${size}px` }">{{ char }}</span>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import twemoji from "@twemoji/api";

const props = defineProps({
  char: { type: String, required: true },
  size: { type: Number, default: 20 },
});

const failed = ref(false);
const tried = ref(0);

watch(
  () => props.char,
  () => {
    failed.value = false;
    tried.value = 0;
  },
);

// 파일 이름 규칙 — Twemoji는 ZWJ가 없는 이모지에서만 VS16(FE0F)을 떼고 이름을 짓는다
// (라이브러리의 grabTheRightIcon과 같은 규칙. 그 함수는 내보내지 않아 여기서 옮긴다).
//
// 다만 예외가 있다: 👁️‍🗨️의 파일은 ZWJ가 있는데도 VS16을 뗀 1f441-200d-1f5e8 이다.
// 규칙대로 지은 이름이 없으면 전부 뗀 이름으로 한 번 더 해 본다.
const candidates = computed(() => {
  const char = props.char;
  const strict = twemoji.convert.toCodePoint(char.includes("‍") ? char : char.replace(/️/g, ""));
  const loose = twemoji.convert.toCodePoint(char.replace(/️/g, ""));
  return strict === loose ? [strict] : [strict, loose];
});

const url = computed(() => `${twemoji.base}svg/${candidates.value[tried.value]}.svg`);

function next() {
  if (tried.value < candidates.value.length - 1) tried.value++;
  else failed.value = true;
}
</script>
