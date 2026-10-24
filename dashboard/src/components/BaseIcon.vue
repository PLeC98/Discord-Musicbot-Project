<template>
  <!-- 글꼴 기호가 아닌 것(DrawnIcon)은 그것을 그리는 컴포넌트로. 칸 · 크기 · 색은 같다 -->
  <SponsorBlockIcon v-if="name === 'sponsorblock'" :size="size" />
  <span v-else class="symbol shrink-0 align-[-0.18em]" :style="style" aria-hidden="true">{{ glyph }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import SponsorBlockIcon from "./SponsorBlockIcon.vue";
import { ICONS, type IconName } from "../icons.ts";

// Material Symbols Rounded(가변 글꼴). name 은 기호 이름(예: skip_next, check_circle) 그대로 쓴다. 따로 붙인 별명은 두지 않는다(진짜 기호 이름을 가리게 된다).
// 글꼴은 쓰는 기호만 담고(icons.ts, 더하려면 scripts/build-icon-font.ts) 이름 대신 그 코드포인트를 그린다. sponsorblock 은 글꼴이 아니라 방패 SVG(SponsorBlockIcon)
const props = withDefaults(defineProps<{ name: IconName; size?: number | string; fill?: boolean; weight?: number }>(), { size: 20, fill: false, weight: 450 });

// size 는 기본 글자 크기(16px)일 때의 px. rem 으로 그려 글자 크기를 키우면 같이 커진다
const style = computed(() => ({ fontSize: `${Number(props.size) / 16}rem`, "--fill": props.fill ? 1 : 0, "--wght": props.weight }));
const glyph = computed(() => (props.name === "sponsorblock" ? "" : String.fromCodePoint(ICONS[props.name])));
</script>
