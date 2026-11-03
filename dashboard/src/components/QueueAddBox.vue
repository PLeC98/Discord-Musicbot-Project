<template>
  <!-- 곡 추가(대기열 창 맨 위). 넣을 수 없으면 까닭(봇과 같은 문장), 넣은 결과, 이어 넣을 재생목록 -->
  <div class="shrink-0">
    <NoticeBox v-if="!player.botInVoice && !player.userInVoice" variant="gate" icon="headset_off" icon-class="text-on-surface-variant"
      ><span>{{ noticeText("must-be-in-voice").title }} {{ noticeText("must-be-in-voice").body }}</span></NoticeBox
    >
    <!-- 봇 부르기와 곡 추가 입력란은 같은 칸(48px)이다. 봇이 들어오면 칸은 그대로 두고 모서리와 바탕만 입력란으로 바뀌고, 안은 사라진 뒤 나타난다(커지거나 옮겨 가지 않는다).
         휴대폰은 칸 전체가 부르기 버튼(입력란과 같은 캡슐, 강조색 글), 그보다 넓으면 안내 칸에 글자 버튼(M3 스낵바 배치) -->
    <form v-else-if="!player.botInVoice || (player.hasPlayer && player.canAdd)" @submit.prevent="!calling && addTrack(isPlaylistQuery && addSingle)">
      <!-- 모서리(12 ↔ 24px)는 effects(250ms), 바탕은 effects-slow(350ms). 모서리를 스프링으로 하면 봇이 나가 24 → 12 로 돌아갈 때 12 아래로 넘쳤다 돌아온다.
           입력란은 모서리를 높이의 절반(24px)으로(rounded-full 은 바꾸는 동안 무한대에서 줄어든다). 입력란을 선택하면 캡슐 전체에 후광 -->
      <div class="h-12 overflow-hidden [transition:border-radius_250ms_var(--ease-effects),background-color_350ms_var(--ease-effects),box-shadow_200ms]" :class="calling && !isPhone ? 'rounded-(--r-inner) bg-surface-container-high' : 'rounded-3xl bg-surface-container-highest focus-within:shadow-[0_0_0_2px_var(--md-primary),0_0_18px_2px_color-mix(in_oklab,var(--md-primary)_40%,transparent)]'">
        <Transition mode="out-in" enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity effects" leave-active-class="transition-opacity effects-fast">
          <button v-if="calling && isPhone" key="bar" type="button" class="tap state-layer size-full px-4 flex items-center justify-center gap-2 text-primary text-body font-semibold cursor-pointer disabled:text-on-surface/38 disabled:cursor-not-allowed" :disabled="joining" @click="joinBot">
            <Icon :name="joining ? 'progress_activity' : 'waving_hand'" :size="24" class="shrink-0" :class="joining ? 'animate-spin' : ''" /><span class="truncate">{{ joining ? T.joining : T.joinBotToVoice }}</span>
          </button>
          <div v-else-if="calling" key="note" class="h-full flex items-center justify-between gap-3 pl-4 pr-1 text-sm">
            <span class="flex items-center gap-3 min-w-0"
              ><Icon name="waving_hand" :size="24" class="shrink-0 text-primary" /><span class="truncate">{{ noticeText("bot-not-in-voice").title }}</span></span
            >
            <button type="button" class="tap state-layer shrink-0 h-10 px-3 rounded-xl inline-flex items-center gap-2 text-primary text-body font-medium cursor-pointer disabled:text-on-surface/38 disabled:cursor-not-allowed" :disabled="joining" @click="joinBot"><Icon :name="joining ? 'progress_activity' : 'login'" :size="20" :class="joining ? 'animate-spin' : ''" />{{ joining ? T.joining : T.joinBot }}</button>
          </div>
          <div v-else key="input" class="h-full flex items-center gap-1 pl-3 pr-1">
            <Icon name="add" :size="24" class="text-on-surface-variant shrink-0" />
            <SearchInput v-model="query" class="flex-1 min-w-0 h-full" input-class="w-full h-full bg-transparent px-2 text-sm text-on-surface outline-none placeholder:text-on-surface-variant" :placeholder="T.addPlaceholder" :disabled="adding" />
            <button type="submit" class="tap state-layer size-10 shrink-0 rounded-full flex items-center justify-center bg-primary text-on-primary cursor-pointer disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:cursor-not-allowed" :disabled="adding || !query.trim()" :aria-label="T.addSubmit"><Icon :name="adding ? 'progress_activity' : 'arrow_upward'" :size="24" :class="adding ? 'animate-spin' : ''" /></button>
          </div>
        </Transition>
      </div>
      <!-- 재생목록 링크면 무엇을 넣을지 선택한다(이어 붙은 버튼 그룹). 넣기 버튼은 선택한 쪽으로 넣는다 -->
      <div v-if="!calling && isPlaylistQuery" class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 pl-3">
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
    <!-- 봇은 음성에 있는데 서버에 플레이어가 없다. 디스코드 음성 상태와 봇 내부 상태가 어긋난 경우. 폼을 열어봤자 409이므로 잠근다 -->
    <NoticeBox v-else-if="!player.hasPlayer" variant="gate" icon="sync_problem" icon-class="text-on-surface-variant">{{ text.server.noPlayerState }}</NoticeBox>
    <!-- 봇은 음성 채널에 있는데 사용자는 다른 곳(모더레이터 제외). 곡 추가는 계층과 무관하고 재적 규칙만 본다 -->
    <NoticeBox v-else variant="gate" icon="headphones" icon-class="text-on-surface-variant">{{ noticeText("must-be-in-same-voice").title }}</NoticeBox>
    <NoticeBox v-if="error" variant="note" tone="error" icon="cancel">{{ error }}</NoticeBox>
    <NoticeBox v-else-if="warning" variant="note" tone="notice" icon="info">{{ warning }}</NoticeBox>
    <NoticeBox v-else-if="info" variant="note" tone="info" icon="check_circle" fill>{{ info }}</NoticeBox>
    <PlaylistMore v-if="more && player.canAdd" :more="more" :queue-total="player.queueTotal ?? player.queue.length" :has-current="Boolean(player.currentTrack)" :queue-max="queueMax" :busy="moreBusy" @add="addMore" @close="more = null" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMediaQuery } from "@vueuse/core";
import axios from "axios";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import PlaylistMore from "./PlaylistMore.vue";
import SearchInput from "./SearchInput.vue";
import { noticeText, problemText } from "../utils/problem.ts";
import { LIMIT } from "../utils/request.ts";
import { PHONE_QUERY } from "../utils/breakpoints.ts";
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
// 봇을 부를 칸인가(이 칸에서 봇이 음성 채널에 없으면 사용자는 음성 채널에 있다). 휴대폰은 서버 화면의 바텀 시트와 같은 기준
const calling = computed(() => !props.player.botInVoice);
const isPhone = useMediaQuery(PHONE_QUERY);
// 넣은 결과: 실패, 일부만 넣음(디스코드 담은 안내와 같은 경고), 넣음
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

// 봇 재적, 넣을 수 있는지가 바뀌면 직전 실패는 더 맞지 않는다(봇이 나가 넣기 입력란이 부르기 버튼으로 바뀌는 순간 등)
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
