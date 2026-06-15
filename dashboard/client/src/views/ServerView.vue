<template>
  <div class="page">
    <div class="back-row">
      <router-link to="/servers" class="back-link">← 서버 목록</router-link>
    </div>

    <div v-if="loading" class="loading">불러오는 중...</div>

    <template v-else>
      <!-- ── Now Playing ── -->
      <div class="card now-playing-card">
        <div class="card-title">지금 재생 중</div>

        <template v-if="player.currentTrack">
          <!-- Thumbnail + title/artist -->
          <div class="track-row">
            <img v-if="player.currentTrack.thumbnail" :src="player.currentTrack.thumbnail" class="track-thumb" />
            <div class="track-meta-block">
              <a :href="player.currentTrack.url" target="_blank" rel="noopener" class="track-title">
                {{ player.currentTrack.title }}
              </a>
              <div class="track-artist" v-if="player.currentTrack.artist">{{ player.currentTrack.artist }}</div>
            </div>
          </div>

          <!-- Full-width progress bar -->
          <div class="progress-row">
            <span class="time-text">{{ fmt(displayTime) }}</span>
            <div class="progress-bar" ref="progressBarRef" :class="{ 'is-scrubbing': isScrubbing }" @mousedown.prevent="onScrubStart" @touchstart.prevent="onScrubStart">
              <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
              <div class="progress-handle" :style="{ left: progressPct + '%' }"></div>
            </div>
            <span class="time-text">{{ fmt(player.currentTrack.duration) }}</span>
          </div>

          <!-- Controls -->
          <div class="controls">
            <div class="ctrl-row">
              <!-- Previous -->
              <button class="icon-btn" @click="action('previous')" title="이전곡" :disabled="!player.hasPrevious">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
              </button>

              <!-- Play / Pause -->
              <button class="icon-btn" @click="action('pause')" :title="player.paused ? '재생' : '일시정지'">
                <svg v-if="player.paused" width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                <svg v-else width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
              </button>

              <!-- Stop -->
              <button class="icon-btn btn-stop" @click="confirmStop" title="정지">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5" /></svg>
              </button>

              <!-- Skip -->
              <button class="icon-btn" @click="action('skip')" title="다음곡" :disabled="player.queue.length === 0">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
              </button>

              <!-- Volume: capsule hover-expand -->
              <div class="vol-wrap">
                <button class="icon-btn vol-btn" :title="`볼륨: ${player.volume}%`">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
                </button>
                <div class="vol-popup">
                  <input type="range" min="0" max="100" step="5" :value="player.volume" @change="setVolume($event.target.value)" class="vol-slider" />
                  <span class="vol-num">{{ player.volume }}%</span>
                </div>
              </div>

              <div class="ctrl-sep"></div>

              <!-- Shuffle -->
              <button class="icon-btn" :class="player.shuffle ? 'btn-active' : ''" @click="action('shuffle')" title="셔플" :disabled="player.queue.length < 2">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" /></svg>
              </button>

              <!-- Loop (cycles: off → track → queue) -->
              <button class="icon-btn" :class="player.loop ? 'btn-active' : ''" @click="cycleLoop" :title="loopTitle">
                <svg v-if="player.loop === 'track'" width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 2 1 1 1-1v4h1z" />
                </svg>
                <svg v-else width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
                </svg>
              </button>
            </div>
          </div>
        </template>

        <div v-else class="no-track">⏸ 현재 재생 중인 곡이 없습니다</div>
      </div>

      <!-- ── Add Track ── -->
      <div class="card add-card">
        <div class="card-title">곡 추가 - 캐시되지 않은 곡은 추가하는데에 조금 시간이 걸려요.</div>

        <!-- Case 1: both offline -->
        <div v-if="!player.botInVoice && !player.userInVoice" class="add-notice">사용자가 음성 채널에 있어야 봇을 음성 채널에 참가시킬 수 있고, 봇이 음성 채널에 있어야 곡을 추가할 수 있어요. 먼저 Discord에서 음성 채널에 참가해 주세요.</div>

        <!-- Case 2: user in voice, bot not -->
        <div v-else-if="!player.botInVoice && player.userInVoice" class="add-notice add-notice-join">
          <span>봇이 음성 채널에 있어야 곡을 추가할 수 있어요. 지금 참가중인 채널에 봇을 참가시킬까요?</span>
          <button class="btn btn-primary btn-join" @click="joinBot" :disabled="joining">
            {{ joining ? "참가 중..." : "+ 참가" }}
          </button>
        </div>

        <!-- Case 3: bot in voice → show add form -->
        <form v-else class="add-form" @submit.prevent="addTrack">
          <input v-model="addQuery" class="add-input" placeholder="곡 이름, YouTube/Spotify/SoundCloud URL..." :disabled="adding" />
          <button type="submit" class="btn btn-primary" :disabled="adding || !addQuery.trim()">
            {{ adding ? "추가 중..." : "+ 추가" }}
          </button>
        </form>

        <div v-if="addError" class="add-error">{{ addError }}</div>
      </div>

      <!-- ── Queue ── -->
      <div class="card" v-if="player.queue?.length > 0">
        <div class="card-title">대기열 ({{ player.queue.length }}곡)</div>
        <div class="queue-list">
          <div
            v-for="(track, i) in player.queue"
            :key="i"
            class="queue-item"
            :class="{
              'is-dragging': draggedIndex === i,
              'drop-before': dragOverIndex === i && draggedIndex !== i,
              'drop-after': dragOverIndex === player.queue.length && i === player.queue.length - 1,
            }"
            draggable="true"
            @dragstart="onDragStart($event, i)"
            @dragover.prevent="onDragOver($event, i)"
            @drop.prevent="onDrop"
            @dragend="onDragEnd"
          >
            <span class="q-handle" title="드래그하여 순서 변경">
              <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                <circle cx="2" cy="3" r="1.5" />
                <circle cx="2" cy="8" r="1.5" />
                <circle cx="2" cy="13" r="1.5" />
                <circle cx="8" cy="3" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="8" cy="13" r="1.5" />
              </svg>
            </span>
            <span class="q-num">{{ i + 1 }}</span>
            <img v-if="track.thumbnail" :src="track.thumbnail" class="q-thumb" />
            <div class="q-info">
              <div class="q-title">{{ track.title }}</div>
              <div class="q-sub">
                <span v-if="track.artist">{{ track.artist }} &bull; </span>
                <span>{{ fmt(track.duration) }}</span>
              </div>
            </div>
            <span class="q-platform">{{ platformIcon(track.platform) }}</span>
            <button class="q-remove" @click="removeTrack(i)" title="제거">✕</button>
          </div>
        </div>
      </div>
    </template>

    <!-- Stop confirm dialog -->
    <div v-if="showStopConfirm" class="overlay" @click.self="showStopConfirm = false">
      <div class="dialog">
        <p>재생을 완전히 중지하고 대기열을 비울까요?</p>
        <div class="dialog-btns">
          <button class="btn btn-ghost" @click="showStopConfirm = false">취소</button>
          <button class="btn btn-danger" @click="doStop">중지</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import axios from "axios";

const route = useRoute();
const guildId = route.params.guildId;
const loading = ref(true);
const player = ref({ playing: false, paused: false, queue: [], currentTrack: null, volume: 100, loop: false, shuffle: false, botInVoice: false, userInVoice: false, hasPrevious: false });

const addQuery = ref("");
const adding = ref(false);
const addError = ref("");
const joining = ref(false);
const showStopConfirm = ref(false);

// Drag-and-drop queue reorder state
const draggedIndex = ref(null);
const dragOverIndex = ref(null);
const isDragging = ref(false);

let timer = null;
let progressTimer = null;
const localTime = ref(0);
const progressBarRef = ref(null);
const isScrubbing = ref(false);
const scrubTime = ref(0);

// ── Data ──────────────────────────────────────────────────────────────────────

// Action responses come from playerState() which omits botInVoice/userInVoice.
// Preserve those fields from the last full refresh so the add-notice doesn't flash.
function applyState(data) {
  player.value = { botInVoice: player.value.botInVoice, userInVoice: player.value.userInVoice, ...data };
}

async function refresh() {
  if (isDragging.value) return; // don't overwrite queue while user is mid-drag
  try {
    const res = await axios.get(`/api/guilds/${guildId}/player`);
    player.value = res.data;
    localTime.value = res.data.currentTrack?.currentTime ?? 0;
  } finally {
    loading.value = false;
  }
}

// ── Controls ─────────────────────────────────────────────────────────────────

async function action(type) {
  try {
    const res = await axios.post(`/api/guilds/${guildId}/player/${type}`);
    if (res.data && res.data.playing !== undefined) applyState(res.data);
  } catch (e) {
    console.error(type, e.response?.data || e.message);
  }
}

async function setVolume(vol) {
  try {
    const res = await axios.post(`/api/guilds/${guildId}/player/volume`, { volume: parseInt(vol) });
    if (res.data?.volume !== undefined) applyState(res.data);
  } catch (e) {
    console.error("volume", e);
  }
}

async function setLoop(mode) {
  try {
    const res = await axios.post(`/api/guilds/${guildId}/player/loop`, { mode });
    if (res.data?.playing !== undefined) applyState(res.data);
  } catch (e) {
    console.error("loop", e);
  }
}

function cycleLoop() {
  const cur = player.value.loop;
  if (!cur || cur === false || cur === "off") setLoop("track");
  else if (cur === "track") setLoop("queue");
  else setLoop("off");
}

function confirmStop() {
  showStopConfirm.value = true;
}

async function doStop() {
  showStopConfirm.value = false;
  try {
    await axios.post(`/api/guilds/${guildId}/player/stop`);
    player.value = { ...player.value, playing: false, paused: false, queue: [], currentTrack: null, volume: 100, loop: false, shuffle: false };
  } catch (e) {
    console.error("stop", e);
  }
}

async function addTrack() {
  if (!addQuery.value.trim() || adding.value) return;
  adding.value = true;
  addError.value = "";
  try {
    const res = await axios.post(`/api/guilds/${guildId}/player/queue`, { query: addQuery.value });
    applyState(res.data);
    addQuery.value = "";
  } catch (e) {
    addError.value = e.response?.data?.error || "추가에 실패했습니다.";
  } finally {
    adding.value = false;
  }
}

async function joinBot() {
  if (joining.value) return;
  joining.value = true;
  addError.value = "";
  try {
    const res = await axios.post(`/api/guilds/${guildId}/player/join`);
    applyState(res.data);
  } catch (e) {
    addError.value = e.response?.data?.error || "참가에 실패했습니다.";
  } finally {
    joining.value = false;
  }
}

async function removeTrack(index) {
  try {
    const res = await axios.delete(`/api/guilds/${guildId}/player/queue/${index}`);
    applyState(res.data);
  } catch (e) {
    console.error("remove", e);
  }
}

// ── Drag-and-drop queue reorder ───────────────────────────────────────────────

function onDragStart(e, i) {
  draggedIndex.value = i;
  isDragging.value = true;
  e.dataTransfer.effectAllowed = "move";
}

function onDragOver(e, i) {
  const rect = e.currentTarget.getBoundingClientRect();
  dragOverIndex.value = e.clientY < rect.top + rect.height / 2 ? i : i + 1;
}

function onDragEnd() {
  draggedIndex.value = null;
  dragOverIndex.value = null;
  isDragging.value = false;
}

async function onDrop() {
  const from = draggedIndex.value;
  const insertAt = dragOverIndex.value;
  onDragEnd();

  if (from === null || insertAt === null) return;

  // insertAt is the target slot; adjust for the removal of the dragged item
  const to = insertAt > from ? insertAt - 1 : insertAt;
  if (from === to) return;

  // Optimistic update — reorder local queue immediately for responsive feel
  const q = [...player.value.queue];
  const [moved] = q.splice(from, 1);
  q.splice(to, 0, moved);
  player.value = { ...player.value, queue: q };

  try {
    const res = await axios.post(`/api/guilds/${guildId}/player/queue/move`, { from, to });
    applyState(res.data);
  } catch (e) {
    console.error("queue move", e);
    await refresh(); // revert to server state on failure
  }
}

// ── Computed ──────────────────────────────────────────────────────────────────

const displayTime = computed(() => (isScrubbing.value ? scrubTime.value : localTime.value));

const progressPct = computed(() => {
  const t = player.value.currentTrack;
  if (!t?.duration) return 0;
  return Math.min((displayTime.value / t.duration) * 100, 100);
});

const loopTitle = computed(() => {
  const l = player.value.loop;
  if (l === "track") return "트랙 반복 중 (클릭: 큐 반복)";
  if (l === "queue") return "큐 반복 중 (클릭: 반복 끄기)";
  return "반복 끄기 (클릭: 트랙 반복)";
});

// ── Seek / scrub ─────────────────────────────────────────────────────────────

function getTimeFromPointer(e) {
  const bar = progressBarRef.value;
  if (!bar) return 0;
  const rect = bar.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return pct * (player.value.currentTrack?.duration ?? 0);
}

function onScrubStart(e) {
  if (!player.value.currentTrack) return;
  isScrubbing.value = true;
  scrubTime.value = getTimeFromPointer(e);
  document.addEventListener("mousemove", onScrubMove);
  document.addEventListener("mouseup", onScrubEnd);
  document.addEventListener("touchmove", onScrubMove, { passive: false });
  document.addEventListener("touchend", onScrubEnd);
}

function onScrubMove(e) {
  if (e.cancelable) e.preventDefault();
  scrubTime.value = getTimeFromPointer(e);
}

async function onScrubEnd() {
  if (!isScrubbing.value) return;
  isScrubbing.value = false;
  document.removeEventListener("mousemove", onScrubMove);
  document.removeEventListener("mouseup", onScrubEnd);
  document.removeEventListener("touchmove", onScrubMove);
  document.removeEventListener("touchend", onScrubEnd);
  const pos = scrubTime.value;
  localTime.value = pos;
  try {
    await axios.post(`/api/guilds/${guildId}/player/seek`, { position: pos });
  } catch (e) {
    console.error("seek", e);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(sec) {
  if (!sec && sec !== 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function platformIcon(p) {
  return { youtube: "🔴", spotify: "🟢", soundcloud: "🟠", direct: "🔗" }[p] || "🎵";
}

onMounted(() => {
  refresh();
  timer = setInterval(refresh, 5000);
  progressTimer = setInterval(() => {
    const track = player.value.currentTrack;
    if (track && !player.value.paused) {
      localTime.value = Math.min(localTime.value + 1, track.duration);
    }
  }, 1000);
});
onUnmounted(() => {
  clearInterval(timer);
  clearInterval(progressTimer);
  document.removeEventListener("mousemove", onScrubMove);
  document.removeEventListener("mouseup", onScrubEnd);
  document.removeEventListener("touchmove", onScrubMove);
  document.removeEventListener("touchend", onScrubEnd);
});
</script>

<style scoped>
.back-row {
  margin-bottom: 20px;
}

.back-link {
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.875rem;
  padding: 5px 10px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition:
    color 0.2s,
    background 0.2s;
}
.back-link:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.06);
}

.now-playing-card {
  margin-bottom: 12px;
  padding: 20px 20px 15px 20px;
}
.add-card {
  margin-bottom: 12px;
}

/* Track info */
.track-row {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 18px;
}

.track-thumb {
  width: auto;
  height: 150px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
}

.track-meta-block {
  flex: 1;
  overflow: hidden;
  padding-top: 2px;
}

.track-title {
  display: block;
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--text-primary);
  text-decoration: none;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.01em;
}
.track-title:hover {
  text-decoration: underline;
}

.track-artist {
  color: var(--text-muted);
  font-size: 0.875rem;
  margin-bottom: 12px;
}

/* Progress bar */
.progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.time-text {
  color: var(--text-muted);
  font-size: 0.78rem;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.progress-bar {
  flex: 1;
  height: 16px;
  display: flex;
  align-items: center;
  position: relative;
  cursor: pointer;
}

.progress-bar::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  pointer-events: none;
}

.progress-fill {
  position: absolute;
  left: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  border-radius: 4px;
  transition: width 0.4s linear;
  box-shadow: 0 0 8px rgba(124, 111, 246, 0.55);
  pointer-events: none;
}

.progress-bar.is-scrubbing .progress-fill {
  transition: none;
}

.progress-handle {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.15s,
    transform 0.15s,
    left 0.4s linear;
}

.progress-bar:hover .progress-handle,
.progress-bar.is-scrubbing .progress-handle {
  opacity: 1;
}

.progress-bar.is-scrubbing .progress-handle {
  transform: translate(-50%, -50%) scale(1.2);
  transition:
    opacity 0.15s,
    transform 0.15s;
}

/* Controls */
.controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ctrl-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.ctrl-sep {
  flex: 1;
}

/* Icon buttons */
.icon-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: rgba(232, 234, 246, 0.7);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition:
    background 0.18s var(--ease-out),
    color 0.18s,
    transform 0.15s;
}
.icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.11);
  color: var(--text-primary);
}
.icon-btn:active:not(:disabled) {
  background: rgba(255, 255, 255, 0.17);
  transform: scale(0.88);
  transition-duration: 0.07s;
}
.icon-btn:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

.icon-btn.btn-stop:hover:not(:disabled) {
  background: rgba(248, 113, 113, 0.18);
  color: #fca5a5;
}
.icon-btn.btn-stop:active:not(:disabled) {
  background: rgba(248, 113, 113, 0.26);
}

.icon-btn.btn-active {
  color: #c4b5fd;
}
.icon-btn.btn-active:hover:not(:disabled) {
  background: rgba(124, 111, 246, 0.2);
  color: #ddd6fe;
}

/* Volume capsule */
.vol-wrap {
  display: flex;
  align-items: center;
  height: 40px;
  border-radius: 20px;
  overflow: hidden;
  transition: background 0.2s var(--ease-out);
}
.vol-wrap:hover,
.vol-wrap:focus-within {
  background: rgba(255, 255, 255, 0.09);
}

.vol-wrap .icon-btn:hover,
.vol-wrap .icon-btn:active {
  background: transparent;
  transform: none;
  color: var(--text-primary);
}

.vol-popup {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 0;
  overflow: hidden;
  opacity: 0;
  transition:
    max-width 0.3s var(--ease-out),
    opacity 0.2s;
  white-space: nowrap;
}
.vol-wrap:hover .vol-popup,
.vol-wrap:focus-within .vol-popup {
  max-width: 160px;
  opacity: 1;
}

.vol-slider {
  width: 96px;
  height: 4px;
  accent-color: var(--accent);
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
}
.vol-num {
  color: var(--text-muted);
  font-size: 0.76rem;
  min-width: 28px;
  padding-right: 10px;
  font-variant-numeric: tabular-nums;
}

/* No track */
.no-track {
  text-align: center;
  padding: 20px;
  color: var(--text-muted);
  font-size: 0.9rem;
}

/* Add track */
.add-notice {
  color: var(--text-muted);
  font-size: 0.875rem;
}

.add-notice-join {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: space-between;
}

.btn-join {
  white-space: nowrap;
  flex-shrink: 0;
}

.add-form {
  display: flex;
  gap: 8px;
}

.add-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 10px;
  color: var(--text-primary);
  padding: 9px 14px;
  font-size: 0.9rem;
  outline: none;
  font-family: inherit;
  transition:
    border-color 0.2s,
    background 0.2s;
}
.add-input:focus {
  border-color: rgba(124, 111, 246, 0.55);
  background: rgba(255, 255, 255, 0.08);
}

.add-error {
  margin-top: 8px;
  color: var(--danger);
  font-size: 0.85rem;
}

/* Queue */
.queue-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 480px;
  overflow-y: auto;
}

.queue-list::-webkit-scrollbar {
  width: var(--sb-size);
}
.queue-list::-webkit-scrollbar-track {
  background: var(--sb-track-color);
  border-radius: 5px;
}
.queue-list::-webkit-scrollbar-thumb {
  background: var(--sb-thumb-color);
  border-radius: 5px;
}

.queue-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  margin-right: 4px;
  transition:
    background 0.2s,
    border-color 0.2s;
}
.queue-item:hover {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.08);
}

.q-num {
  width: 20px;
  text-align: right;
  color: var(--text-muted);
  font-size: 0.8rem;
  flex-shrink: 0;
  margin-right: 4px;
}

.q-thumb {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}

.q-info {
  flex: 1;
  overflow: hidden;
}

.q-title {
  font-size: 0.875rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 2px;
}

.q-sub {
  font-size: 0.78rem;
  color: var(--text-muted);
}
.q-platform {
  font-size: 0.9rem;
  flex-shrink: 0;
}

.q-handle {
  color: var(--text-muted);
  cursor: grab;
  opacity: 0.35;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 2px;
  transition: opacity 0.15s;
  user-select: none;
}
.queue-item:hover .q-handle {
  opacity: 0.75;
}
.q-handle:active {
  cursor: grabbing;
}

.queue-item.is-dragging {
  opacity: 0.35;
}

.queue-item.drop-before {
  border-top: 2px solid var(--accent);
  margin-top: -1px;
}
.queue-item.drop-after {
  border-bottom: 2px solid var(--accent);
  margin-bottom: -1px;
}

.q-remove {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition:
    background 0.15s,
    color 0.15s;
}
.q-remove:hover {
  background: rgba(248, 113, 113, 0.15);
  color: var(--danger);
}

/* Stop confirm dialog */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.dialog {
  background: rgba(12, 16, 36, 0.88);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 20px;
  padding: 32px;
  max-width: 360px;
  width: 90%;
  text-align: center;
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.dialog p {
  margin-bottom: 22px;
  font-size: 0.95rem;
  color: var(--text-secondary);
}

.dialog-btns {
  display: flex;
  gap: 10px;
  justify-content: center;
}
</style>
