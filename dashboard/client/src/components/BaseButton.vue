<template>
  <component :is="href ? 'a' : 'button'" :href="href || undefined" :class="classes">
    <slot />
  </component>
</template>

<script setup>
import { computed } from "vue";

// 공용 버튼 — 구 .btn/.btn-primary/.btn-danger/.btn-ghost (M3 Expressive).
// href를 주면 <a>, 아니면 <button>으로 렌더된다. 크기 변형은 size prop으로.
const props = defineProps({
  variant: { type: String, default: "primary" }, // primary | danger | ghost
  size: { type: String, default: "md" }, // sm | md | lg
  href: { type: String, default: null },
});

const base =
  "inline-flex items-center gap-1.5 rounded-xl cursor-pointer font-semibold tracking-[-0.01em] no-underline " +
  "transition-[transform,box-shadow] duration-[350ms] ease-spring " +
  "hover:not-disabled:scale-[1.02] active:not-disabled:scale-[0.96] active:not-disabled:duration-75 " +
  "disabled:opacity-40 disabled:cursor-not-allowed";

const sizes = {
  sm: "px-2.5 py-1 text-[0.8rem]",
  md: "px-5 py-[9px] text-sm",
  lg: "px-6 py-3 text-[0.95rem] rounded-[14px] w-full justify-center",
};

const variants = {
  primary: "text-white bg-linear-135 from-accent to-accent-2 shadow-[0_4px_18px_var(--accent-glow)] hover:not-disabled:shadow-[0_8px_32px_var(--accent-glow),0_0_0_1px_rgba(255,255,255,0.1)]",
  danger: "text-white bg-linear-135 from-[#f87171] to-[#ef4444] shadow-[0_4px_18px_rgba(248,113,113,0.34)] hover:not-disabled:shadow-[0_8px_32px_rgba(248,113,113,0.45)]",
  ghost: "text-fg bg-white/6 border border-line hover:not-disabled:bg-white/10",
};

const classes = computed(() => `${base} ${sizes[props.size]} ${variants[props.variant]}`);
</script>
