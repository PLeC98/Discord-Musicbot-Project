<template>
  <!-- 늘 뜨는 재생 바. 내가 있는 음성 채널에 봇이 있고 재생 중일 때만, 그 서버 화면이 아닐 때 뜬다(그 화면이 전체화면 역할).
       바탕화면 아래 가장자리에서 틀 색으로 자라 올라온 노치이고(양옆이 오목하게 가장자리와 이어진다, 휴대폰은 아래 막대와 한 덩어리),
       모양은 기존 재생 바 그대로: 곡 · [이전 · 재생 · 다음 / 진행] · 음량. 내용은 노치 밑으로 지나간다.
       태블릿 · PC 는 양옆을 바깥 틈 + 레일 + 창 사이 틈만큼 비운다. 오목 모서리(28 = 창 16 + 틈 12)가 레일 아래 모서리(16)와 같은 중심이 되어, 레일이 오목한 곳에 틈 12 로 끼워진다.
       노치가 32rem 보다 좁으면 안쪽을 줄인다(버튼 칸은 버튼 폭만, 시간 글자를 숨기고 아트를 줄인다). 그래도 24rem 밑으로는 줄이지 않는다.
       그보다 좁은 화면(사이드바를 펼친 좁은 창 등)에서는 노치가 레일 아래쪽에 겹친다 -->
  <Transition enter-from-class="translate-y-full" leave-to-class="translate-y-full" enter-active-class="transition-[translate] spring" leave-active-class="transition-[translate] duration-200">
    <div v-if="np.visible" class="absolute inset-x-0 bottom-0 z-30 flex justify-center pointer-events-none">
      <!-- 휴대폰 모양은 최대 폭 480(가로로 눕히면 21:9 화면에서 길쭉해졌다) -->
      <div data-dock class="pointer-events-auto relative w-[calc(100%-2*var(--cr))] max-w-120 md:max-w-none md:w-[max(min(24rem,calc(100%-2*var(--cr))),min(56rem,calc(100%-2*(var(--gap-out)+var(--rail)+var(--gap-in)))))] @container isolate rounded-t-(--r-window) [--cr:var(--r-desk)]">
        <!-- 막 · 뒤 흐림: 양옆 오목한 모서리까지 한 장(style.css dock-film) -->
        <span class="dock-film" aria-hidden="true"></span>
        <!-- ── 태블릿 · PC ── -->
        <div class="hidden md:grid items-center gap-2 h-18 pl-2 pr-4 grid-cols-[minmax(0,1.2fr)_auto_minmax(0,0.6fr)] @lg:pr-5 @lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,0.8fr)]">
          <button type="button" :class="metaBtn" v-tooltip="'이 서버 화면으로'" @click="openServer">
            <TrackArt :track="np.track" size-class="size-10 @lg:size-12 rounded-full" :icon-size="24" />
            <span class="min-w-0 text-left">
              <MarqueeText class="text-sm font-semibold" :class="np.track ? 'text-on-surface' : 'text-on-surface-variant'" :text="np.track ? songTitle(np.track.title) : '재생 중인 곡이 없어요'" />
              <MarqueeText class="text-xs text-on-surface-variant" :text="np.track?.artist || np.guild?.name || ''" />
            </span>
          </button>
          <div class="flex flex-col items-center gap-1 min-w-0">
            <div class="flex items-center gap-1">
              <button :class="toggleBtn" v-tooltip="'셔플'" :disabled="!shuffleEnabled(np.data) || np.isBusy('shuffle')" @click="np.shuffle()"><Icon name="shuffle" :size="20" /></button>
              <button :class="iconBtn" v-tooltip="'이전곡'" :disabled="!previousEnabled(np.data) || np.isBusy('previous')" @click="np.previous()"><Icon name="skip_previous" :size="24" fill /></button>
              <button :class="playBtn" v-tooltip="np.running ? '일시정지' : '재생'" :disabled="!np.canControl || !np.track" @click="np.togglePause()"><Icon :name="np.running ? 'pause' : 'play_arrow'" :size="24" fill /></button>
              <button :class="iconBtn" v-tooltip="'다음곡'" :disabled="!skipEnabled(np.data) || np.isBusy('skip')" @click="np.skip()"><Icon name="skip_next" :size="24" fill /></button>
              <button :class="[toggleBtn, np.data?.loop ? TOGGLE_ON : '']" v-tooltip="loopTip(np.data)" :disabled="!loopEnabled(np.data) || np.isBusy('loop')" @click="np.cycleLoop()"><Icon :name="np.data?.loop === 'track' ? 'repeat_one' : 'repeat'" :size="20" /><span v-if="np.data?.loop" :class="TOGGLE_DOT"></span></button>
            </div>
            <div class="flex items-center gap-2 w-full">
              <!-- 라이브의 경과 시간은 곡 안의 위치가 아니라 붙어 있은 시간이다. 표식으로 대신한다 -->
              <span :class="timeText">{{ np.track?.isLive ? "라이브" : formatDuration(shownTime) }}</span>
              <div ref="trackEl" class="flex-1 flex items-center touch-none" :class="seekable ? 'cursor-pointer' : ''" @pointerdown.prevent="seekBar.onPointerDown">
                <SeekTrack :value="progressPct" :rate="progressRate" :handle="seekable" :dragging="seekBar.dragging.value" :thick="4" :height="16" />
              </div>
              <span :class="timeText">{{ np.duration > 0 ? formatDuration(np.duration) : "--:--" }}</span>
            </div>
          </div>
          <div class="flex items-center justify-end gap-2 min-w-0">
            <span class="shrink-0 text-on-surface-variant flex"><VolumeIcon :level="volumeShown" :size="18" /></span>
            <VolumeSlider class="w-full max-w-28" :level="volumeShown" :disabled="!np.canControl" @input="volumeInput" @change="volumeChange" />
          </div>
        </div>

        <!-- ── 휴대폰 ── 버튼은 둘까지. 진행은 아래에 표시만 -->
        <div class="md:hidden flex items-center gap-1 h-14 pl-1 pr-2">
          <button type="button" :class="[metaBtn, 'flex-1']" @click="openServer">
            <TrackArt :track="np.track" size-class="size-10 rounded-full" :icon-size="20" />
            <span class="min-w-0 text-left">
              <MarqueeText class="text-sm font-semibold" :class="np.track ? 'text-on-surface' : 'text-on-surface-variant'" :text="np.track ? songTitle(np.track.title) : '재생 중인 곡이 없어요'" />
              <MarqueeText class="text-xs text-on-surface-variant" :text="np.track?.artist || np.guild?.name || ''" />
            </span>
          </button>
          <!-- 휴대폰 단추는 한 단계 작게(36 · 아이콘 20) -->
          <button :class="[playBtn, 'size-9!']" :disabled="!np.canControl || !np.track" :aria-label="np.running ? '일시정지' : '재생'" @click="np.togglePause()"><Icon :name="np.running ? 'pause' : 'play_arrow'" :size="20" fill /></button>
          <button :class="[iconBtn, 'size-9!']" :disabled="!skipEnabled(np.data) || np.isBusy('skip')" aria-label="다음곡" @click="np.skip()"><Icon name="skip_next" :size="20" fill /></button>
        </div>
        <div class="md:hidden absolute inset-x-1.5 bottom-1 h-0.5 rounded-full overflow-hidden bg-on-surface/15">
          <div class="h-full rounded-full bg-primary" :style="{ transform: `translateX(${progressPct - 100}%)` }"></div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { CTL_BTN, TOGGLE_BTN, TOGGLE_DOT, TOGGLE_ON } from "../utils/player-buttons.ts";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Icon from "../components/BaseIcon.vue";
import SeekTrack from "../components/SeekTrack.vue";
import TrackArt from "../components/TrackArt.vue";
import MarqueeText from "../components/MarqueeText.vue";
import VolumeIcon from "../components/VolumeIcon.vue";
import VolumeSlider from "../components/VolumeSlider.vue";
import { useVolumeControl } from "../composables/volume-control.ts";
import { useSeekBar } from "../composables/seek-bar.ts";
import { useNowPlayingStore } from "../stores/now-playing.ts";
import { art } from "../theme/theme.ts";
import { loopEnabled, previousEnabled, shuffleEnabled, skipEnabled } from "../utils/playback.ts";
import { loopTip } from "../utils/loop-tip.ts";
import { songTitle } from "../../../src/ui/text/ko/labels.ts";
import { formatDuration } from "../../../src/ui/format.ts";

const np = useNowPlayingStore();
const router = useRouter();
const route = useRoute();
const trackEl = ref<HTMLElement | null>(null);

// 끄는 동안 바로 틀고 끄는 값을 보여 준다(composables/volume-control)
const {
  shown: volumeShown,
  input: volumeInput,
  change: volumeChange,
} = useVolumeControl(
  computed(() => np.data?.volume),
  (level) => np.setVolume(level),
);

// 지금 보고 있는 서버 화면. 그 서버를 듣고 있으면 바가 숨는다(저장소는 라우터를 읽지 않는다)
// 주소의 서버 ID 만 보면 같은 서버의 설정 화면도 재생 화면으로 여겨, 바가 숨고 상태 갱신도 멈춘다
watch(
  () => (route.meta.playerPage ? route.params.guildId : null),
  (id) => (np.page = typeof id === "string" ? id : null),
  { immediate: true },
);

// 내가 듣는 곡이 화면 색 · 배경화면이 된다(서버 화면을 보고 있으면 그쪽이 앞선다, theme)
watch(
  () => np.track?.thumbnail ?? null,
  (url) => (art.listening = url),
  { immediate: true },
);

// 곡 · 빈 곳을 누르면 곡 링크가 아니라 그 서버 화면으로 간다(전체화면 대용)
function openServer() {
  if (np.guildId) void router.push(`/servers/${np.guildId}`);
}

// 탐색은 태블릿 · PC 만. 휴대폰 진행은 표시 전용이다
const seekable = computed(() => np.canControl && np.duration > 0 && !np.track?.isLive);
const seekBar = useSeekBar({
  el: trackEl,
  duration: () => np.duration,
  enabled: () => seekable.value,
  entry: () => np.track?.entry ?? null,
  send: (sec, entry) => np.seek(sec, entry),
});
const shownTime = computed(() => (seekBar.dragging.value ? seekBar.value.value : np.position));
const progressRate = computed(() => (np.running && np.duration > 0 && !np.track?.isLive && !seekBar.dragging.value ? 100 / np.duration : 0));
const progressPct = computed(() => (np.duration > 0 ? Math.min(100, (shownTime.value / np.duration) * 100) : 0));

onMounted(() => np.start());
onUnmounted(() => np.stop());

const metaBtn = "state-layer flex items-center gap-3 min-w-0 rounded-full p-1 pr-3 cursor-pointer";
// 이전 · 재생 · 다음은 셋 다 같은 40(구글 Media3 미니 플레이어처럼 같은 크기, 크기는 그 아트 대비 비율 48/56 에서), 아이콘 24.
// 셔플 · 반복(태블릿 · PC)도 40, 아이콘은 한 단계 작은 20 에 흐린 색. 모양은 서버 화면과 같이 스포티파이를 따른다
const iconBtn = `${CTL_BTN} size-10 text-on-surface hover:not-disabled:scale-105`;
const toggleBtn = `${CTL_BTN} ${TOGGLE_BTN}`;
const playBtn = "tap size-10 rounded-full flex items-center justify-center shrink-0 cursor-pointer bg-primary text-on-primary transition-[scale] duration-150 hover:not-disabled:scale-105 active:not-disabled:scale-95 disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:cursor-not-allowed";
const timeText = "hidden @lg:block w-10 shrink-0 text-center text-xs font-medium nums text-on-surface-variant";
</script>
