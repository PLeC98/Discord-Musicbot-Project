<template>
  <!-- 지금 곡의 작은 배지: 출처(대표색 점), 라이브, 멈춘 까닭, 내가 넣은 곡. 배지의 inline-flex 가 hidden 을 이겨서 감출 때는 ! 로(mineClass) -->
  <span :class="CHIP"><span class="size-2 rounded-full" :style="{ backgroundColor: platformColor(track.platform) }"></span>{{ track.platformLabel }}</span>
  <span v-if="track.isLive" :class="[CHIP, 'bg-error! text-on-error!']"><Icon name="sensors" :size="14" />{{ T.live }}</span>
  <!-- 억제 사유(음소거, 발언자 기다림, 혼자 남음)로 소리가 멈췄다. 재생 버튼은 사람의 멈춤을 따라 일시정지로 보일 수 있어 까닭을 따로 보인다 -->
  <span v-if="heldMark" :class="[CHIP, 'bg-tertiary-container! text-on-tertiary-container!']"><Icon :name="heldMark.glyph" :size="14" />{{ heldMark.text }}</span>
  <span v-if="mine" :class="[CHIP, mineClass]"><Icon name="person" :size="14" fill />{{ T.mine }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Icon from "./BaseIcon.vue";
import { platformColor } from "../utils/platform-color.ts";
import { text } from "../text/index.ts";
import { ICONS } from "../../../src/ui/icons.ts";
import { pausedLabel } from "../../../src/ui/text/ko/panel.ts";
import type { Hold } from "../../../src/rules/holds.ts";
const T = text.player;

const CHIP = "h-6 px-3 rounded-full bg-surface-container-high text-xs font-semibold text-on-surface-variant inline-flex items-center gap-1 shrink-0";

/** mine: 내가 넣은 곡인지. mineClass: 그 배지에만 붙일 클래스(좁은 창에서 감추기 등). held: 소리를 멈추고 있는 억제 사유 */
const props = defineProps<{ track: { platform: string; platformLabel?: string; isLive?: boolean }; mine: boolean; mineClass?: string; held?: Hold | null }>();

// 패널 상태 줄과 같은 기호, 말
const heldMark = computed(() => {
  if (!props.held) return null;
  const { icon, text } = pausedLabel(props.held);
  return { glyph: ICONS[icon].glyph, text };
});
</script>
