<template>
  <span class="symbol shrink-0 align-[-0.18em]" :style="style" aria-hidden="true">{{ name }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";

// Material Symbols Rounded(가변 글꼴). name 은 기호 이름(예: skip_next, check_circle) 그대로 쓴다. 따로 붙인 별명은 두지 않는다(진짜 기호 이름을 가리게 된다)
const props = withDefaults(defineProps<{ name: string; size?: number | string; fill?: boolean; weight?: number }>(), { size: 20, fill: false, weight: 450 });

// size 는 기본 글자 크기(16px)일 때의 px. rem 으로 그려 글자 크기를 키우면 같이 커진다
const style = computed(() => ({ fontSize: `${Number(props.size) / 16}rem`, "--fill": props.fill ? 1 : 0, "--wght": props.weight }));
</script>
