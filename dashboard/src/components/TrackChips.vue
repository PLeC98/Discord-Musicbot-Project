<template>
  <!-- 지금 곡의 작은 표: 출처(대표색 점) · 라이브 · 내가 넣은 곡. 표의 inline-flex 가 hidden 을 이겨서 감출 때는 ! 로(mineClass) -->
  <span :class="CHIP"><span class="size-2 rounded-full" :style="{ backgroundColor: platformColor(track.platform) }"></span>{{ track.platformLabel }}</span>
  <span v-if="track.isLive" :class="[CHIP, 'bg-error! text-on-error!']"><Icon name="sensors" :size="14" />{{ T.live }}</span>
  <span v-if="mine" :class="[CHIP, mineClass]"><Icon name="person" :size="14" fill />{{ T.mine }}</span>
</template>

<script setup lang="ts">
import Icon from "./BaseIcon.vue";
import { platformColor } from "../utils/platform-color.ts";
import { text } from "../text/index.ts";
const T = text.player;

const CHIP = "h-6 px-3 rounded-full bg-surface-container-high text-xs font-semibold text-on-surface-variant inline-flex items-center gap-1 shrink-0";

/** mine: 내가 넣은 곡인지. mineClass: 그 표에만 붙일 클래스(좁은 창에서 감추기 등) */
defineProps<{ track: { platform: string; platformLabel?: string; isLive?: boolean }; mine: boolean; mineClass?: string }>();
</script>
