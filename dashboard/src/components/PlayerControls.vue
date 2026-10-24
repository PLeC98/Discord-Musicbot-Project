<template>
  <!-- 서버 화면의 조작 한 줄: [셔플] [이전] [재생] [다음] [반복]. spread 면 양끝까지 펼친다(좁은 창 · 휴대폰).
       한곡 반복 중에는 이전곡 · 다음곡 = 지금 곡 다시 시작이라 기록 · 대기열이 없어도 쓸 수 있다(utils/playback 의 규칙) -->
  <div class="flex items-center" :class="spread ? 'justify-between' : 'gap-2'">
    <button type="button" :class="[CTL_BTN, TOGGLE_BTN]" :aria-label="T.shuffle" v-tooltip="T.shuffle" :disabled="!shuffleEnabled(player) || busy('shuffle')" @click="emit('shuffle')"><Icon name="shuffle" :size="24" /></button>
    <button type="button" :class="[CTL_BTN, SIDE_BTN]" :aria-label="T.previous" v-tooltip="T.previous" :disabled="!previousEnabled(player) || busy('previous')" @click="emit('previous')"><Icon name="skip_previous" :size="32" fill /></button>
    <PlayButton :size-class="playSize" :running="running" :aria-label="T.playPause(running)" v-tooltip="T.playPause(running)" :disabled="!player.canControl || !player.currentTrack" @click="emit('pause')" />
    <button type="button" :class="[CTL_BTN, SIDE_BTN]" :aria-label="T.next" v-tooltip="T.next" :disabled="!skipEnabled(player) || busy('skip')" @click="emit('skip')"><Icon name="skip_next" :size="32" fill /></button>
    <button type="button" :class="[CTL_BTN, TOGGLE_BTN, player.loop && TOGGLE_ON]" :aria-label="loopTip(player)" v-tooltip="loopTip(player)" :disabled="!loopEnabled(player) || busy('loop')" @click="emit('loop')"><Icon :name="player.loop === 'track' ? 'repeat_one' : 'repeat'" :size="24" /><span v-if="player.loop" :class="TOGGLE_DOT"></span></button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Icon from "./BaseIcon.vue";
import PlayButton from "./PlayButton.vue";
import { loopEnabled, previousEnabled, shuffleEnabled, skipEnabled, type PlayerSeen } from "../utils/playback.ts";
import { loopTip } from "../utils/loop-tip.ts";
import { CTL_BTN, TOGGLE_BTN, TOGGLE_DOT, TOGGLE_ON } from "../utils/player-buttons.ts";
import { text } from "../text/index.ts";
const T = text.player;

// 이전 · 다음: 진한 색 48 · 아이콘 32(셔플 · 반복보다 한 단계 크게)
const SIDE_BTN = "size-12 text-on-surface hover:not-disabled:scale-105";

/** busy(조작 이름): 그 조작의 응답을 기다리는 중인지. playSize: 재생 버튼 크기(기본 64) */
const props = withDefaults(defineProps<{ player: PlayerSeen; busy: (key: string) => boolean; spread?: boolean; playSize?: string }>(), { spread: false, playSize: "size-16" });
const emit = defineEmits<{ shuffle: []; previous: []; pause: []; skip: []; loop: [] }>();

const running = computed(() => Boolean(props.player.currentTrack) && !props.player.paused);
</script>
