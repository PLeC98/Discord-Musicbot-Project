<template>
  <!-- 접고 펴는 내용(v-if, v-show 요소 하나를 감싼다). 높이, 위아래 여백은 spring, 투명도는 effects.
       넘김을 인라인으로 걸어 움직임 줄이기의 전역 규칙이 그대로 막는다 -->
  <Transition @enter="grow" @after-enter="clear" @enter-cancelled="clear" @leave="shrink" @after-leave="clear" @leave-cancelled="clear">
    <slot />
  </Transition>
</template>

<script setup lang="ts">
const GROW = "height 460ms var(--ease-spring), padding 460ms var(--ease-spring), margin 460ms var(--ease-spring), opacity 250ms var(--ease-effects)";
const SHRINK = "height 460ms var(--ease-spring), padding 460ms var(--ease-spring), margin 460ms var(--ease-spring), opacity 160ms var(--ease-effects)";
const PROPS = ["overflow", "transition", "height", "paddingTop", "paddingBottom", "marginTop", "marginBottom", "opacity"] as const;

// 세로 flex 안이면 접힌 동안 부모의 gap 만큼 위로 당겨, 생기고 빠지는 순간 아래가 gap 만큼 튀지 않게 한다
function collapsed(el: HTMLElement): Partial<CSSStyleDeclaration> {
  const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
  const gap = parent && parent.display.includes("flex") && parent.flexDirection.startsWith("column") ? parseFloat(parent.rowGap) || 0 : 0;
  return { height: "0px", paddingTop: "0px", paddingBottom: "0px", marginTop: `${-gap}px`, marginBottom: "0px", opacity: "0" };
}

function grow(node: Element) {
  const el = node as HTMLElement;
  const style = getComputedStyle(el);
  const open = { height: `${el.offsetHeight}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, marginTop: style.marginTop, marginBottom: style.marginBottom, opacity: "1" };
  Object.assign(el.style, { overflow: "hidden", transition: "none", ...collapsed(el) });
  void el.offsetHeight;
  Object.assign(el.style, { transition: GROW, ...open });
}

function shrink(node: Element) {
  const el = node as HTMLElement;
  Object.assign(el.style, { overflow: "hidden", height: `${el.offsetHeight}px` });
  void el.offsetHeight;
  Object.assign(el.style, { transition: SHRINK, ...collapsed(el) });
}

function clear(node: Element) {
  const el = node as HTMLElement;
  for (const key of PROPS) el.style[key] = "";
}
</script>
