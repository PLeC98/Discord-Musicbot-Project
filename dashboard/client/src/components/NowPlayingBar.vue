<template>
  <!-- 전역 재생 바 — 내가 있는 음성 채널에 봇이 있고 재생 중일 때만 뜬다.
       재생 중인 서버의 화면에서는 숨는다(그 화면이 전체화면 역할). z는 드로어(150)보다 아래에 둔다.
       사이드바를 덮지 않고 그 옆(--rail)에서 시작한다 — 사이드바 하단 계정 블록과 한 줄로 이어진다.
       레일 폭 전환이 300ms라 left도 같은 시간으로 따라간다. -->
  <div v-if="np.visible" class="fixed left-[var(--rail)] right-0 bottom-0 z-130 h-[var(--player)] border-t border-white/9 bg-[rgba(9,13,26,0.9)] backdrop-blur-2xl backdrop-saturate-[1.7] shadow-[0_-8px_32px_rgba(0,0,0,0.45)] transition-[left] duration-300 ease-smooth">
    <!-- ── 데스크탑 ── -->
    <div class="hidden md:grid h-full items-center gap-4 px-4 grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)_minmax(0,1fr)]">
      <button type="button" :class="metaBtn" v-tooltip="'이 서버 화면으로'" @click="openServer">
        <TrackArt :track="np.track" size-class="size-11" />
        <span class="min-w-0 text-left">
          <span class="block text-[0.85rem] font-semibold text-fg truncate">{{ np.track.title }}</span>
          <span class="block text-[0.75rem] text-muted truncate">{{ np.track.artist || np.guild?.name }}</span>
        </span>
      </button>

      <div class="flex flex-col items-center gap-1 min-w-0 w-full">
        <div class="flex items-center gap-0.5">
          <button :class="iconBtn" v-tooltip="'이전곡'" :disabled="!np.canControl || !(np.data.hasPrevious || np.data.loop === 'track')" @click="np.action('previous')"><Icon name="prev" :size="17" /></button>
          <button :class="iconMain" v-tooltip="np.data.paused ? '재생' : '일시정지'" :disabled="!np.canControl" @click="np.action('pause')"><Icon :name="np.data.paused ? 'play' : 'pause'" :size="19" /></button>
          <button :class="iconBtn" v-tooltip="'다음곡'" :disabled="!np.canSkip || (np.data.queue.length === 0 && np.data.loop !== 'track')" @click="np.action('skip')"><Icon name="skip" :size="17" /></button>
        </div>

        <div class="flex items-center gap-2 w-full">
          <span :class="timeText">{{ fmtTime(np.localTime) }}</span>
          <div ref="trackEl" class="group relative flex flex-1 h-3.5 items-center before:content-[''] before:absolute before:inset-x-0 before:h-1 before:rounded before:bg-white/12 before:pointer-events-none" :class="np.canControl && np.duration > 0 ? 'cursor-pointer' : ''" @pointerdown.prevent="onScrubStart">
            <div class="absolute left-0 h-1 rounded pointer-events-none bg-linear-90 from-accent to-accent-2" :class="np.scrubbing ? '' : 'transition-[width] duration-400 ease-linear'" :style="{ width: np.progressPct + '%' }"></div>
            <div v-if="np.canControl && np.duration > 0" class="absolute top-1/2 size-2.5 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.45)] pointer-events-none -translate-x-1/2 -translate-y-1/2 transition-opacity duration-150" :class="np.scrubbing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'" :style="{ left: np.progressPct + '%' }"></div>
          </div>
          <span :class="timeText">{{ fmtTime(np.duration) }}</span>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2">
        <Icon name="volume" :size="17" class="text-muted shrink-0" />
        <input type="range" min="0" max="100" step="5" :value="np.data.volume" :disabled="!np.canControl" class="w-24 h-1 accent-accent cursor-pointer rounded disabled:cursor-not-allowed disabled:opacity-40" v-tooltip="`볼륨: ${np.data.volume}%`" @change="np.setVolume($event.target.value)" />
      </div>
    </div>

    <!-- ── 모바일 ── 버튼은 둘까지. 진행바는 바 하단에 표시 전용으로 얇게(D-3, D-5) -->
    <div class="md:hidden flex h-full items-center gap-2 px-3">
      <button type="button" :class="[metaBtn, 'flex-1']" @click="openServer">
        <TrackArt :track="np.track" size-class="size-10" />
        <span class="min-w-0 text-left">
          <span class="block text-[0.82rem] font-semibold text-fg truncate">{{ np.track.title }}</span>
          <span class="block text-[0.72rem] text-muted truncate">{{ np.track.artist || np.guild?.name }}</span>
        </span>
      </button>
      <button :class="iconMain" :disabled="!np.canControl" @click="np.action('pause')"><Icon :name="np.data.paused ? 'play' : 'pause'" :size="19" /></button>
      <button :class="iconBtn" :disabled="!np.canSkip || (np.data.queue.length === 0 && np.data.loop !== 'track')" @click="np.action('skip')"><Icon name="skip" :size="17" /></button>
    </div>

    <div class="md:hidden absolute inset-x-0 bottom-0 h-0.5 bg-white/12">
      <div class="h-full bg-linear-90 from-accent to-accent-2 transition-[width] duration-400 ease-linear" :style="{ width: np.progressPct + '%' }"></div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import Icon from "./BaseIcon.vue";
import TrackArt from "./TrackArt.vue";
import { useNowPlayingStore } from "../stores/nowPlaying.js";
import { fmtTime } from "../utils/time.js";

const np = useNowPlayingStore();
const router = useRouter();
const trackEl = ref(null);

// 버튼이 아닌 영역을 누르면 곡 링크가 아니라 그 서버 화면으로 간다(D-2 — 전체화면 대용).
function openServer() {
  if (np.guildId) router.push(`/servers/${np.guildId}`);
}

// 스크럽은 데스크탑만 — 모바일 진행바는 표시 전용이라 여기 핸들러가 붙지 않는다(D-5).
function onScrubMove(e) {
  const rect = trackEl.value?.getBoundingClientRect();
  if (!rect || !rect.width) return;
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  np.localTime = Math.round(ratio * np.duration);
}

function onScrubEnd() {
  window.removeEventListener("pointermove", onScrubMove);
  np.scrubbing = false;
  np.seek(np.localTime);
}

function onScrubStart(e) {
  if (!np.canControl || np.duration <= 0) return;
  np.scrubbing = true;
  onScrubMove(e);
  window.addEventListener("pointermove", onScrubMove);
  window.addEventListener("pointerup", onScrubEnd, { once: true });
}

onMounted(() => np.start());
onUnmounted(() => {
  window.removeEventListener("pointermove", onScrubMove);
  np.stop();
});

const metaBtn = "flex items-center gap-3 min-w-0 rounded-xl p-1 cursor-pointer transition-[background-color] duration-200 hover:bg-white/6";
const iconBase = "size-9 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-[background-color,color,scale] duration-150 disabled:opacity-25 disabled:cursor-not-allowed active:not-disabled:scale-[0.88] active:not-disabled:duration-75";
const iconBtn = `${iconBase} text-[rgba(232,234,246,0.7)] hover:not-disabled:bg-white/11 hover:not-disabled:text-fg`;
const iconMain = `${iconBase} text-fg bg-white/10 hover:not-disabled:bg-white/17`;
const timeText = "text-muted text-[0.72rem] whitespace-nowrap tabular-nums shrink-0";
</script>
