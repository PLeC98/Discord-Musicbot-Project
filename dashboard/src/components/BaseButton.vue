<template>
  <component :is="href ? 'a' : 'button'" :href="href || undefined" :class="classes">
    <slot />
  </component>
</template>

<script setup lang="ts">
import { computed } from "vue";

// 공용 버튼(M3 Expressive). 알약 모양이고 누르는 동안 모서리가 줄어든다(모양 바뀜).
// 모서리는 높이의 절반을 rem 으로 적는다. 그보다 큰 단계는 브라우저가 절반으로 줄여 그려 누르는 순간의 변화가 늦게 보인다.
// primary = 채움, secondary = 색조(tonal), warning = 셋째 색(값을 치르는 일), danger = 오류 색, ghost = 테두리, text = 글자 버튼(바탕 없이 강조색 글).
// href를 주면 <a>, 아니면 <button>으로 렌더된다
type Variant = "primary" | "secondary" | "warning" | "danger" | "ghost" | "text";
type Size = "sm" | "md" | "lg";

const props = withDefaults(defineProps<{ variant?: Variant; size?: Size; href?: string | null }>(), { variant: "primary", size: "md", href: null });

const base = "tap state-layer inline-flex items-center justify-center cursor-pointer font-medium no-underline select-none whitespace-nowrap " + "motion-button active:not-disabled:rounded-md active:not-disabled:scale-97 " + "disabled:cursor-not-allowed disabled:text-on-surface/38";

const sizes: Record<Size, string> = {
  sm: "h-8 gap-1 rounded-[1rem] text-xs",
  md: "h-10 gap-2 rounded-xl text-body",
  lg: "h-14 gap-2 rounded-2xl text-title w-full",
};
// 좌우 여백. 글자 버튼은 M3 text button 대로 좁다
const pads: Record<Size, string> = { sm: "px-3", md: "px-4", lg: "px-6" };
const textPads: Record<Size, string> = { sm: "px-3", md: "px-3", lg: "px-4" };

// 비활성: 채운 것은 바탕 on-surface 10%, 테두리는 on-surface 12%, 글자 버튼은 바탕 없이 글자만 흐리게(M3)
const FILLED_OFF = "disabled:bg-on-surface/10";
const variants: Record<Variant, string> = {
  primary: `bg-primary text-on-primary ${FILLED_OFF}`,
  secondary: `bg-secondary-container text-on-secondary-container ${FILLED_OFF}`,
  warning: `bg-tertiary-container text-on-tertiary-container ${FILLED_OFF}`,
  danger: `bg-error text-on-error ${FILLED_OFF}`,
  ghost: "text-on-surface border border-outline-variant disabled:border-on-surface/12",
  text: "text-primary",
};

const classes = computed(() => `${base} ${sizes[props.size]} ${(props.variant === "text" ? textPads : pads)[props.size]} ${variants[props.variant]}`);
</script>
