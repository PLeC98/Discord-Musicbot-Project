<template>
  <!-- 전역 재생 바. 내가 있는 음성 채널에 봇이 있고 재생 중일 때만 뜬다.
       재생 중인 서버의 화면에서는 숨는다(그 화면이 전체화면 역할). z는 드로어(150)보다 아래에 둔다.
       사이드바를 덮지 않고 그 옆(--rail)에서 시작한다. 사이드바 하단 계정 블록과 한 줄로 이어진다.
       레일 폭 전환이 300ms라 left도 같은 시간으로 따라간다. -->
  <div v-if="np.visible" class="fixed left-(--rail) right-0 bottom-0 z-130 h-(--player) border-t border-white/9 bg-[rgba(9,13,26,0.9)] backdrop-blur-2xl backdrop-saturate-[1.7] shadow-[0_-8px_32px_rgba(0,0,0,0.45)] transition-[left] duration-300 ease-smooth">
    <!-- ── 데스크탑 ── -->
    <div class="hidden md:grid h-full items-center gap-4 px-4 grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)_minmax(0,1fr)]">
      <button type="button" :class="metaBtn" v-tooltip="'이 서버 화면으로'" @click="openServer">
        <TrackArt :track="np.track" size-class="size-11" />
        <span class="min-w-0 text-left">
          <span class="block text-[0.85rem] font-semibold truncate" :class="np.track ? 'text-fg' : 'text-muted'">{{ np.track ? songTitle(np.track.title) : "재생 중인 곡이 없어요" }}</span>
          <span class="block text-[0.75rem] text-muted truncate">{{ np.track?.artist || np.guild?.name }}</span>
        </span>
      </button>

      <div class="flex flex-col items-center min-w-0 w-full pt-1">
        <div class="flex items-center gap-0.5">
          <button :class="iconBtn" v-tooltip="'이전곡'" :disabled="!previousEnabled(np.data) || np.busy.has('previous')" @click="np.previous()"><Icon name="prev" :size="17" /></button>
          <button :class="iconMain" v-tooltip="np.track && !np.data.paused ? '일시정지' : '재생'" :disabled="!np.canControl || !np.track" @click="np.togglePause()"><Icon :name="np.track && !np.data.paused ? 'pause' : 'play'" :size="19" /></button>
          <button :class="iconBtn" v-tooltip="'다음곡'" :disabled="!skipEnabled(np.data) || np.busy.has('skip')" @click="np.skip()"><Icon name="skip" :size="17" /></button>
        </div>

        <div class="flex items-center gap-2 w-full">
          <!-- 라이브의 경과 시간은 곡 안의 위치가 아니라 붙어 있은 시간이다. 표식으로 대신한다 -->
          <span :class="timeText">{{ np.track?.isLive ? "🔴 라이브" : formatDuration(shownTime) }}</span>
          <div ref="trackEl" class="group relative flex flex-1 h-3.5 items-center touch-none before:content-[''] before:absolute before:inset-x-0 before:h-1 before:rounded before:bg-white/12 before:pointer-events-none" :class="seekable ? 'cursor-pointer' : ''" @pointerdown.prevent="seekBar.onPointerDown">
            <div class="absolute left-0 h-1 rounded pointer-events-none bg-linear-90 from-accent to-accent-2" :class="seekBar.dragging.value ? '' : 'transition-[width] duration-400 ease-linear'" :style="{ width: progressPct + '%' }"></div>
            <div v-if="seekable" class="absolute top-1/2 size-2.5 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.45)] pointer-events-none -translate-x-1/2 -translate-y-1/2 transition-opacity duration-150" :class="seekBar.dragging.value ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'" :style="{ left: progressPct + '%' }"></div>
          </div>
          <!-- 길이를 모르면(라이브) 양쪽을 다 비워 둔다. 진행바 동그라미는 duration 0이라 이미 빠진다 -->
          <span :class="timeText">{{ np.duration > 0 ? formatDuration(np.duration) : "--:--" }}</span>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2">
        <VolumeIcon :level="volumeShown" :size="17" class="text-muted" />
        <input type="range" min="0" max="100" step="1" :value="volumeShown" :disabled="!np.canControl" class="w-30 h-1 accent-accent cursor-pointer rounded disabled:cursor-not-allowed disabled:opacity-40" v-tooltip="`볼륨: ${volumeShown}%`" @input="volumeInput($event.target.value)" @change="volumeChange($event.target.value)" />
      </div>
    </div>

    <!-- ── 모바일 ── 버튼은 둘까지. 진행바는 바 하단에 표시 전용으로 얇게(D-3, D-5) -->
    <div class="md:hidden flex h-full items-center gap-2 px-3">
      <button type="button" :class="[metaBtn, 'flex-1']" @click="openServer">
        <TrackArt :track="np.track" size-class="size-10" />
        <span class="min-w-0 text-left">
          <span class="block text-[0.82rem] font-semibold truncate" :class="np.track ? 'text-fg' : 'text-muted'">{{ np.track ? songTitle(np.track.title) : "재생 중인 곡이 없어요" }}</span>
          <span class="block text-[0.72rem] text-muted truncate">{{ np.track?.artist || np.guild?.name }}</span>
        </span>
      </button>
      <button :class="iconMain" :disabled="!np.canControl || !np.track" @click="np.togglePause()"><Icon :name="np.track && !np.data.paused ? 'pause' : 'play'" :size="19" /></button>
      <button :class="iconBtn" :disabled="!skipEnabled(np.data) || np.busy.has('skip')" @click="np.skip()"><Icon name="skip" :size="17" /></button>
    </div>

    <div class="md:hidden absolute inset-x-0 bottom-0 h-0.5 bg-white/12">
      <div class="h-full bg-linear-90 from-accent to-accent-2 transition-[width] duration-400 ease-linear" :style="{ width: progressPct + '%' }"></div>
    </div>
  </div>
</template>

<script setup>
import { songTitle } from "../../../src/ui/text/ko/labels.ts";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Icon from "./BaseIcon.vue";
import VolumeIcon from "./VolumeIcon.vue";
import { useVolumeControl } from "../composables/volume-control.ts";
import TrackArt from "./TrackArt.vue";
import { useNowPlayingStore } from "../stores/now-playing.ts";
import { formatDuration } from "../../../src/ui/format.ts";
import { previousEnabled, skipEnabled } from "../utils/playback.ts";
import { useSeekBar } from "../composables/seek-bar.ts";

const np = useNowPlayingStore();
// 끄는 동안 바로 틀고 끄는 값을 보여 준다(composables/volume-control)
const {
  shown: volumeShown,
  input: volumeInput,
  change: volumeChange,
} = useVolumeControl(
  computed(() => np.data?.volume),
  (level) => np.setVolume(level),
);
const router = useRouter();
const route = useRoute();
const trackEl = ref(null);

// 지금 보고 있는 서버 화면. 그 서버를 듣고 있으면 바가 숨는다(저장소는 라우터를 읽지 않는다)
watch(
  () => route.params.guildId,
  (id) => (np.page = typeof id === "string" ? id : null),
  { immediate: true },
);

// 버튼이 아닌 영역을 누르면 곡 링크가 아니라 그 서버 화면으로 간다(D-2. 전체화면 대용).
function openServer() {
  if (np.guildId) router.push(`/servers/${np.guildId}`);
}

// 탐색은 데스크탑만. 모바일 진행바는 표시 전용이라 핸들러가 붙지 않는다(D-5).
const seekable = computed(() => np.canControl && np.duration > 0 && !np.track?.isLive);
const seekBar = useSeekBar({
  el: trackEl,
  duration: () => np.duration,
  enabled: () => seekable.value,
  entry: () => np.track?.entry ?? null,
  send: (sec, entry) => np.seek(sec, entry),
});
const shownTime = computed(() => (seekBar.dragging.value ? seekBar.value.value : np.position));
const progressPct = computed(() => (np.duration > 0 ? Math.min(100, (shownTime.value / np.duration) * 100) : 0));

onMounted(() => np.start());
onUnmounted(() => np.stop());

const metaBtn = "flex items-center gap-3 min-w-0 rounded-xl cursor-pointer transition-[background-color] duration-200 hover:bg-white/6";
const iconBase = "size-9 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-[background-color,color,scale] duration-150 disabled:opacity-25 disabled:cursor-not-allowed active:not-disabled:scale-[0.88] active:not-disabled:duration-75";
const iconBtn = `${iconBase} text-[rgba(232,234,246,0.7)] hover:not-disabled:bg-white/11 hover:not-disabled:text-fg`;
const iconMain = `${iconBase} text-fg bg-white/10 hover:not-disabled:bg-white/17`;
const timeText = "text-muted text-[0.72rem] whitespace-nowrap tabular-nums shrink-0";
</script>
