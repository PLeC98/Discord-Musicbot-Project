<template>
  <!-- 음량 막대(M3 슬라이더). 숫자는 늘 두지 않고, 올리거나 끄는 동안 손잡이 위 말풍선에만 보인다(M3 값 표시) -->
  <span class="group/vol relative inline-flex">
    <input type="range" min="0" :max="VOLUME_MAX" step="1" :value="level" class="peer m3-slider w-full" :style="style" :disabled="disabled" aria-label="음량" @pointerdown="grab" @input="emit('input', valueOf($event))" @change="emit('change', valueOf($event))" />
    <!-- 손잡이(폭 4) 가운데에 맞춘다 -->
    <span
      v-if="bubble && !disabled"
      class="pointer-events-none absolute bottom-full mb-1 h-6 min-w-8 px-2 -translate-x-1/2 rounded-full bg-inverse-surface text-inverse-on-surface text-xs font-semibold nums flex items-center justify-center origin-bottom transition-[opacity,scale] duration-150 group-hover/vol:opacity-100 group-hover/vol:scale-100 peer-active:opacity-100 peer-active:scale-100 peer-focus-visible:opacity-100 peer-focus-visible:scale-100"
      :class="dragging ? 'opacity-100 scale-100' : 'opacity-0 scale-75'"
      :style="{ left: `calc(2px + (100% - 4px) * ${level / VOLUME_MAX})` }"
      aria-hidden="true"
      >{{ level }}</span
    >
  </span>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { valueOf } from "../utils/dom.ts";
import { VOLUME_MAX } from "../../../src/rules/limits.ts";

// level 은 보여 줄 음량. bubble 이 거짓이면 말풍선을 두지 않는다(숫자를 따로 보여 주는 자리). 트랙 4 · 손잡이 12(진행 막대와 같은 굵기)
const props = withDefaults(defineProps<{ level: number; disabled?: boolean; bubble?: boolean }>(), { disabled: false, bubble: true });
const emit = defineEmits<{ input: [value: string]; change: [value: string] }>();

// 끄는 동안(누른 손을 뗄 때까지). 터치로 끌면 브라우저가 :active 를 풀어 말풍선이 사라져서 직접 기억한다
const dragging = ref(false);
function release() {
  dragging.value = false;
  window.removeEventListener("pointerup", release);
  window.removeEventListener("pointercancel", release);
}
function grab() {
  dragging.value = true;
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
}
onUnmounted(release);

const style = computed(() => ({ "--v": props.level / VOLUME_MAX, "--track": "0.25rem", "--thumb-h": "0.75rem", "--gap": "4px" }));
</script>
