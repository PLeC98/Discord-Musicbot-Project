<template>
  <!-- 서버 화면의 하이라이트로 가기 · 정지(진행 줄 끝 · 휴대폰 아래 줄 · 좁은 창의 표 줄). 하이라이트는 곡에 있을 때만 -->
  <button v-if="highlight" type="button" :class="[BTN, size, 'bg-surface-container-high']" aria-label="하이라이트로 가기" v-tooltip="'하이라이트로 가기'" :disabled="!player.canControl || busy('highlight')" @click="emit('highlight')">
    <Icon name="keyboard_double_arrow_right" :size="iconSize" :style="{ color: 'var(--category-highlight-color)' }" />
  </button>
  <button type="button" :class="[BTN, size, 'text-error border border-error/40']" aria-label="정지" v-tooltip="'정지'" :disabled="!player.canControl || !player.hasPlayer || busy('stop')" @click="emit('stop')"><Icon name="stop" :size="iconSize" fill /></button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Icon from "./BaseIcon.vue";
import type { PlayerSeen } from "../utils/playback.ts";

// 둥근 버튼. 누르는 동안 모서리가 줄어든다
const BTN = "tap state-layer shrink-0 rounded-[50%] flex items-center justify-center cursor-pointer transition-[border-radius] spring-fast active:not-disabled:rounded-[30%] disabled:opacity-38 disabled:cursor-not-allowed";

/** highlight: 하이라이트 지점이 있는지. small: 32(좁은 창의 표 줄), 아니면 40 */
const props = withDefaults(defineProps<{ player: PlayerSeen; highlight: boolean; busy: (key: string) => boolean; small?: boolean }>(), { small: false });
const emit = defineEmits<{ highlight: []; stop: [] }>();

const size = computed(() => (props.small ? "size-8" : "size-10"));
const iconSize = computed(() => (props.small ? 20 : 24));
</script>
