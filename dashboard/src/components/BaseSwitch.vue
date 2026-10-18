<template>
  <!-- M3 스위치(아이콘 없는 모양). 글과 함께 쓰려면 <label> 안에 둔다(글을 눌러도 바뀐다).
       하나를 켜고 끄는 항목에 쓰고, 여럿 중 선택하는 목록은 체크박스로 둔다. 치수는 아래 <style> -->
  <span class="sw group/sw relative inline-flex shrink-0" :class="disabled ? 'opacity-38 cursor-not-allowed' : 'cursor-pointer'" :data-on="on || undefined" :data-live="!disabled || undefined">
    <input v-model="on" type="checkbox" role="switch" class="peer absolute inset-0 z-10 m-0 opacity-0 cursor-[inherit]" :disabled="disabled" :aria-label="label" />
    <span class="sw-track relative rounded-full border-2 transition-[background-color,border-color] duration-200 pointer-events-none peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary" :class="on ? 'bg-primary border-primary' : 'bg-surface-container-highest border-outline'">
      <span class="sw-handle absolute top-1/2 -translate-y-1/2 rounded-full transition-[left,width,height,background-color] spring-fast" :class="on ? 'bg-on-primary' : 'bg-outline'"></span>
    </span>
  </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ disabled?: boolean; label?: string }>(), { disabled: false, label: undefined });
const on = defineModel<boolean>({ default: false });
</script>

<style scoped>
/* 치수: M3 규격값(Compose SwitchTokens)에 배율 --switch-scale(style.css)을 곱하고 정수 px 로 반올림한다.
   크기(트랙 · 핸들)는 2px 단위(짝수라야 핸들이 트랙 가운데에 정확히 놓인다), 위치는 1px 단위.
   규격값: 트랙 52×32 · 테두리 2(굵기는 배율 없이), 핸들 꺼짐 16 · 켜짐 24 · 누르는 동안 28,
   핸들 가운데는 꺼짐 = 테두리 안쪽 왼쪽에서 12, 켜짐 = 테두리 안쪽 오른쪽에서 14(트랙 폭이 반올림돼도 오른쪽 틈이 규격대로), 올리면 둘레 40 원형 상태 표시 */
.sw {
  --sw-w: round(calc(3.25rem * var(--switch-scale)), 2px);
  --sw-h: round(calc(2rem * var(--switch-scale)), 2px);
  --hs: 16;
  --hc: round(calc(0.75rem * var(--switch-scale)), 1px);
}
.sw[data-on] {
  --hs: 24;
  --hc: calc(var(--sw-w) - 4px - round(calc(0.875rem * var(--switch-scale)), 1px));
}
.sw[data-live]:has(input:active) {
  --hs: 28;
}
.sw-track {
  width: var(--sw-w);
  height: var(--sw-h);
}
.sw-handle {
  --size: round(calc(var(--hs) * var(--switch-scale) * 0.0625rem), 2px);
  width: var(--size);
  height: var(--size);
  left: calc(var(--hc) - var(--size) / 2);
}
/* 상태 표시(올리면 8% · 누르면 10%, 켜짐은 primary · 꺼짐은 on-surface) */
.sw-handle::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: round(calc(2.5rem * var(--switch-scale)), 2px);
  height: round(calc(2.5rem * var(--switch-scale)), 2px);
  translate: -50% -50%;
  border-radius: 9999px;
  background: var(--md-on-surface);
  opacity: 0;
  transition: opacity 150ms;
}
.sw[data-on] .sw-handle::before {
  background: var(--md-primary);
}
.sw[data-live]:hover .sw-handle::before {
  opacity: 0.08;
}
.sw[data-live]:has(input:active) .sw-handle::before {
  opacity: 0.1;
}
/* 올리거나 누르면 핸들 색: 켜짐 primary-container · 꺼짐 on-surface-variant */
.sw[data-live]:is(:hover, :has(input:active)) .sw-handle {
  background: var(--md-on-surface-variant);
}
.sw[data-live][data-on]:is(:hover, :has(input:active)) .sw-handle {
  background: var(--md-primary-container);
}
</style>
