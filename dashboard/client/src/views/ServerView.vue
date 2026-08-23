<template>
  <div class="max-w-275 mx-auto px-3 py-4.5">
    <div class="mb-4 flex items-center justify-between">
      <router-link to="/servers" class="text-muted no-underline text-sm px-2.5 py-1.25 rounded-lg inline-flex items-center gap-1 transition-[color,background-color] duration-200 hover:text-fg hover:bg-white/6">← 서버 목록</router-link>
      <router-link v-if="player.canManage" :to="`/servers/${guildId}/settings`" v-tooltip="'서버 설정'" class="text-muted no-underline text-sm px-2.5 py-1.25 rounded-lg inline-flex items-center gap-1.5 transition-[color,background-color] duration-200 hover:text-fg hover:bg-white/6">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.61 3.61 0 0 1 8.4 12c0-1.98 1.62-3.6 3.6-3.6s3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
          />
        </svg>
        설정
      </router-link>
    </div>

    <div v-if="loading" class="flex items-center justify-center p-20 text-muted">불러오는 중...</div>

    <template v-else>
      <!-- ── Now Playing ── -->
      <BaseCard title="지금 재생 중" class="mb-4 pb-3.75">
        <template v-if="player.currentTrack">
          <!-- Thumbnail + title/artist -->
          <div class="flex gap-4 items-center mb-4.5 mt-3.5">
            <img v-if="player.currentTrack.thumbnail" :src="player.currentTrack.thumbnail" class="w-auto h-[15vw] max-h-37.5 rounded-xl object-cover shrink-0 shadow-[0_4px_18px_rgba(0,0,0,0.5)]" />
            <div class="flex-1 pt-0.5 overflow-hidden">
              <a :href="player.currentTrack.url" target="_blank" rel="noopener" class="block text-[1.1rem] font-extrabold text-fg no-underline mb-1 overflow-hidden text-ellipsis whitespace-nowrap tracking-[-0.01em] hover:underline">
                {{ player.currentTrack.title }}
              </a>
              <div class="text-muted text-sm mb-3" v-if="player.currentTrack.artist">{{ player.currentTrack.artist }}</div>
            </div>
          </div>

          <!-- Full-width progress bar -->
          <div class="flex items-center gap-2 mb-1.5">
            <span :class="timeText">{{ fmt(displayTime) }}</span>
            <div class="group relative flex flex-1 h-4 items-center cursor-pointer before:content-[''] before:absolute before:inset-x-0 before:h-1 before:rounded before:bg-white/10 before:pointer-events-none" ref="progressBarRef" @mousedown.prevent="onScrubStart" @touchstart.prevent="onScrubStart">
              <div class="absolute left-0 h-1 rounded pointer-events-none bg-linear-90 from-accent to-accent-2 shadow-[0_0_8px_rgba(124,111,246,0.55)]" :class="isScrubbing ? '' : 'transition-[width] duration-400 ease-linear'" :style="{ width: progressPct + '%' }"></div>
              <!-- SponsorBlock 자동 스킵 구간 마커 (카테고리별 공식 색상). 호버 시 카테고리 툴팁 -->
              <!-- mousedown은 부모로 버블링돼 스크럽 시작에 영향 없음 -->
              <div v-for="(m, i) in sponsorMarkers" :key="'sb' + i" class="absolute h-1 rounded-sm opacity-80 hover:opacity-100 hover:h-1.5" :style="{ left: m.left + '%', width: m.width + '%', backgroundColor: m.color }" v-tooltip="m.label"></div>
              <!-- 하이라이트 지점 -->
              <div v-if="highlightMarker !== null" class="absolute top-1/2 w-0.5 h-3 -translate-y-1/2 rounded" :style="{ left: highlightMarker + '%', backgroundColor: 'var(--category-highlight-color)' }" v-tooltip="'하이라이트'"></div>
              <div class="absolute top-1/2 size-3 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.45)] pointer-events-none -translate-x-1/2 -translate-y-1/2" :class="isScrubbing ? 'opacity-100 scale-120 [transition:opacity_.15s,translate_.15s,scale_.15s]' : 'opacity-0 group-hover:opacity-100 [transition:opacity_.15s,translate_.15s,scale_.15s,left_.4s_linear]'" :style="{ left: progressPct + '%' }"></div>
            </div>
            <span :class="timeText">{{ fmt(player.currentTrack.duration) }}</span>
          </div>

          <!-- Controls -->
          <div class="flex flex-col gap-2.5">
            <div class="flex items-center gap-1 flex-wrap">
              <!-- Previous -->
              <!-- 한곡 반복 중에는 이전곡/다음곡 = 현재 곡 재시작이라 기록/대기열이 없어도 활성 -->
              <button :class="iconBtn" @click="action('previous')" v-tooltip="'이전곡'" :disabled="!player.canControl || !(player.hasPrevious || player.loop === 'track')">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
              </button>

              <!-- Play / Pause -->
              <button :class="iconBtn" @click="action('pause')" v-tooltip="player.paused ? '재생' : '일시정지'" :disabled="!player.canControl">
                <svg v-if="player.paused" width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                <svg v-else width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
              </button>

              <!-- Stop -->
              <button :class="iconStop" @click="confirmStop" v-tooltip="'정지'" :disabled="!player.canControl">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5" /></svg>
              </button>

              <!-- Skip -->
              <button :class="iconBtn" @click="action('skip')" v-tooltip="'다음곡'" :disabled="!canSkip || (player.queue.length === 0 && player.loop !== 'track')">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
              </button>

              <!-- Volume: capsule hover-expand -->
              <div class="group/vol flex items-center h-10 rounded-[20px] overflow-hidden transition-[background-color] duration-200 ease-smooth hover:bg-white/9 focus-within:bg-white/9">
                <button :class="volBtn" v-tooltip="`볼륨: ${player.volume}%`">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
                </button>
                <div class="flex items-center gap-1.5 max-w-0 opacity-0 whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-500 ease-smooth group-hover/vol:max-w-40 group-hover/vol:opacity-100 group-focus-within/vol:max-w-40 group-focus-within/vol:opacity-100">
                  <input type="range" min="0" max="100" step="5" :value="player.volume" @change="setVolume($event.target.value)" class="w-24 h-1 accent-accent cursor-pointer rounded shrink-0 disabled:cursor-not-allowed" :disabled="!player.canControl" />
                  <span class="text-muted text-[0.76rem] min-w-7 pr-2.5 tabular-nums">{{ player.volume }}%</span>
                </div>
              </div>

              <div class="flex-1"></div>

              <!-- SponsorBlock 하이라이트 점프 -->
              <button v-if="highlightMarker !== null" :class="iconBtn" @click="jumpToHighlight" v-tooltip="'하이라이트로 점프'" :disabled="!player.canControl">
                <svg width="17" height="17" viewBox="0 -960 960 960" fill="currentColor" style="color: var(--category-highlight-color)"><path d="M442-480 287-697q-14-20-3.5-41.5T319-760q10 0 19 4.5t14 12.5l188 263-188 263q-5 8-14 12.5t-19 4.5q-24 0-35-21.5t3-41.5l155-217Zm238 0L525-697q-14-20-3.5-41.5T557-760q10 0 19 4.5t14 12.5l188 263-188 263q-5 8-14 12.5t-19 4.5q-24 0-35-21.5t3-41.5l155-217Z" /></svg>
              </button>

              <!-- Shuffle -->
              <button :class="player.shuffle ? iconActive : iconBtn" @click="action('shuffle')" v-tooltip="'셔플'" :disabled="!player.canControl || player.queue.length < 2">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" /></svg>
              </button>
              <!-- Loop (cycles: off → track → queue) -->
              <button :class="player.loop ? iconActive : iconBtn" @click="cycleLoop" v-tooltip="loopTitle" :disabled="!player.canControl">
                <svg v-if="player.loop === 'track'" width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 2 1 1 1-1v4h1z" />
                </svg>
                <svg v-else width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
                </svg>
              </button>
            </div>

            <div v-if="!player.canControl" class="mt-2.5 text-muted text-[0.8rem]">봇과 같은 음성 채널에 참가한 DJ만 조작할 수 있어요.</div>
          </div>
        </template>

        <div v-else class="text-center p-5 text-muted text-[0.9rem] flex items-center justify-center gap-1.5"><Icon name="pause" :size="16" /><span>현재 재생 중인 곡이 없습니다</span></div>
      </BaseCard>

      <!-- ── Add Track ── -->
      <BaseCard title="곡 추가 - 캐시되지 않은 곡은 추가하는데에 조금 시간이 걸려요." class="mb-3">
        <!-- Case 1: both offline -->
        <div v-if="!player.botInVoice && !player.userInVoice" class="text-muted text-sm">사용자가 음성 채널에 있어야 봇을 음성 채널에 참가시킬 수 있고, 봇이 음성 채널에 있어야 곡을 추가할 수 있어요. 먼저 Discord에서 음성 채널에 참가해 주세요.</div>

        <!-- Case 2: user in voice, bot not -->
        <div v-else-if="!player.botInVoice && player.userInVoice" class="text-muted text-sm flex items-center gap-3 flex-wrap justify-between">
          <span>봇이 음성 채널에 있어야 곡을 추가할 수 있어요. 지금 참가중인 채널에 봇을 참가시킬까요?</span>
          <BaseButton variant="primary" class="whitespace-nowrap shrink-0" @click="joinBot" :disabled="joining">
            {{ joining ? "참가 중..." : "+ 참가" }}
          </BaseButton>
        </div>

        <!-- Case 3: bot in voice, but user elsewhere (관리자 제외) — 곡 추가는 계층 무관, 재적 규칙만 -->
        <div v-else-if="!player.canAdd" class="text-muted text-sm">곡 추가는 봇과 같은 음성 채널에 참가한 뒤 이용할 수 있어요.</div>

        <!-- Case 4: bot in voice + controllable → show add form -->
        <form v-else class="flex gap-2" @submit.prevent="addTrack(false)">
          <input v-model="addQuery" class="flex-1 bg-white/6 border border-white/9 rounded-[10px] text-fg px-3.5 py-2.25 text-[0.9rem] outline-none font-[inherit] transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/8" placeholder="곡 이름, YouTube/Spotify/SoundCloud URL..." :disabled="adding" />
          <BaseButton variant="primary" type="submit" :disabled="adding || !addQuery.trim()">
            {{ adding ? "추가 중..." : "+ 추가" }}
          </BaseButton>
          <BaseButton v-if="isPlaylistQuery" variant="secondary" type="button" :disabled="adding || !addQuery.trim()" @click="addTrack(true)" v-tooltip="'재생목록 첫 곡만 추가'">한 곡만</BaseButton>
        </form>

        <div v-if="addError" class="mt-2 text-danger text-[0.85rem]">{{ addError }}</div>
      </BaseCard>

      <!-- ── Queue ── -->
      <BaseCard v-if="player.queue?.length > 0" :title="`대기열 (${player.queue.length}곡)`">
        <div class="flex flex-col gap-1 max-h-120 overflow-y-auto [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-(--sb-track-color) [&::-webkit-scrollbar-track]:rounded-[5px] [&::-webkit-scrollbar-thumb]:bg-(--sb-thumb-color) [&::-webkit-scrollbar-thumb]:rounded-[5px]">
          <div
            v-for="(track, i) in player.queue"
            :key="i"
            class="group/item flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] bg-white/4 border border-transparent mr-1 transition-[background-color,border-color] duration-200 hover:bg-white/7 hover:border-white/8"
            :class="{
              'opacity-35': draggedIndex === i,
              'border-t-2 border-t-accent -mt-px': dragOverIndex === i && draggedIndex !== i,
              'border-b-2 border-b-accent -mb-px': dragOverIndex === player.queue.length && i === player.queue.length - 1,
            }"
            :draggable="player.canControl"
            @dragstart="onDragStart($event, i)"
            @dragover.prevent="onDragOver($event, i)"
            @drop.prevent="onDrop"
            @dragend="onDragEnd"
          >
            <span class="text-muted cursor-grab active:cursor-grabbing opacity-35 group-hover/item:opacity-75 shrink-0 flex items-center px-0.5 transition-opacity duration-150 select-none" v-tooltip="'드래그하여 순서 변경'">
              <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                <circle cx="2" cy="3" r="1.5" />
                <circle cx="2" cy="8" r="1.5" />
                <circle cx="2" cy="13" r="1.5" />
                <circle cx="8" cy="3" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="8" cy="13" r="1.5" />
              </svg>
            </span>
            <span class="w-5 text-right text-muted text-[0.8rem] shrink-0 mr-1">{{ i + 1 }}</span>
            <img v-if="track.thumbnail" :src="track.thumbnail" class="size-9 rounded-md object-cover shrink-0" />
            <div class="flex-1 overflow-hidden">
              <div class="text-sm font-medium overflow-hidden text-ellipsis whitespace-nowrap mb-0.5">{{ track.title }}</div>
              <div class="text-[0.78rem] text-muted">
                <span v-if="track.artist">{{ track.artist }} &bull; </span>
                <span>{{ fmt(track.duration) }}</span>
              </div>
            </div>
            <span class="size-2 rounded-full shrink-0" :style="{ backgroundColor: platformColor(track.platform) }" v-tooltip="track.platform"></span>
            <button class="size-6.5 rounded-md text-muted cursor-pointer text-xs flex items-center justify-center shrink-0 transition-[background-color,color] duration-150 disabled:opacity-25 disabled:cursor-not-allowed hover:not-disabled:bg-danger/15 hover:not-disabled:text-danger" @click="removeTrack(i)" v-tooltip="'제거'" :disabled="!canRemove(track)"><Icon name="close" :size="14" /></button>
          </div>
        </div>
      </BaseCard>
    </template>

    <!-- Stop confirm dialog -->
    <div v-if="showStopConfirm" class="fixed inset-0 bg-black/65 backdrop-blur-[6px] flex items-center justify-center z-200" @click.self="showStopConfirm = false">
      <div class="bg-[rgba(12,16,36,0.88)] backdrop-blur-2xl backdrop-saturate-[1.8] border border-white/12 rounded-[20px] p-8 max-w-90 w-[90%] text-center shadow-[0_20px_60px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <p class="mb-5.5 text-[0.95rem] text-fg-soft">재생을 완전히 중지하고 대기열을 비울까요?</p>
        <div class="flex gap-2.5 justify-center">
          <BaseButton variant="ghost" @click="showStopConfirm = false">취소</BaseButton>
          <BaseButton variant="danger" @click="doStop">중지</BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import axios from "axios";
import BaseCard from "../components/BaseCard.vue";
import BaseButton from "../components/BaseButton.vue";
import Icon from "../components/BaseIcon.vue";

// ── 반복 유틸리티 클래스 (구 scoped CSS) ───────────────────────────────────────
const timeText = "text-muted text-[0.78rem] whitespace-nowrap tabular-nums";

// 원형 아이콘 버튼 — 상태(기본/정지/활성)별로 색상군을 통째로 정의(같은 속성 유틸리티 중복 회피)
const iconBase = "size-10 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-[background-color,color,scale] duration-150 disabled:opacity-25 disabled:cursor-not-allowed active:not-disabled:scale-[0.88] active:not-disabled:duration-75";
const iconBtn = `${iconBase} text-[rgba(232,234,246,0.7)] hover:not-disabled:bg-white/11 hover:not-disabled:text-fg active:not-disabled:bg-white/17`;
const iconStop = `${iconBase} text-[rgba(232,234,246,0.7)] hover:not-disabled:bg-danger/18 hover:not-disabled:text-[#fca5a5] active:not-disabled:bg-danger/26`;
const iconActive = `${iconBase} text-[#c4b5fd] hover:not-disabled:bg-accent/20 hover:not-disabled:text-[#ddd6fe] active:not-disabled:bg-white/17`;
// 볼륨 캡슐 안 버튼 — 캡슐이 hover 배경을 담당하므로 버튼 자체는 투명 유지
const volBtn = "size-10 rounded-full flex items-center justify-center shrink-0 cursor-pointer text-[rgba(232,234,246,0.7)] group-hover/vol:text-fg";

const route = useRoute();
const guildId = route.params.guildId;
const loading = ref(true);
const player = ref({ playing: false, paused: false, queue: [], currentTrack: null, volume: 100, loop: false, shuffle: false, botInVoice: false, userInVoice: false, canControl: false, canAdd: false, userId: null, hasPrevious: false });

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
let eventSource = null;
let nudgeTimer = null;
const localTime = ref(0);
const progressBarRef = ref(null);
const isScrubbing = ref(false);
const scrubTime = ref(0);

// ── Data ──────────────────────────────────────────────────────────────────────

// Action responses come from playerState() which omits the GET /player extras
// (botInVoice/userInVoice/canControl/canAdd/canManage/userId). Spread over the previous
// full-refresh state so those flags never flash off — 명시 목록으로 관리하다 canManage가
// 빠져 조작 직후 ⚙ 버튼이 증발했던 버그의 재발 방지.
function applyState(data) {
  player.value = { ...player.value, ...data };
}

// 스킵은 DJ 계층이 아니어도 현재 곡의 요청자 본인이면 가능 (서버 checkSkip과 동일 규칙)
const canSkip = computed(() => player.value.canControl || (!!player.value.currentTrack?.requestedBy?.id && player.value.currentTrack.requestedBy.id === player.value.userId));

// 대기열 제거도 그 곡의 요청자 본인이면 가능 (서버 checkRemoveTrack과 동일 규칙)
function canRemove(track) {
  return player.value.canControl || (!!track.requestedBy?.id && track.requestedBy.id === player.value.userId);
}

async function refresh() {
  if (isDragging.value) return; // don't overwrite queue while user is mid-drag
  try {
    const res = await axios.get(`/api/guilds/${guildId}/player`);
    // 봇 재적/추가가능 여부가 바뀌면 직전 곡 추가 오류는 더 이상 유효하지 않으므로 정리
    // (봇이 나가 추가 폼이 참가 버튼으로 바뀌는 순간 stale 오류 제거 — 새로고침 없이 사라짐)
    if (addError.value && (res.data.botInVoice !== player.value.botInVoice || res.data.canAdd !== player.value.canAdd)) {
      addError.value = "";
    }
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

// 입력이 YouTube 재생목록(list= 포함)인지 — "한 곡만 추가" 버튼 노출 조건
const isPlaylistQuery = computed(() => {
  const q = addQuery.value.trim();
  return /(?:youtube\.com|youtu\.be)/i.test(q) && /[?&]list=/i.test(q);
});

// "한 곡만 추가"의 실제 요청 payload — 영상 ID가 링크에 노출돼 있으면(watch?v=, youtu.be/ID)
// 재생목록 조회 없이 링크를 그 영상만 가리키게 절삭(빠름). 그 외(playlist?list=만)는 single=true로 첫 곡.
function singlePayload(raw) {
  try {
    const u = new URL(raw.trim());
    if (/(?:^|\.)youtube\.com$/i.test(u.hostname)) {
      const v = u.searchParams.get("v");
      if (v) return { query: `https://www.youtube.com/watch?v=${v}`, single: false };
    } else if (/(?:^|\.)youtu\.be$/i.test(u.hostname)) {
      const id = u.pathname.replace(/^\/+/, "").split("/")[0];
      if (id) return { query: `https://www.youtube.com/watch?v=${id}`, single: false };
    }
  } catch {
    /* URL 아님 — 원본 그대로 */
  }
  return { query: raw.trim(), single: true };
}

async function addTrack(single = false) {
  if (!addQuery.value.trim() || adding.value) return;
  adding.value = true;
  addError.value = "";
  try {
    const payload = single === true ? singlePayload(addQuery.value) : { query: addQuery.value.trim(), single: false };
    const res = await axios.post(`/api/guilds/${guildId}/player/queue`, payload);
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
  if (!player.value.canControl) return;
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

// 카테고리 → SponsorBlock 공식 색상 CSS 변수명 매핑
const SB_COLOR_VAR = {
  sponsor: "sponsor",
  selfpromo: "selfpromo",
  interaction: "interaction_reminder",
  intro: "intro",
  outro: "endcards",
  preview: "preview",
  hook: "hook",
  music_offtopic: "nonmusic",
  filler: "tangents",
};

// 카테고리 → 한국어 라벨 (툴팁용)
const SB_LABEL = {
  music_offtopic: "음악이 아님",
  intro: "인트로/무음",
  outro: "최종 화면",
  sponsor: "후원이나 협찬",
  selfpromo: "무대가 홍보",
  interaction: "상호작용 알림",
  preview: "미리보기/요약",
  hook: "후킹/인사말",
  filler: "잡담/농담",
};

// SponsorBlock 자동 스킵 구간 → 진행바 상 위치(%) + 카테고리별 공식 색상. 하이라이트 지점도 %로.
const sponsorMarkers = computed(() => {
  const t = player.value.currentTrack;
  const dur = t?.duration || 0;
  if (!dur || !Array.isArray(t?.sponsorSegments)) return [];
  return t.sponsorSegments.map((s) => {
    const left = Math.max(0, Math.min(100, (s.start / dur) * 100));
    const right = Math.max(0, Math.min(100, (s.end / dur) * 100));
    const cat = (s.categories && s.categories[0]) || "music_offtopic";
    const label = (s.categories && s.categories.length ? s.categories : [cat]).map((c) => SB_LABEL[c] || c).join(", ");
    return { left, width: Math.max(0.4, right - left), color: `var(--category-${SB_COLOR_VAR[cat] || "nonmusic"}-color)`, label };
  });
});
const highlightMarker = computed(() => {
  const t = player.value.currentTrack;
  const dur = t?.duration || 0;
  const h = t?.highlightAt;
  if (!dur || h === null || h === undefined) return null;
  return Math.max(0, Math.min(100, (h / dur) * 100));
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
  if (!player.value.currentTrack || !player.value.canControl) return;
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

async function jumpToHighlight() {
  const h = player.value.currentTrack?.highlightAt;
  if (h === null || h === undefined) return;
  localTime.value = h;
  try {
    await axios.post(`/api/guilds/${guildId}/player/seek`, { position: h });
  } catch (e) {
    console.error("highlight", e);
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

function platformColor(p) {
  return { youtube: "#ff0000", spotify: "#1db954", soundcloud: "#ff5500", direct: "var(--accent)" }[p] || "#8b93a7";
}

// SSE — 서버가 "변화 발생" 넛지를 보내면 상태를 다시 가져옴 (하이브리드). 디바운스로 넛지 몰림 흡수.
// 폴링은 SSE가 끊겼을 때만 도는 진짜 폴백(기존엔 SSE 정상 여부와 무관하게 30초마다 /player를 무조건 호출).
function startFallback() {
  if (!timer) timer = setInterval(refresh, 30000);
}
function stopFallback() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
function openEvents() {
  if (eventSource) return;
  eventSource = new EventSource(`/api/guilds/${guildId}/player/events`, { withCredentials: true });
  eventSource.onopen = () => {
    if (timer) refresh(); // 끊긴 동안 놓친 변화 재동기화 후 폴백 중지
    stopFallback();
  };
  eventSource.onmessage = () => {
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(refresh, 150);
  };
  eventSource.onerror = () => startFallback(); // SSE 끊김 → 폴백 폴링 시작 (재연결 시 onopen에서 중지)
}
function closeEvents() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  stopFallback();
  clearTimeout(nudgeTimer);
}

let visHandler = null;
onMounted(() => {
  refresh();
  // 탭이 숨으면 SSE·폴링을 모두 접어 백그라운드 무음, 다시 보이면 재개 + 즉시 동기화
  visHandler = () => {
    if (document.hidden) closeEvents();
    else {
      refresh();
      openEvents();
    }
  };
  document.addEventListener("visibilitychange", visHandler);
  if (!document.hidden) openEvents();
  // 로컬 진행바 틱(네트워크 아님) — 넛지/refresh가 currentTime을 서버 기준으로 재동기화
  progressTimer = setInterval(() => {
    const track = player.value.currentTrack;
    if (track && !player.value.paused) {
      localTime.value = Math.min(localTime.value + 1, track.duration);
    }
  }, 1000);
});
onUnmounted(() => {
  if (visHandler) {
    document.removeEventListener("visibilitychange", visHandler);
    visHandler = null;
  }
  clearInterval(timer);
  timer = null;
  clearInterval(progressTimer);
  if (eventSource) eventSource.close();
  eventSource = null;
  clearTimeout(nudgeTimer);
  document.removeEventListener("mousemove", onScrubMove);
  document.removeEventListener("mouseup", onScrubEnd);
  document.removeEventListener("touchmove", onScrubMove);
  document.removeEventListener("touchend", onScrubEnd);
});
</script>
