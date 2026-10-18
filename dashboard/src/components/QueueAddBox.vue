<template>
  <!-- 곡 넣기(대기열 창 맨 위). 넣을 수 없으면 까닭(봇과 같은 문장), 넣은 결과 · 이어 넣을 재생목록 -->
  <div class="shrink-0">
    <NoticeBox v-if="!player.botInVoice && !player.userInVoice" variant="gate" icon="headset_off" icon-class="text-on-surface-variant"
      ><span>{{ noticeText("must-be-in-voice").title }} {{ noticeText("must-be-in-voice").body }}</span></NoticeBox
    >
    <NoticeBox v-else-if="!player.botInVoice && player.userInVoice" variant="gate" class="flex-wrap justify-between">
      <span class="flex items-center gap-3"><Icon name="waving_hand" :size="24" class="shrink-0 text-primary" />{{ noticeText("bot-not-in-voice").title }}</span>
      <BaseButton variant="primary" :disabled="joining" @click="joinBot"><Icon :name="joining ? 'progress_activity' : 'login'" :size="20" :class="joining ? 'animate-spin' : ''" />{{ joining ? T.joining : T.joinBot }}</BaseButton>
    </NoticeBox>
    <!-- 봇은 음성에 있는데 서버에 플레이어가 없다. 디스코드 음성 상태와 봇 내부 상태가 어긋난 경우. 폼을 열어봤자 409이므로 잠근다 -->
    <NoticeBox v-else-if="!player.hasPlayer" variant="gate" icon="sync_problem" icon-class="text-on-surface-variant">{{ text.server.noPlayerState }}</NoticeBox>
    <!-- 봇은 음성 채널에 있는데 사용자는 다른 곳(모더레이터 제외). 곡 추가는 계층과 무관하고 재적 규칙만 본다 -->
    <NoticeBox v-else-if="!player.canAdd" variant="gate" icon="headphones" icon-class="text-on-surface-variant">{{ noticeText("must-be-in-same-voice").title }}</NoticeBox>
    <form v-else @submit.prevent="addTrack(isPlaylistQuery && addSingle)">
      <!-- 선택하면 캡슐 전체에 후광 -->
      <div class="flex items-center gap-1 h-12 pl-3 pr-1 rounded-full bg-surface-container-highest transition-shadow duration-200 focus-within:shadow-[0_0_0_2px_var(--md-primary),0_0_18px_2px_color-mix(in_oklab,var(--md-primary)_40%,transparent)]">
        <Icon name="add" :size="24" class="text-on-surface-variant shrink-0" />
        <input :value="query" @input="query = valueOf($event)" class="flex-1 min-w-0 h-full bg-transparent px-2 text-sm text-on-surface outline-none placeholder:text-on-surface-variant" :placeholder="T.addPlaceholder" :disabled="adding" />
        <button type="submit" class="tap state-layer size-10 shrink-0 rounded-full flex items-center justify-center bg-primary text-on-primary cursor-pointer disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:cursor-not-allowed" :disabled="adding || !query.trim()" :aria-label="T.addSubmit"><Icon :name="adding ? 'progress_activity' : 'arrow_upward'" :size="24" :class="adding ? 'animate-spin' : ''" /></button>
      </div>
      <!-- 재생목록 링크면 무엇을 넣을지 선택한다(이어 붙은 버튼 그룹). 넣기 버튼은 선택한 쪽으로 넣는다 -->
      <div v-if="isPlaylistQuery" class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 pl-3">
        <span class="flex items-center gap-1 text-xs text-on-surface-variant"><Icon name="playlist_play" :size="14" />{{ T.playlistLink }}</span>
        <div class="ml-auto flex gap-0.5" role="radiogroup" :aria-label="T.addWhich">
          <button
            v-for="(opt, i) in playlistModes"
            :key="opt.label"
            type="button"
            role="radio"
            :aria-checked="addSingle === opt.single"
            class="state-layer h-8 px-3 flex items-center gap-1 text-xs font-semibold cursor-pointer transition-[border-radius,background-color,color] spring-fast"
            :class="addSingle === opt.single ? 'bg-secondary-container text-on-secondary-container rounded-2xl' : 'bg-surface-container-highest text-on-surface-variant ' + (i === 0 ? 'rounded-l-2xl rounded-r-sm active:rounded-r-xs' : 'rounded-r-2xl rounded-l-sm active:rounded-l-xs')"
            @click="addSingle = opt.single"
          >
            <Icon v-if="addSingle === opt.single" name="check" :size="18" />{{ opt.label }}
          </button>
        </div>
      </div>
    </form>
    <NoticeBox v-if="error" variant="note" tone="error" icon="cancel">{{ error }}</NoticeBox>
    <NoticeBox v-else-if="warning" variant="note" tone="notice" icon="info">{{ warning }}</NoticeBox>
    <NoticeBox v-else-if="info" variant="note" tone="info" icon="check_circle" fill>{{ info }}</NoticeBox>
    <PlaylistMore v-if="more && player.canAdd" :more="more" :queue-total="player.queueTotal ?? player.queue.length" :has-current="Boolean(player.currentTrack)" :queue-max="queueMax" :busy="moreBusy" @add="addMore" @close="more = null" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import axios from "axios";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import PlaylistMore from "./PlaylistMore.vue";
import { noticeText, problemText } from "../utils/problem.ts";
import { LIMIT } from "../utils/request.ts";
import { valueOf } from "../utils/dom.ts";
import type { PlayerSeen } from "../utils/playback.ts";
import { extractVideoId, isYouTubePlaylist, youtubeWatchUrl } from "../../../src/rules/links.ts";
import type { AddReply, MoreReply, MoreView, PlayerRead, PlayerState } from "../../../src/dashboard/contract/player.ts";
import { text } from "../text/index.ts";
const T = text.server;

/** queueWindow: 대기열을 펼쳐 둔 만큼(응답도 그만큼 싣는다. 안 그러면 목록이 접힌다) */
const props = defineProps<{ guildId: string; player: PlayerSeen; queueWindow: number }>();
/** state: 응답의 재생 상태(부른 쪽이 넣는다) */
const emit = defineEmits<{ state: [state: PlayerState | PlayerRead] }>();

const url = (path: string) => `/api/guilds/${props.guildId}/player/${path}?queue=${props.queueWindow}`;

const query = ref("");
const adding = ref(false);
const joining = ref(false);
// 넣은 결과: 실패 · 일부만 넣음(디스코드 담은 안내와 같은 경고) · 넣음
const error = ref("");
const warning = ref("");
const info = ref("");
// 이어 넣을 수 있는 재생목록. 서버가 준 상태를 그대로 되돌려 보낸다
const more = ref<MoreView | null>(null);
const moreBusy = ref(false);
const queueMax = ref(0);

function clearResult() {
  error.value = "";
  warning.value = "";
  info.value = "";
}

// 봇 재적 · 넣을 수 있는지가 바뀌면 직전 실패는 더 맞지 않는다(봇이 나가 넣기 입력란이 부르기 버튼으로 바뀌는 순간 등)
watch(
  () => [props.player.botInVoice, props.player.canAdd],
  () => (error.value = ""),
);

// 입력이 유튜브 재생목록인지(봇이 읽는 규칙 rules/links)
const isPlaylistQuery = computed(() => isYouTubePlaylist(query.value.trim()));
// 재생목록 링크에서 한 곡만 넣을지. 링크에 영상이 있으면 그 곡, 없으면 첫 곡
const addSingle = ref(false);
const playlistModes = computed(() => [
  { label: T.addWholePlaylist, single: false },
  { label: extractVideoId(query.value.trim()) ? T.addThisOnly : T.addFirstOnly, single: true },
]);
watch(isPlaylistQuery, (isPlaylist) => {
  if (!isPlaylist) addSingle.value = false;
});

// 한 곡만 넣을 때 보낼 것. 영상 ID 가 링크에 있으면 재생목록 조회 없이 그 영상만 가리키게 바꾼다(빠름). 그 밖(playlist?list= 만)은 single 로 첫 곡
function singlePayload(raw: string) {
  const videoId = extractVideoId(raw.trim());
  return videoId ? { query: youtubeWatchUrl(videoId), single: false } : { query: raw.trim(), single: true };
}

async function addTrack(single = false) {
  if (!query.value.trim() || adding.value) return;
  adding.value = true;
  clearResult();
  more.value = null;
  try {
    const payload = single ? singlePayload(query.value) : { query: query.value.trim(), single: false };
    const res = await axios.post<AddReply>(url("queue"), payload, { timeout: LIMIT.long });
    const { dropped: _dropped, queueLimited: _queueLimited, notes, more: nextMore = null, queueMax: max = 0, ...state } = res.data;
    emit("state", state);
    queueMax.value = max;
    more.value = nextMore;
    query.value = "";
    warning.value = notes.join("\n");
  } catch (e) {
    error.value = problemText(e, T.addFailed);
  } finally {
    adding.value = false;
  }
}

async function addMore(count: number) {
  if (!more.value || moreBusy.value) return;
  moreBusy.value = true;
  clearResult();
  try {
    const res = await axios.post<MoreReply>(url("queue/more"), { ...more.value, count }, { timeout: LIMIT.long });
    const { added: _added, dropped = 0, note, more: nextMore = null, queueMax: max = 0, ...state } = res.data;
    emit("state", state);
    queueMax.value = max;
    more.value = nextMore;
    // 디스코드 더 넣기 결과와 같은 글. 대기열이 차서 빠진 곡이 있으면 경고로
    if (dropped > 0) warning.value = note;
    else info.value = note;
  } catch (e) {
    error.value = problemText(e, T.addFailed);
  } finally {
    moreBusy.value = false;
  }
}

async function joinBot() {
  if (joining.value) return;
  joining.value = true;
  error.value = "";
  try {
    emit("state", (await axios.post<PlayerRead>(url("join"), undefined, { timeout: LIMIT.long })).data);
  } catch (e) {
    error.value = problemText(e, T.joinFailed);
  } finally {
    joining.value = false;
  }
}
</script>
