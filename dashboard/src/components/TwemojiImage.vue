<!--
  이모지를 Twemoji 그림으로 그린다. 그림은 디스코드가 올린 @discordapp/twemoji 의 SVG 를 봇이 같이 내준다(twemoji-images.ts).

  폰트로 그리지 않는 이유: 웹폰트로 쓸 수 있는 Twemoji(twemoji-colr-font)는 COLRv0이라 원본 SVG와
  모양이 조금 다르고 Twemoji 15.0에서 멈춰 있어, 그 뒤에 늘어난 이모지가 두부로 보였다.

  그림이 없으면(디스코드에도 없는 이모지) 글자로 되돌려 OS 이모지 글꼴(.emoji)로 그린다.
-->
<template>
  <img v-if="!failed" :src="url" :alt="char" :width="size" :height="size" class="inline-block select-none" draggable="false" loading="lazy" decoding="async" @error="next" />
  <span v-else class="emoji leading-none" :style="{ fontSize: `${size}px` }">{{ char }}</span>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";

const props = withDefaults(defineProps<{ char: string; size?: number }>(), { size: 20 });

const failed = ref(false);
const tried = ref(0);

watch(
  () => props.char,
  () => {
    failed.value = false;
    tried.value = 0;
  },
);

const codePoints = (text: string) => [...text].map((c) => (c.codePointAt(0) ?? 0).toString(16)).join("-");

// 파일 이름 규칙. Twemoji는 ZWJ가 없는 이모지에서만 VS16(FE0F)을 떼고 이름을 짓는다
// (twemoji 라이브러리의 grabTheRightIcon과 같은 규칙).
//
// 다만 예외가 있다: 👁️‍🗨️의 파일은 ZWJ가 있는데도 VS16을 뗀 1f441-200d-1f5e8 이다.
// 규칙대로 지은 이름이 없으면 전부 뗀 이름으로 한 번 더 해 본다.
const candidates = computed(() => {
  const char = props.char;
  const strict = codePoints(char.includes("‍") ? char : char.replace(/️/g, ""));
  const loose = codePoints(char.replace(/️/g, ""));
  return strict === loose ? [strict] : [strict, loose];
});

const url = computed(() => `${import.meta.env.BASE_URL}${__TWEMOJI_DIR__}/${candidates.value[tried.value]}.svg`);

function next() {
  if (tried.value < candidates.value.length - 1) tried.value++;
  else failed.value = true;
}
</script>
