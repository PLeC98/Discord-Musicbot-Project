<template>
  <!-- BaseIcon 과 같은 칸(글꼴 칸 1em)에 방패를 가운데로. 색은 글자 색 -->
  <span class="inline-flex shrink-0 items-center justify-center size-[1em] align-[-0.18em]" :style="{ fontSize: `${Number(size) / 16}rem` }" aria-hidden="true">
    <svg :viewBox="SHIELD.viewBox" :style="{ height: `${SHIELD_OF_GLYPH}em` }" fill="currentColor"><path v-for="d in SHIELD.paths" :key="d" :d="d" /></svg>
  </span>
</template>

<script setup lang="ts">
// SponsorBlock 의 하이라이트로 건너뛰기 아이콘(방패, data/discord-icons/skipIcon.svg · 고지는 data/NOTICE). 디스코드 앱 이모지와 같은 모양 · 같은 크기 비율(ui/shield-svg)
import raw from "../../../data/discord-icons/skipIcon.svg?raw";
import { SHIELD_OF_GLYPH, shieldOf } from "../../../src/ui/shield-svg.ts";

/** size 는 BaseIcon 과 같다(기본 글자 크기일 때의 px) */
withDefaults(defineProps<{ size?: number | string }>(), { size: 20 });
const SHIELD = shieldOf(raw);
</script>
