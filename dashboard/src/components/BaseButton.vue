<template>
  <component :is="href ? 'a' : 'button'" :href="href || undefined" :class="classes">
    <slot />
  </component>
</template>

<script setup lang="ts">
import { computed } from "vue";

// 공용 버튼(M3 Expressive). 알약 모양이고 누르는 동안 모서리가 줄어든다(모양 바뀜).
// primary = 채움 · secondary = 색조(tonal) · warning = 셋째 색(값을 치르는 일) · danger = 오류 색 · ghost = 테두리.
// href를 주면 <a>, 아니면 <button>으로 렌더된다
type Variant = "primary" | "secondary" | "warning" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

const props = withDefaults(defineProps<{ variant?: Variant; size?: Size; href?: string | null }>(), { variant: "primary", size: "md", href: null });

const base = "tap state-layer inline-flex items-center justify-center cursor-pointer font-medium no-underline select-none whitespace-nowrap " + "transition-[border-radius,scale,background-color,color] spring-fast active:not-disabled:rounded-md active:not-disabled:scale-97 " + "disabled:cursor-not-allowed disabled:bg-on-surface/10 disabled:text-on-surface/38 disabled:border-transparent disabled:shadow-none";

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 gap-1 rounded-2xl text-xs",
  md: "h-10 px-4 gap-2 rounded-[1.25rem] text-body",
  lg: "h-14 px-6 gap-2 rounded-2xl text-title w-full",
};

const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary",
  secondary: "bg-secondary-container text-on-secondary-container",
  warning: "bg-tertiary-container text-on-tertiary-container",
  danger: "bg-error text-on-error",
  ghost: "text-on-surface border border-outline-variant",
};

const classes = computed(() => `${base} ${sizes[props.size]} ${variants[props.variant]}`);
</script>
