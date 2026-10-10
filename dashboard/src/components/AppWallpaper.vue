<template>
  <!-- 배경화면. 지금 곡의 앨범아트를 크게 흐려 깐다(라이스의 배경화면 자리).
       곡이 없거나 배경을 끄면 색 역할로 만든 그라데이션. 그림이 바뀌거나 켜고 끌 때 색과 같은 시간(0.7초) 동안 겹이 엇갈려 번진다. 맨 위에 아주 옅은 알갱이(질감).
       색이 옮겨 가는 동안 넘김을 끄는 규칙(style.css data-shifting)에서 빠진다(data-shift-keep): 그림 겹침이 색 옮김과 같은 때에 돈다 -->
  <div class="absolute inset-0 overflow-hidden bg-surface pointer-events-none" aria-hidden="true" data-shift-keep>
    <!-- 그림이 없을 때의 그라데이션. 밝은 모드는 한 단계 짙은 면(surface-container) 위에(흰 면 위의 옅은 색만으로는 너무 밝다. 앨범아트 배경의 밝기 띠와 맞춘다) -->
    <div class="absolute inset-0 transition-opacity duration-700 ease-smooth" :class="[layers.length ? 'opacity-0' : 'opacity-100', !dark && 'bg-surface-container']" :style="mesh"></div>
    <TransitionGroup enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-700 ease-smooth" leave-active-class="transition-opacity duration-700 ease-smooth">
      <!-- 미리 만든 그림(baked)은 이미 모드의 밝기 띠라 그대로 깐다. 못 만든 그림만 CSS 로 흐리고 면과 섞는다(밝기마다 진하기, 안쪽 칸에: 겹의 넘김 opacity 와 부딪히지 않게).
           흐린 그림만 가장자리가 비치지 않게 넘치게 깐다(봇 프사 avatar 는 옅게 흐려 딱 맞춘다) -->
      <div v-for="layer in layers" :key="layer.src" class="absolute" :class="layer.baked && layer.kind === 'avatar' ? 'inset-0' : 'inset-[-12%] scale-110'">
        <div class="absolute inset-0 bg-cover bg-center" :class="!layer.baked && ['blur-[72px] saturate-[1.6]', dark ? 'opacity-75' : 'opacity-60']" :style="{ backgroundImage: `url(&quot;${layer.src}&quot;)` }"></div>
      </div>
    </TransitionGroup>
    <div class="absolute inset-0 opacity-[0.035]" :style="grain"></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { dark, wallpaper } from "../theme/theme.ts";

const layers = computed(() => (wallpaper.value ? [wallpaper.value] : []));

// 모드마다 섞는 진하기. 앨범아트 배경의 밝기 띠(art.ts BAND)에 맞춘다: 어두운 모드는 너무 밝은 곳이 없게, 밝은 모드는 흰 면만 남지 않게
const MESH = { dark: [35, 28, 28], light: [55, 50, 45] };
const mesh = computed(() => {
  const [p, t, s] = dark.value ? MESH.dark : MESH.light;
  return {
    backgroundImage: [`radial-gradient(60% 50% at 12% 8%, color-mix(in oklab, var(--md-primary-container) ${p}%, transparent), transparent 70%)`, `radial-gradient(50% 45% at 92% 18%, color-mix(in oklab, var(--md-tertiary-container) ${t}%, transparent), transparent 70%)`, `radial-gradient(70% 60% at 70% 100%, color-mix(in oklab, var(--md-secondary-container) ${s}%, transparent), transparent 70%)`].join(", "),
  };
});

const grain = {
  backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>')}")`,
};
</script>
