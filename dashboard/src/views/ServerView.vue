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

    <div v-else-if="loadError" class="flex flex-col items-center gap-3 p-16 text-center">
      <p class="text-danger text-[0.9rem] whitespace-pre-line">{{ loadError }}</p>
      <BaseButton variant="ghost" @click="retryLoad">다시 시도</BaseButton>
    </div>

    <template v-else>
      <!-- ── 지금 재생 중 ── -->
      <BaseCard title="지금 재생 중" class="mb-4 pb-3.75">
        <div v-if="player.currentTrack" class="relative">
          <div :class="channelLocked && 'blur-[5px] saturate-50 pointer-events-none select-none'">
            <!-- 썸네일 · 제목 · 아티스트 -->
            <div class="flex gap-4 items-center mb-4.5 mt-3.5">
              <img v-if="player.currentTrack.thumbnail" :src="player.currentTrack.thumbnail" class="w-auto h-[15vw] max-h-37.5 rounded-xl object-cover shrink-0 shadow-[0_4px_18px_rgba(0,0,0,0.5)]" />
              <!-- 직접 링크는 앨범아트를 알 수 없다. 파일 아이콘으로 대체 -->
              <div v-else class="h-[15vw] max-h-37.5 aspect-square rounded-xl bg-white/6 flex items-center justify-center shrink-0 text-muted">
                <Icon name="audio-file" :size="44" />
              </div>
              <div class="flex-1 pt-0.5 overflow-hidden">
                <a :href="player.currentTrack.url" target="_blank" rel="noopener" class="block text-[1.1rem] font-extrabold text-fg no-underline mb-1 overflow-hidden text-ellipsis whitespace-nowrap tracking-[-0.01em] hover:underline">
                  {{ songTitle(player.currentTrack.title) }}
                </a>
                <div class="text-muted text-sm mb-3" v-if="player.currentTrack.artist">{{ player.currentTrack.artist }}</div>
              </div>
            </div>

            <!-- 진행 막대(가로 전체) -->
            <div class="flex items-center gap-2 mb-1.5">
              <!-- 라이브의 경과 시간은 곡 안의 위치가 아니라 붙어 있은 시간이다. 표식으로 대신한다 -->
              <span :class="timeText">{{ isLive ? "🔴 라이브" : fmt(displayTime) }}</span>
              <div class="group relative flex flex-1 h-4 items-center touch-none before:content-[''] before:absolute before:inset-x-0 before:h-1 before:rounded before:bg-white/10 before:pointer-events-none" :class="seekable ? 'cursor-pointer' : ''" ref="progressBarRef" @pointerdown.prevent="seekBar.onPointerDown">
                <div class="absolute left-0 h-1 rounded pointer-events-none bg-linear-90 from-accent to-accent-2 shadow-[0_0_8px_rgba(124,111,246,0.55)]" :class="isScrubbing ? '' : 'transition-[width] duration-400 ease-linear'" :style="{ width: progressPct + '%' }"></div>
                <!-- SponsorBlock 자동 스킵 구간 마커 (카테고리별 공식 색상). 호버 시 카테고리 툴팁 -->
                <!-- mousedown은 부모로 버블링돼 스크럽 시작에 영향 없음 -->
                <div v-for="(m, i) in sponsorMarkers" :key="'sb' + i" class="absolute h-1 rounded-sm opacity-80 hover:opacity-100 hover:h-1.5" :style="{ left: m.left + '%', width: m.width + '%', backgroundColor: m.color }" v-tooltip="m.label"></div>
                <!-- 하이라이트 지점 -->
                <div v-if="highlightMarker !== null" class="absolute top-1/2 w-0.5 h-3 -translate-y-1/2 rounded" :style="{ left: highlightMarker + '%', backgroundColor: 'var(--category-highlight-color)' }" v-tooltip="'하이라이트'"></div>
                <!-- 옮길 수 없는 곡(라이브·길이 미상)에는 손잡이를 내지 않는다. 잡을 수 있는 것처럼 보이면 안 된다 -->
                <div v-if="seekable" class="absolute top-1/2 size-3 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.45)] pointer-events-none -translate-x-1/2 -translate-y-1/2" :class="isScrubbing ? 'opacity-100 scale-120 [transition:opacity_.15s,translate_.15s,scale_.15s]' : 'opacity-0 group-hover:opacity-100 [transition:opacity_.15s,translate_.15s,scale_.15s,left_.4s_linear]'" :style="{ left: progressPct + '%' }"></div>
              </div>
              <span :class="timeText">{{ player.currentTrack.duration > 0 ? fmt(player.currentTrack.duration) : "--:--" }}</span>
            </div>

            <!-- 조작 -->
            <div class="flex flex-col gap-2.5">
              <div class="flex items-center gap-1 flex-wrap">
                <!-- 이전 곡 -->
                <!-- 한곡 반복 중에는 이전곡/다음곡 = 현재 곡 재시작이라 기록/대기열이 없어도 활성 -->
                <button :class="iconBtn" @click="previous" v-tooltip="'이전곡'" :disabled="!previousEnabled(player) || isBusy('previous')">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
                </button>

                <!-- 재생 · 일시정지 -->
                <button :class="iconBtn" @click="togglePause" v-tooltip="player.paused ? '재생' : '일시정지'" :disabled="!player.canControl">
                  <svg v-if="player.paused" width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  <svg v-else width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                </button>

                <!-- 정지 -->
                <button :class="iconStop" @click="confirmStop" v-tooltip="'정지'" :disabled="!player.canControl || isBusy('stop')">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5" /></svg>
                </button>

                <!-- 다음 곡 -->
                <button :class="iconBtn" @click="skip" v-tooltip="'다음곡'" :disabled="!skipEnabled(player) || isBusy('skip')">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
                </button>

                <!-- Volume: capsule hover-expand. 모바일에서는 펼치면 오른쪽 버튼이 밀려 줄이 바뀌므로 처음부터 아랫줄에 둔다 -->
                <div class="order-last basis-full flex sm:order-0 sm:basis-auto">
                  <div class="group/vol flex items-center h-10 rounded-[20px] overflow-hidden transition-[background-color] duration-200 ease-smooth hover:bg-white/9 focus-within:bg-white/9">
                    <button :class="volBtn" v-tooltip="`볼륨: ${volumeShown}%`">
                      <VolumeIcon :level="volumeShown" :size="17" />
                    </button>
                    <div class="flex items-center gap-1.5 max-w-0 opacity-0 whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-500 ease-smooth group-hover/vol:max-w-44 group-hover/vol:opacity-100 group-focus-within/vol:max-w-44 group-focus-within/vol:opacity-100">
                      <input type="range" min="0" :max="VOLUME_MAX" step="1" :value="volumeShown" @input="volumeInput(valueOf($event))" @change="volumeChange(valueOf($event))" class="w-30 h-1 accent-accent cursor-pointer rounded shrink-0 disabled:cursor-not-allowed" :disabled="!player.canControl" />
                      <span class="text-muted text-[0.76rem] min-w-7 pr-2.5 tabular-nums">{{ volumeShown }}%</span>
                    </div>
                  </div>
                </div>

                <div class="flex-1"></div>

                <!-- SponsorBlock 하이라이트 점프 -->
                <button v-if="highlightMarker !== null" :class="iconBtn" @click="jumpToHighlight" v-tooltip="'하이라이트로 점프'" :disabled="!player.canControl || isBusy('highlight')">
                  <svg width="17" height="17" viewBox="0 -960 960 960" fill="currentColor" style="color: var(--category-highlight-color)"><path d="M442-480 287-697q-14-20-3.5-41.5T319-760q10 0 19 4.5t14 12.5l188 263-188 263q-5 8-14 12.5t-19 4.5q-24 0-35-21.5t3-41.5l155-217Zm238 0L525-697q-14-20-3.5-41.5T557-760q10 0 19 4.5t14 12.5l188 263-188 263q-5 8-14 12.5t-19 4.5q-24 0-35-21.5t3-41.5l155-217Z" /></svg>
                </button>

                <!-- 섞기 -->
                <button :class="iconBtn" @click="shuffle" v-tooltip="'셔플'" :disabled="!player.canControl || player.queue.length < 2 || isBusy('shuffle')">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" /></svg>
                </button>
                <!-- Loop (cycles: off → track → queue) -->
                <button :class="player.loop ? iconActive : iconBtn" @click="cycleLoop" v-tooltip="loopTitle" :disabled="!player.canControl || player.hasLive || isBusy('loop')">
                  <svg v-if="player.loop === 'track'" width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 2 1 1 1-1v4h1z" />
                  </svg>
                  <svg v-else width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
                  </svg>
                </button>
              </div>

              <div v-if="!player.canControl && player.sameVoice" class="mt-2.5 text-muted text-[0.8rem]">{{ gate("must-dj").body }}</div>
            </div>
          </div>

          <!-- 봇이 있는 채널 밖에서는 서버가 조작을 막는다(checkVoice). 버튼을 하나씩 비활성으로 두는 대신
               카드를 통째로 가려 이유를 한 번에 알린다. 모더레이터는 면제라 여기 걸리지 않는다. -->
          <div v-if="channelLocked" class="absolute inset-0 flex items-center justify-center p-3">
            <span class="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-[0.85rem] font-semibold text-fg text-center bg-[rgba(12,16,36,0.92)] backdrop-blur-sm border border-white/12 shadow-card"> <Icon name="headphones" :size="17" class="shrink-0 text-[#c4b5fd]" />{{ gate("must-be-in-same-voice").title }} </span>
          </div>
        </div>

        <div v-else class="text-center p-5 text-muted text-[0.9rem] flex items-center justify-center gap-1.5"><Icon name="pause" :size="16" /><span>현재 재생 중인 곡이 없습니다</span></div>
      </BaseCard>

      <!-- ── 곡 추가 ── -->
      <BaseCard title="곡 추가 - 캐시되지 않은 곡은 추가하는데에 조금 시간이 걸려요." class="mb-3">
        <!-- 1: 사용자도 봇도 음성 채널 밖 -->
        <div v-if="!player.botInVoice && !player.userInVoice" class="text-muted text-sm">{{ gate("must-be-in-voice").title }} {{ gate("must-be-in-voice").body }}</div>

        <!-- 2: 사용자만 음성 채널에 있다 -->
        <div v-else-if="!player.botInVoice && player.userInVoice" class="text-muted text-sm flex items-center gap-3 flex-wrap justify-between">
          <span>{{ gate("bot-not-in-voice").title }} {{ gate("bot-not-in-voice").body }}</span>
          <BaseButton variant="primary" class="whitespace-nowrap shrink-0" @click="joinBot" :disabled="joining">
            {{ joining ? "참가 중..." : "+ 참가" }}
          </BaseButton>
        </div>

        <!-- 3: 봇은 음성에 있는데 서버에 플레이어가 없다. 디스코드 음성 상태와 봇 내부 상태가 어긋난 경우.
             폼을 열어봤자 409이므로 잠근다. 되살릴 방법은 아직 모른다(원인 미규명). 참가를 권하지 않는다.
             이 상태에서도 봇이 소리를 내고 있을 수 있어, 새 플레이어를 만들면 그쪽이 끊긴다. -->
        <div v-else-if="!player.hasPlayer" class="text-muted text-sm">봇이 음성 채널에 있지만 재생 상태를 읽을 수 없어요. 잠시 후 다시 시도해 주세요.</div>

        <!-- 4: 봇은 음성 채널에 있는데 사용자는 다른 곳(모더레이터 제외). 곡 추가는 계층과 무관하고 재적 규칙만 본다 -->
        <div v-else-if="!player.canAdd" class="text-muted text-sm">{{ gate("must-be-in-same-voice").title }} {{ gate("must-be-in-same-voice").body }}</div>

        <!-- 5: 봇이 음성 채널에 있고 곡을 넣을 수 있다 → 곡 추가 칸 -->
        <form v-else class="flex gap-2" @submit.prevent="addTrack(false)">
          <input v-model="addQuery" class="flex-1 bg-white/6 border border-white/9 rounded-[10px] text-fg px-3.5 py-2.25 text-[0.9rem] outline-none font-[inherit] transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/8" placeholder="곡 이름, YouTube/Spotify/SoundCloud URL..." :disabled="adding" />
          <BaseButton variant="primary" type="submit" :disabled="adding || !addQuery.trim()">
            {{ adding ? "추가 중..." : "+ 추가" }}
          </BaseButton>
          <BaseButton v-if="isPlaylistQuery" variant="secondary" type="button" :disabled="adding || !addQuery.trim()" @click="addTrack(true)" v-tooltip="'재생목록 첫 곡만 추가'">한 곡만</BaseButton>
        </form>

        <div v-if="addError" class="mt-2 text-danger text-[0.85rem] whitespace-pre-line">{{ addError }}</div>
        <div v-else-if="addNotice" class="mt-2 text-warning text-[0.85rem] whitespace-pre-line">{{ addNotice }}</div>
        <div v-else-if="addInfo" class="mt-2 text-success text-[0.85rem]">{{ addInfo }}</div>
        <PlaylistMore v-if="more && player.canAdd" :more="more" :queue-total="player.queueTotal ?? player.queue.length" :has-current="Boolean(player.currentTrack)" :queue-max="queueMax" :busy="moreBusy" @add="addMore" @close="more = null" />
      </BaseCard>

      <!-- ── 대기열 ── -->
      <BaseCard v-if="player.queue?.length > 0" :title="`대기열 (${(player.queueTotal ?? player.queue.length).toLocaleString()}곡)`">
        <div ref="queueBoxRef" @scroll.passive="onQueueScroll" class="flex flex-col gap-1 max-h-120 overflow-y-auto [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-(--sb-track-color) [&::-webkit-scrollbar-track]:rounded-[5px] [&::-webkit-scrollbar-thumb]:bg-(--sb-thumb-color) [&::-webkit-scrollbar-thumb]:rounded-[5px]">
          <div
            v-for="(track, i) in player.queue"
            :key="track.entry ?? `i${i}`"
            class="group/item flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] bg-white/4 border border-transparent mr-1 transition-[background-color,border-color] duration-200 hover:bg-white/7 hover:border-white/8"
            :class="{
              'opacity-35': draggedIndex === i,
              'border-t-2 border-t-accent -mt-px': dragOverIndex === i && draggedIndex !== i,
              'border-b-2 border-b-accent -mb-px': dragOverIndex === player.queue.length && i === player.queue.length - 1,
            }"
            :draggable="player.canControl && !isBusy('move')"
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
            <div v-else class="size-9 rounded-md bg-white/6 flex items-center justify-center shrink-0 text-muted"><Icon name="audio-file" :size="18" /></div>
            <div class="flex-1 overflow-hidden">
              <div class="text-sm font-medium overflow-hidden text-ellipsis whitespace-nowrap mb-0.5">{{ songTitle(track.title) }}</div>
              <div class="text-[0.78rem] text-muted">
                <span v-if="track.artist">{{ track.artist }} &bull; </span>
                <span>{{ fmt(track.duration) }}</span>
              </div>
            </div>
            <span v-if="track.autoplay" class="text-muted shrink-0 flex items-center" v-tooltip="'자동재생'"><Icon name="robot" :size="13" /></span>
            <span class="size-2 rounded-full shrink-0" :style="{ backgroundColor: platformColor(track.platform) }" v-tooltip="track.platformLabel || track.platform"></span>
            <button class="size-6.5 rounded-md text-muted cursor-pointer text-xs flex items-center justify-center shrink-0 transition-[background-color,color] duration-150 disabled:opacity-25 disabled:cursor-not-allowed hover:not-disabled:bg-danger/15 hover:not-disabled:text-danger" @click="removeTrack(track)" v-tooltip="'제거'" :disabled="!canRemove(track) || !Number.isInteger(track.entry) || isBusy(`remove:${track.entry}`)"><Icon name="close" :size="14" /></button>
          </div>

          <div v-if="player.queue.length < (player.queueTotal ?? 0)" class="flex items-center justify-center gap-2 py-3 text-muted text-[0.82rem]">
            <span class="size-3.5 rounded-full border-2 border-white/15 border-t-accent animate-spin"></span>
            {{ (player.queueTotal - player.queue.length).toLocaleString() }}곡 더
          </div>
        </div>
      </BaseCard>
    </template>

    <!-- 정지 확인 대화상자 -->
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

<script setup lang="ts">
import { songTitle } from "../../../src/ui/text/ko/labels.ts";
import { nextLoopMode } from "../../../src/rules/loop-cycle.ts";
import { problemText, noticeText } from "../utils/problem.ts";
import { useGuildsStore, onGuildNudge } from "../stores/guilds.ts";
import { notify, notifyProblem } from "../composables/toasts.ts";
import { LIMIT } from "../utils/request.ts";
import { accepts, canRemove as removeAllowed, clockOf, moveTarget, onTrackOf, positionAt, previousEnabled, retime, skipEnabled } from "../utils/playback.ts";
import { reordered } from "../utils/reorder.ts";
import { withReadFields, type PlayerSeen } from "../utils/playback.ts";
import { valueOf } from "../utils/dom.ts";
import { useSeekBar } from "../composables/seek-bar.ts";
import { useBusy } from "../composables/busy.ts";
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import axios from "axios";
import BaseCard from "../components/BaseCard.vue";
import BaseButton from "../components/BaseButton.vue";
import Icon from "../components/BaseIcon.vue";
import PlaylistMore from "../components/PlaylistMore.vue";
import VolumeIcon from "../components/VolumeIcon.vue";
import { useVolumeControl } from "../composables/volume-control.ts";
import { formatDuration } from "../../../src/ui/format.ts";
import { VOLUME_MAX } from "../../../src/rules/limits.ts";
import { isPlatform, type Platform } from "../../../src/rules/platforms.ts";
import { categoryLabel, isSkipCategory, type SkipCategory } from "../../../src/rules/sponsor-categories.ts";
import { extractVideoId, isYouTubePlaylist, youtubeWatchUrl } from "../../../src/rules/links.ts";
import { loopLabel } from "../../../src/ui/text/ko/panel.ts";
import { QUEUE_PAGE, modeOf, type AddReply, type MoreReply, type MoreView, type PlayerRead, type PlayerState, type QueuePage, type QueueTrackView } from "../../../src/dashboard/contract/player.ts";

// ── 반복 유틸리티 클래스 (구 scoped CSS) ───────────────────────────────────────
const timeText = "text-muted text-[0.78rem] whitespace-nowrap tabular-nums";

// 원형 아이콘 버튼. 상태(기본/정지/활성)별로 색상군을 통째로 정의(같은 속성 유틸리티 중복 회피)
const iconBase = "size-10 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-[background-color,color,scale] duration-150 disabled:opacity-25 disabled:cursor-not-allowed active:not-disabled:scale-[0.88] active:not-disabled:duration-75";
const iconBtn = `${iconBase} text-[rgba(232,234,246,0.7)] hover:not-disabled:bg-white/11 hover:not-disabled:text-fg active:not-disabled:bg-white/17`;
const iconStop = `${iconBase} text-[rgba(232,234,246,0.7)] hover:not-disabled:bg-danger/18 hover:not-disabled:text-[#fca5a5] active:not-disabled:bg-danger/26`;
const iconActive = `${iconBase} text-[#c4b5fd] hover:not-disabled:bg-accent/20 hover:not-disabled:text-[#ddd6fe] active:not-disabled:bg-white/17`;
// 볼륨 캡슐 안 버튼. 캡슐이 hover 배경을 담당하므로 버튼 자체는 투명 유지
const volBtn = "size-10 rounded-full flex items-center justify-center shrink-0 cursor-pointer text-[rgba(232,234,246,0.7)] group-hover/vol:text-fg";

const route = useRoute();
const guildId = String(route.params.guildId);
const loading = ref(true);
const loadError = ref(""); // 처음 읽기가 실패했다. 기본 상태("곡 없음")를 진짜처럼 보이지 않게 까닭과 다시 시도를 띄운다
// 처음 읽기 전의 모양. 봇이 없는 서버와 같다
const player = ref<PlayerSeen>({ boot: 0, seq: 0, playing: false, paused: false, queue: [], queueTotal: 0, currentTrack: null, volume: 100, loop: false, hasLive: false, botInVoice: false, userInVoice: false, sameVoice: false, hasPlayer: false, canControl: false, canAdd: false, canManage: false, userId: "", hasPrevious: false });

// 대기열은 앞에서부터 한 묶음씩 받는다. 서버 응답도 지금 펼쳐 둔 만큼(loadedCount)만 싣는다.
const loadedCount = ref(QUEUE_PAGE);
const loadingMore = ref(false);
const queueBoxRef = ref<HTMLElement | null>(null);
// 조작 응답도 상태를 통째로 돌려주므로 모든 호출에 창 크기를 실어 보낸다. 안 그러면 목록이 접힌다.
const qs = () => `?queue=${loadedCount.value}`;

const addQuery = ref("");
const adding = ref(false);
const addError = ref("");
const addNotice = ref("");
const addInfo = ref("");
// 이어 넣을 수 있는 재생목록. 서버가 준 상태를 그대로 되돌려 보낸다
const more = ref<MoreView | null>(null);
const moreBusy = ref(false);
const queueMax = ref(0);
const joining = ref(false);
const showStopConfirm = ref(false);

// 대기열 끌기
const draggedIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);
const isDragging = ref(false);
// 끄는 동안 받은 서버 대기열. 끄는 그 칸만 미루고(다른 칸은 바로 넣는다) 끌기가 끝나면 넣는다
let heldQueue: Pick<PlayerState, "queue" | "queueTotal"> | null = null;

// 진행 시계: 받은 위치 + 지난 시간(utils/playback). 1초마다 now 만 바꾼다
const clock = ref(clockOf(null, 0));
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
const progressBarRef = ref<HTMLElement | null>(null);

// 응답을 기다리는 조작(넘기기 · 이전 · 정지 · 섞기 · 빼는 줄 · 옮기기). 그동안 그 버튼을 끈다
const { isBusy, whileBusy } = useBusy();

// ── 상태 ──────────────────────────────────────────────────────────────────────

// 받은 재생 상태를 넣는다. 늦게 온 옛 상태는 버린다(만든 차례). 조작 응답에 없는 읽기 전용 칸(권한 · 음성)은 지금 값을 남긴다(utils/playback).
// 대기열을 끄는 동안에는 대기열만 미룬다
function applyState(data: PlayerState | PlayerRead) {
  if (!accepts(player.value, data)) return;
  let next = withReadFields(player.value, data);
  if (isDragging.value) {
    heldQueue = { queue: next.queue, queueTotal: next.queueTotal };
    next = { ...next, queue: player.value.queue, queueTotal: player.value.queueTotal };
  }
  player.value = next;
  clock.value = clockOf(next, Date.now());
  syncLoaded();
}

// 곡이 빠져 큐가 줄면 펼쳐 둔 창도 같이 줄인다. 안 그러면 바닥에 닿아도 더 받을 게 없다고 판단한다.
function syncLoaded() {
  loadedCount.value = Math.max(QUEUE_PAGE, player.value.queue?.length || 0);
}

async function loadMore() {
  const total = player.value.queueTotal ?? 0;
  if (loadingMore.value || isDragging.value || player.value.queue.length >= total) return;
  loadingMore.value = true;
  try {
    const res = await axios.get<QueuePage>(`/api/guilds/${guildId}/player/queue`, { params: { offset: player.value.queue.length, limit: QUEUE_PAGE } });
    // 받는 사이에 큐가 바뀌었을 수 있다. 지금 길이보다 뒤에 있는 것만 이어 붙인다.
    const fresh = (res.data.items || []).filter((t) => t.index >= player.value.queue.length);
    player.value = { ...player.value, queue: [...player.value.queue, ...fresh], queueTotal: res.data.total };
    syncLoaded();
  } catch (e) {
    notifyProblem(e, "대기열을 더 불러오지 못했어요.");
  } finally {
    loadingMore.value = false;
  }
}

function onQueueScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) void loadMore();
}

// 봇과 다른 채널(또는 음성 밖)이면 서버가 조작을 전부 막는다. 카드를 가려 이유를 먼저 보여준다.
// 모더레이터는 checkVoice 면제라 canControl이 참이므로 여기 걸리지 않는다.
const channelLocked = computed(() => !player.value.canControl && player.value.botInVoice && !player.value.sameVoice);

const canRemove = (track: QueueTrackView) => removeAllowed(player.value, track);

async function refresh() {
  try {
    const res = await axios.get<PlayerRead>(`/api/guilds/${guildId}/player${qs()}`);
    // 봇 재적/추가가능 여부가 바뀌면 직전 곡 추가 오류는 더 이상 유효하지 않으므로 정리
    // (봇이 나가 추가 폼이 참가 버튼으로 바뀌는 순간 stale 오류 제거. 새로고침 없이 사라짐)
    if (addError.value && (res.data.botInVoice !== player.value.botInVoice || res.data.canAdd !== player.value.canAdd)) {
      addError.value = "";
    }
    applyState(res.data);
    loadError.value = "";
  } catch (e) {
    // 처음 읽기면 화면에 까닭을, 그 뒤면 알림으로(지금 화면은 둔다)
    if (loading.value) loadError.value = problemText(e, "재생 상태를 읽지 못했어요.");
    else notifyProblem(e, "재생 상태를 읽지 못했어요.");
  } finally {
    loading.value = false;
  }
}

function retryLoad() {
  loading.value = true;
  loadError.value = "";
  void refresh();
}

// ── 조작 ─────────────────────────────────────────────────────────────────

// 응답을 기다리는 조작. 응답의 상태를 넣고, 거절되면 알리고 다시 읽는다
async function send(key: string, path: string, body: object | undefined, fallback: string): Promise<boolean> {
  const done = await whileBusy(key, async () => {
    try {
      applyState((await axios.post<PlayerState>(`/api/guilds/${guildId}/player/${path}${qs()}`, body)).data);
      return true;
    } catch (e) {
      notifyProblem(e, fallback);
      void refresh();
      return false;
    }
  });
  return done === true;
}

// 넘기기 · 이전은 누른 때의 곡일 때만 하게 줄 번호를 싣는다(그 사이 바뀌면 서버가 거절한다)
const skip = () => send("skip", "skip", onTrackOf(player.value), "다음 곡으로 넘기지 못했어요.");
const previous = () => send("previous", "previous", onTrackOf(player.value), "이전 곡으로 가지 못했어요.");
const shuffle = () => send("shuffle", "shuffle", undefined, "대기열을 섞지 못했어요.");

// 일시정지는 먼저 바꿔 보이고, 거절되면 다시 읽어 되돌린다
function togglePause() {
  if (isBusy("pause")) return;
  const paused = !player.value.paused;
  const track = player.value.currentTrack;
  clock.value = retime(clock.value, Date.now(), { running: Boolean(track && player.value.playing && !paused) });
  player.value = { ...player.value, paused };
  void send("pause", "pause", undefined, "조작하지 못했어요.");
}

// 반복도 먼저 바꿔 보인다. 다음 모드는 디스코드 반복 버튼과 같은 순환(rules/loop-cycle)이고, 정할 값은 서버가 돌려준 상태가 정한다
function cycleLoop() {
  if (isBusy("loop")) return;
  const mode = nextLoopMode(player.value.loop ?? false);
  player.value = { ...player.value, loop: mode };
  void send("loop", "loop", { mode: modeOf(mode) }, "반복 모드를 바꾸지 못했어요.");
}

// 끄는 동안 바로 틀고 끄는 값을 보여 준다(composables/volume-control)
const {
  shown: volumeShown,
  input: volumeInput,
  change: volumeChange,
} = useVolumeControl(
  computed(() => player.value.volume),
  async (level) => {
    const res = await axios.post<PlayerState>(`/api/guilds/${guildId}/player/volume${qs()}`, { volume: level });
    if (res.data?.volume !== undefined) applyState(res.data);
  },
);

function confirmStop() {
  showStopConfirm.value = true;
}

// 정지는 응답을 기다리고 서버가 돌려준 상태를 쓴다. 봇이 나가 음성 칸도 바뀌므로 한 번 더 읽는다
async function doStop() {
  showStopConfirm.value = false;
  if (await send("stop", "stop", undefined, "정지하지 못했어요.")) void refresh();
}

// 입력이 유튜브 재생목록인지(봇이 읽는 규칙 rules/links). "한 곡만 추가" 버튼 노출 조건
const isPlaylistQuery = computed(() => isYouTubePlaylist(addQuery.value.trim()));

// "한 곡만 추가"의 실제 요청 payload. 영상 ID 가 링크에 있으면 재생목록 조회 없이 그 영상만 가리키게 바꾼다(빠름).
// 그 밖(playlist?list= 만)은 single=true 로 첫 곡
function singlePayload(raw: string) {
  const videoId = extractVideoId(raw.trim());
  return videoId ? { query: youtubeWatchUrl(videoId), single: false } : { query: raw.trim(), single: true };
}

async function addTrack(single = false) {
  if (!addQuery.value.trim() || adding.value) return;
  adding.value = true;
  addError.value = "";
  addNotice.value = "";
  addInfo.value = "";
  more.value = null;
  try {
    const payload = single === true ? singlePayload(addQuery.value) : { query: addQuery.value.trim(), single: false };
    const res = await axios.post<AddReply>(`/api/guilds/${guildId}/player/queue${qs()}`, payload, { timeout: LIMIT.long });
    const { dropped: _dropped, queueLimited: _queueLimited, notes, more: nextMore = null, queueMax: max = 0, ...state } = res.data;
    applyState(state);
    queueMax.value = max;
    more.value = nextMore;
    addQuery.value = "";
    // 일부만 넣었으면 디스코드 담은 안내와 같은 경고 줄
    addNotice.value = notes.join("\n");
  } catch (e) {
    addError.value = problemText(e, "추가에 실패했습니다.");
  } finally {
    adding.value = false;
  }
}

async function addMore(count: number) {
  if (!more.value || moreBusy.value) return;
  moreBusy.value = true;
  addError.value = "";
  addNotice.value = "";
  addInfo.value = "";
  try {
    const res = await axios.post<MoreReply>(`/api/guilds/${guildId}/player/queue/more${qs()}`, { ...more.value, count }, { timeout: LIMIT.long });
    const { added: _added, dropped = 0, note, more: nextMore = null, queueMax: max = 0, ...state } = res.data;
    applyState(state);
    queueMax.value = max;
    more.value = nextMore;
    // 디스코드 더 넣기 결과와 같은 글. 대기열이 차서 빠진 곡이 있으면 경고로
    if (dropped > 0) addNotice.value = note;
    else addInfo.value = note;
  } catch (e) {
    addError.value = problemText(e, "추가에 실패했습니다.");
  } finally {
    moreBusy.value = false;
  }
}

async function joinBot() {
  if (joining.value) return;
  joining.value = true;
  addError.value = "";
  try {
    const res = await axios.post<PlayerRead>(`/api/guilds/${guildId}/player/join${qs()}`, undefined, { timeout: LIMIT.long });
    applyState(res.data);
  } catch (e) {
    addError.value = problemText(e, "참가에 실패했습니다.");
  } finally {
    joining.value = false;
  }
}

// 빼기는 그 줄 번호로(그 사이 대기열이 바뀌어도 그 곡). 응답을 기다린다
async function removeTrack(track: QueueTrackView) {
  if (!Number.isInteger(track.entry)) return;
  await whileBusy(`remove:${track.entry}`, async () => {
    try {
      applyState((await axios.delete<PlayerState>(`/api/guilds/${guildId}/player/queue/entry/${track.entry}${qs()}`)).data);
    } catch (e) {
      notifyProblem(e, "곡을 빼지 못했어요.");
      void refresh();
    }
  });
}

// ── 대기열 끌어 옮기기 ───────────────────────────────────────────────────────

function onDragStart(e: DragEvent, i: number) {
  if (!player.value.canControl || isBusy("move")) return;
  draggedIndex.value = i;
  isDragging.value = true;
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function onDragOver(e: DragEvent, i: number) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dragOverIndex.value = e.clientY < rect.top + rect.height / 2 ? i : i + 1;
}

// 끌기가 끝났다(놓음 · 취소). 끄는 동안 미뤄 둔 서버 대기열을 넣는다
function onDragEnd() {
  draggedIndex.value = null;
  dragOverIndex.value = null;
  isDragging.value = false;
  if (heldQueue) {
    player.value = { ...player.value, ...heldQueue };
    heldQueue = null;
    syncLoaded();
  }
}

async function onDrop() {
  const from = draggedIndex.value;
  const insertAt = dragOverIndex.value;
  const queue = player.value.queue;
  const target = from === null || insertAt === null ? "same" : moveTarget(queue, from, insertAt, player.value.queueTotal ?? queue.length);
  // 놓은 자리는 끄는 동안 본 목록 기준이다. 미뤄 둔 서버 대기열을 넣기 전에 정한다
  onDragEnd();
  if (target === "same") return;
  if (target === "partial") return notify({ title: "아직 불러오지 않은 곡이 뒤에 있어요.", body: "대기열을 끝까지 내려 다 불러온 뒤 맨 끝으로 옮길 수 있어요.", severity: "warning" });
  if (target === "unknown" || from === null || insertAt === null) return refresh();
  // 응답을 기다리는 동안 옮긴 차례로 보인다. 거절되면 다시 읽어 서버 차례로 돌린다
  player.value = { ...player.value, queue: reordered(queue, from, insertAt) };
  await send("move", "queue/move-entry", target, "곡을 옮기지 못했어요.");
}

// ── 계산 값 ──────────────────────────────────────────────────────────────────

const isLive = computed(() => !!player.value.currentTrack?.isLive);
// 길이를 알아야 위치를 옮길 수 있다. 라이브에는 실시간밖에 없어 옮길 자리가 없다.
const seekable = computed(() => (player.value.currentTrack?.duration ?? 0) > 0 && !isLive.value);

// 탐색 막대(composables/seek-bar). 놓은 자리를 먼저 보이고 보낸다. 거절되면 다시 읽어 손잡이가 서버 자리로 돌아간다
const seekBar = useSeekBar({
  el: progressBarRef,
  duration: () => player.value.currentTrack?.duration ?? 0,
  enabled: () => seekable.value && Boolean(player.value.canControl),
  entry: () => player.value.currentTrack?.entry ?? null,
  send: (sec, entry) => {
    clock.value = retime(clock.value, Date.now(), { at: sec });
    void send("seek", "seek", { position: sec, ...(Number.isInteger(entry) ? { onTrack: entry } : {}) }, "위치를 옮기지 못했어요.");
  },
});
const isScrubbing = seekBar.dragging;
const displayTime = computed(() => (isScrubbing.value ? seekBar.value.value : positionAt(clock.value, now.value)));

const progressPct = computed(() => {
  const t = player.value.currentTrack;
  if (!t?.duration) return 0;
  return Math.min((displayTime.value / t.duration) * 100, 100);
});

// 카테고리 → SponsorBlock 공식 색상 CSS 변수명 매핑
const SB_COLOR_VAR: Record<SkipCategory, string> = {
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

// SponsorBlock 자동 스킵 구간 → 진행바 상 위치(%) + 카테고리별 공식 색상. 하이라이트 지점도 %로.
const sponsorMarkers = computed(() => {
  const t = player.value.currentTrack;
  const dur = t?.duration || 0;
  if (!dur || !Array.isArray(t?.sponsorSegments)) return [];
  return t.sponsorSegments.map((s) => {
    const left = Math.max(0, Math.min(100, (s.start / dur) * 100));
    const right = Math.max(0, Math.min(100, (s.end / dur) * 100));
    const cat = (s.categories && s.categories[0]) || "music_offtopic";
    // 이름은 봇의 것(rules/sponsor-categories, 디스코드 설정 화면과 같다)
    const label = (s.categories && s.categories.length ? s.categories : [cat]).map(categoryLabel).join(", ");
    return { left, width: Math.max(0.4, right - left), color: `var(--category-${isSkipCategory(cat) ? SB_COLOR_VAR[cat] : "nonmusic"}-color)`, label };
  });
});
const highlightMarker = computed(() => {
  const t = player.value.currentTrack;
  const dur = t?.duration || 0;
  const h = t?.highlightAt;
  if (!dur || h === null || h === undefined) return null;
  return Math.max(0, Math.min(100, (h / dur) * 100));
});

// 반복 버튼의 툴팁: 지금 모드와 누르면 바뀔 모드. 이름표는 디스코드 패널의 반복 버튼과 같다
const loopTitle = computed(() => {
  // 끝이 없는 것은 반복할 수 없다. 왜 못 누르는지 봇의 거절 문장으로 말해 준다
  if (player.value.hasLive) return gate("live-no-loop").title;
  const now = player.value.loop ?? false;
  return `${loopLabel(modeOf(now))} (누르면 ${loopLabel(modeOf(nextLoopMode(now)))})`;
});

// 하이라이트로 가기. 누른 때의 곡일 때만
function jumpToHighlight() {
  const h = player.value.currentTrack?.highlightAt;
  if (h === null || h === undefined) return;
  clock.value = retime(clock.value, Date.now(), { at: h });
  void send("highlight", "highlight", onTrackOf(player.value), "하이라이트로 가지 못했어요.");
}

// ── 도우미 ───────────────────────────────────────────────────────────────────

// 조작이 막힌 까닭. 봇이 디스코드에서 거절할 때와 같은 문장(utils/problem)
const gate = noticeText;

const fmt = (sec: number) => formatDuration(sec);

// 각 서비스를 대표하는 색. 키는 rules/platforms 의 Platform 이라 하나라도 빠지면 타입 검사가 잡는다(빠지면 회색 점이 되어 어디서 온 곡인지 안 보인다)
const PLATFORM_COLORS: Record<Platform, string> = {
  youtube: "#ff0000",
  spotify: "#1db954",
  soundcloud: "#ff5500",
  direct: "var(--accent)",
  lastfm: "#d92323",
  lbradio: "#eb743b", // ListenBrainz 의 --bs-primary
  animethemes: "#ffffff", // 로고 배경
  anisongdb: "#f2a93b", // 사이트 강조색
  vocadb: "#39c5bb", // 미쿠
  utaitedb: "#00688f", // 배경에 박아 둔 Ado 로고의 장미
  touhoudb: "#4f2347", // (구) 공식 트위터 프로필 이미지 배경
};

function platformColor(p: string) {
  return isPlatform(p) ? PLATFORM_COLORS[p] : "#8b93a7";
}

// 실시간 신호는 탭의 목록 연결 하나에서 받는다(stores/guilds). 이 서버의 신호 · 어느 서버인지 모르는 신호(끊긴 뒤 따라잡기 · 끊긴 동안의 주기 읽기)면 다시 읽는다.
// 연달아 조작하면 신호도 연달아 온다. 합쳐서 한 번만 다시 읽는다
const guilds = useGuildsStore();
let offNudge: (() => boolean) | null = null;
onMounted(() => {
  void refresh();
  guilds.subscribe();
  offNudge = onGuildNudge((changed) => {
    if (changed && changed !== guildId) return;
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(refresh, 600);
  });
  ticker = setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => {
  offNudge?.();
  guilds.unsubscribe();
  clearInterval(ticker);
  clearTimeout(nudgeTimer);
});
</script>
