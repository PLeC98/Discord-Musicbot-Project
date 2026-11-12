<template>
  <!-- 곡 추가(대기열 창 맨 위). 넣을 수 없으면 까닭(봇과 같은 문장), 봇이 음성 채널 밖이면 부르기
       - 입력란은 type="search"(안드로이드 키보드 위 자동 채우기 바가 뜨지 않는다), Enter 키 모양은 보내기(넣는 칸이라)
       - 입력: 두 글자 이상이면 검색(/player/search). 친 것이든 붙여넣은 것이든 주소로 보이면(typed-url) 검색하지 않는다
       - 오른쪽: 지우기(×, 글만), 보내기(↑, 늘 있다. 비었으면 꺼진다). 재생목록 주소(믹스도)면 ↑ 왼쪽에 "한 곡만"이 붙어 이어 붙은 버튼 둘이 된다
       - 패널 셋이 입력란 아래, 대기열 위에 겹쳐 뜬다(대기열을 밀지 않는다). 메뉴처럼 들어오고 나간다. 높이는 창(시트) 바닥과 화면 키보드 위까지
         검색 결과(맨 위 층): 방향키로 고르고(처음엔 첫 줄) Enter, 클릭, ↑ 로 넣는다. 없거나 실패하면 그 까닭. 포커스가 빠지면 닫고, 쳐서 띄운 검색어면 돌아올 때 다시 연다
         넣은 곡 한 줄: 잠깐 뒤에, 무언가 치면, 닫기로 닫힌다. 문장은 디스코드 추가 안내와 같다(added-parts)
         더 넣기: 재생목록을 넣으면 뜨고 넣은 결과는 그 제목 자리에. 다른 곡을 넣으면 닫는다
       - 보내면 입력란은 바로 비우고 포커스를 둔다. 넣는 동안 ↑ 가 돈다. 넣지 못하면 알림, 링크가 잘못된 게 아니면 그 링크를 입력란에 되돌린다. 다 넣지 못했으면 경고 알림(디스코드 추가 안내와 같은 문장)
       - 결과가 떠 있지 않거나(한 글자, 결과를 닫은 뒤) 결과가 없거나 검색이 실패한 검색어를 보내면 봇이 찾아 1위를 넣는다(/play 와 같다)
       - 휴대폰 시트 안이면 입력란을 누를 때 시트를 끝까지 펼친다. Esc 는 지우고 포커스를 푼다(한 번 더 누르면 시트가 접힌다) -->
  <div ref="root" class="shrink-0 relative" :class="covered && '[&~*]:[--sb-thumb-color:transparent]'">
    <NoticeBox v-if="!player.botInVoice && !player.userInVoice" variant="gate" icon="headset_off" icon-class="text-on-surface-variant"
      ><span>{{ noticeText("must-be-in-voice").title }} {{ noticeText("must-be-in-voice").body }}</span></NoticeBox
    >
    <!-- 봇 부르기와 곡 추가 입력란은 같은 칸(48px)이다. 봇이 들어오면 칸은 그대로 두고 모서리와 바탕만 입력란으로 바뀌고, 안은 사라진 뒤 나타난다(커지거나 옮겨 가지 않는다).
         휴대폰은 칸 전체가 부르기 버튼(입력란과 같은 캡슐, 강조색 글), 그보다 넓으면 안내 칸에 글자 버튼(M3 스낵바 배치) -->
    <template v-else-if="!player.botInVoice || (player.hasPlayer && player.canAdd)">
      <!-- 모서리(12 ↔ 24px)는 effects(250ms), 바탕은 effects-slow(350ms). 입력란은 모서리를 높이의 절반(24px)으로 직접 적는다. 입력란을 선택하면 캡슐 전체에 후광 -->
      <div class="h-12 overflow-hidden [transition:border-radius_250ms_var(--ease-effects),background-color_350ms_var(--ease-effects),box-shadow_250ms_var(--ease-effects)]" :class="calling && !isPhone ? 'rounded-(--r-inner) bg-surface-container-high' : 'rounded-[1.5rem] bg-surface-container-highest focus-within:shadow-[0_0_0_2px_var(--md-primary),0_0_18px_2px_color-mix(in_oklab,var(--md-primary)_40%,transparent)]'">
        <Transition mode="out-in" enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity effects" leave-active-class="transition-opacity effects-fast">
          <button v-if="calling && isPhone" key="bar" type="button" class="tap state-layer size-full px-4 flex items-center justify-center gap-2 text-primary text-body font-semibold cursor-pointer disabled:text-on-surface/38 disabled:cursor-not-allowed" :disabled="joining" @click="joinBot">
            <Icon :name="joining ? 'progress_activity' : 'waving_hand'" :size="24" class="shrink-0" :class="joining ? 'animate-spin' : ''" /><span class="truncate">{{ joining ? T.joining : T.joinBotToVoice }}</span>
          </button>
          <div v-else-if="calling" key="note" class="h-full flex items-center justify-between gap-3 pl-4 pr-1 text-sm">
            <span class="flex items-center gap-3 min-w-0"
              ><Icon name="waving_hand" :size="24" class="shrink-0 text-primary" /><span class="truncate">{{ noticeText("bot-not-in-voice").title }}</span></span
            >
            <BaseButton type="button" variant="text" class="shrink-0" :disabled="joining" @click="joinBot"><Icon :name="joining ? 'progress_activity' : 'login'" :size="20" :class="joining ? 'animate-spin' : ''" />{{ joining ? T.joining : T.joinBot }}</BaseButton>
          </div>
          <div v-else key="input" class="h-full flex items-center gap-1 pl-3 pr-1">
            <Icon name="search" :size="24" class="text-on-surface-variant shrink-0" />
            <input
              ref="inputEl"
              :value="query"
              type="search"
              enterkeyhint="send"
              class="flex-1 min-w-0 h-full bg-transparent px-2 [&::-webkit-search-cancel-button]:appearance-none text-sm text-on-surface outline-none placeholder:text-on-surface-variant"
              :placeholder="T.addPlaceholder"
              autocomplete="off"
              role="combobox"
              aria-autocomplete="list"
              :aria-expanded="open"
              :aria-controls="listId"
              :aria-activedescendant="open && results?.length ? `${listId}-${active}` : undefined"
              @input="onInput"
              @keydown="onKey"
              @focus="onFocus"
              @blur="open = false"
            />
            <!-- 버튼과 패널은 누르는 동안 입력란 포커스를 둔다(mousedown). 포커스가 빠지면 결과가 닫힌다 -->
            <button v-if="query" type="button" :class="iconButton(32)" :aria-label="text.fields.searchClear" v-tooltip="text.fields.searchClear" @mousedown.prevent @click="clear"><Icon name="close" :size="20" /></button>
            <div class="shrink-0 flex items-center" @mousedown.prevent>
              <!-- "한 곡만"은 폭을 넓히며 나오고 ↑ 의 왼쪽 모서리가 이어 붙은 모양으로 바뀐다. 폭의 상한은 넘기는 동안에만 둔다(평소 클래스에 두면 시작값 max-w-0 을 이겨 단번에 바뀐다) -->
              <Transition enter-from-class="max-w-0 opacity-0" enter-to-class="max-w-24" enter-active-class="transition-[max-width,opacity] spring-fast" leave-from-class="max-w-24" leave-active-class="transition-[max-width,opacity] effects-fast" leave-to-class="max-w-0 opacity-0">
                <span v-if="link?.list" class="flex overflow-hidden">
                  <button type="button" class="tap state-layer h-10 px-3 mr-0.5 flex items-center text-sm font-medium whitespace-nowrap cursor-pointer bg-secondary-container text-on-secondary-container disabled:cursor-not-allowed disabled:bg-on-surface/12 disabled:text-on-surface/38" :class="shapeOf(0)" :disabled="busy" @click="send(true)">{{ T.addOne }}</button>
                </span>
              </Transition>
              <button type="button" class="tap state-layer size-10 flex items-center justify-center cursor-pointer bg-primary text-on-primary disabled:cursor-not-allowed disabled:bg-on-surface/12 disabled:text-on-surface/38" :class="[shapeOf(link?.list ? 1 : 0), canFirst && 'mr-0.5']" :disabled="sendOff" :aria-label="T.addSubmit" @click="submit(false)">
                <Icon :name="adding ? 'progress_activity' : 'arrow_upward'" :size="24" :class="adding && 'animate-spin'" />
              </button>
              <!-- 넣을 자리(DJ 만). ↑ 와 이어 붙은 분할 버튼 -->
              <MoreMenu v-if="canFirst" :items="placeItems" :label="T.addPlace" icon="expand_more" :disabled="sendOff" keep-focus :button-class="['tap state-layer h-10 w-7 flex items-center justify-center cursor-pointer bg-primary text-on-primary disabled:cursor-not-allowed disabled:bg-on-surface/12 disabled:text-on-surface/38', shapeOf(segments - 1)]" @open="menuOpen = $event" />
            </div>
          </div>
        </Transition>
      </div>

      <!-- 더 넣기. 패널의 바탕이 반투명이라 불투명한 판(pane-menu)을 받친다 -->
      <Transition name="menu">
        <div v-if="more && player.canAdd" :class="[PANEL, 'z-5 rounded-3xl pane-menu']">
          <PlaylistMore class="mt-0!" :more="more" :queue-total="player.queueTotal ?? player.queue.length" :has-current="Boolean(player.currentTrack)" :queue-max="queueMax" :busy="moreBusy" :added="moreAdded ?? undefined" @add="addMore" @close="more = null" />
        </div>
      </Transition>

      <!-- 넣은 곡 한 줄. 곡 이름만 줄여 뒤 문장은 늘 보인다. 이름이 없는 문장(재생목록)은 두 줄까지 -->
      <Transition name="menu">
        <div v-if="added" role="status" :class="[PANEL, 'z-5 p-1 rounded-lg pane-menu']">
          <div class="h-14 pl-3 pr-1 flex items-center gap-3">
            <TrackArt :track="added" size-class="size-10 rounded-sm" :icon-size="20" />
            <span class="flex-1 min-w-0 flex text-sm"
              ><span v-if="added.name" class="truncate font-medium">{{ added.name }}</span
              ><span :class="added.name ? 'shrink-0 whitespace-pre' : 'line-clamp-2'">{{ added.rest }}</span></span
            >
            <TimerClose :ms="ADDED_MS" :round="added" @mousedown.prevent @close="added = null" />
          </div>
        </div>
      </Transition>

      <!-- 검색 결과. 창(시트) 바닥과 화면 키보드 위를 넘지 않고 안에서 스크롤. 키보드가 열리고 닫혀 높이가 바뀌면 단번에 바꾸지 않고 줄고 늘어난다(effects). 드롭다운 목록(SelectPanel)과 같은 모양:
           판 모서리 16, 목록 여백 4, 행 모서리 4(맨 위, 맨 아래 행의 바깥쪽은 16 - 4 = 12), 스크롤바 트랙은 둥근 끝을 r - 5 비우고, 넘치면 오른쪽 여백을 1px 로 -->
      <Transition name="menu">
        <div v-if="open" :class="[PANEL, 'z-10 flex flex-col overflow-hidden rounded-lg pane-menu transition-[max-height] effects']" :style="{ maxHeight: `${panelMax}px` }" @mousedown.prevent>
          <div :id="listId" ref="dropEl" role="listbox" :aria-busy="!results && !failure" class="min-h-0 overflow-y-auto overscroll-contain flex flex-col [&::-webkit-scrollbar-track]:my-(--sb-inset-menu) *:rounded-xs [&>*:first-child]:rounded-t-md [&>*:last-child]:rounded-b-md" :class="overflowing ? 'py-1 pl-1 pr-px' : 'p-1'">
            <!-- 결과 대신: 결과 없음, 연령 인증 안내만 옴, 요청 제한, 그 밖의 실패. 실패는 끝 줄에 오류 코드(제보받은 운영자가 원인을 좁히게) -->
            <div v-if="message" role="status" class="shrink-0 px-3 py-3 flex flex-col gap-0.5">
              <span class="text-sm text-on-surface">{{ message.title }}</span>
              <span v-if="message.hint" class="text-xs text-on-surface-variant">{{ message.hint }}</span>
              <span v-if="message.codeLine" class="text-xs text-on-surface-variant nums">{{ message.codeLine }}</span>
            </div>
            <div v-else-if="!results" class="shrink-0 h-14 flex items-center justify-center text-on-surface-variant"><Icon name="progress_activity" :size="24" class="animate-spin" /></div>
            <div v-for="(track, i) in results ?? []" :id="`${listId}-${i}`" :key="track.url" :data-i="i" role="option" :aria-selected="i === active" class="shrink-0 h-14 px-3 flex items-center gap-3 cursor-pointer" :class="i === active && 'bg-on-surface/10'" @mousemove="active = i" @click="pick(i)">
              <TrackArt :track="track" size-class="size-10 rounded-sm" :icon-size="20" />
              <span class="flex-1 min-w-0 flex flex-col">
                <span class="text-sm font-medium truncate">{{ songTitle(track.title) }}</span>
                <!-- 방송 중은 대기열 행처럼 길이 자리에 라이브 -->
                <span class="text-xs text-on-surface-variant truncate flex items-center gap-1"
                  ><span class="size-2 rounded-full shrink-0" :style="{ backgroundColor: platformColor(track.platform) }"></span><span v-if="track.artist" class="truncate">{{ track.artist }}</span
                  ><span v-if="lengthOf(track)" class="nums shrink-0"><template v-if="track.artist">· </template>{{ lengthOf(track) }}</span></span
                >
              </span>
              <span v-if="track.inQueue" class="h-6 px-3 rounded-full bg-surface-container-highest text-xs font-semibold text-on-surface-variant inline-flex items-center gap-1 shrink-0"><Icon name="queue_music" :size="14" />{{ T.inQueue }}</span>
              <!-- 맨 앞에 넣기(DJ 만). 휴대폰은 늘, 그보다 넓으면 고른 줄(마우스를 올린 줄)에만 보인다. 자리는 늘 잡아 두어 줄이 흔들리지 않는다 -->
              <button v-if="canFirst" type="button" :class="[iconButton(32), !isPhone && i !== active && 'invisible']" :aria-label="T.addFirst" v-tooltip="T.addFirst" @click.stop="pick(i, true)"><Icon name="queue_play_next" :size="20" /></button>
            </div>
          </div>
        </div>
      </Transition>
    </template>
    <!-- 봇은 음성에 있는데 서버에 플레이어가 없다. 디스코드 음성 상태와 봇 내부 상태가 어긋난 경우. 폼을 열어봤자 409이므로 잠근다 -->
    <NoticeBox v-else-if="!player.hasPlayer" variant="gate" icon="sync_problem" icon-class="text-on-surface-variant">{{ text.server.noPlayerState }}</NoticeBox>
    <!-- 봇은 음성 채널에 있는데 사용자는 다른 곳(서버 관리자 제외). 곡 추가는 계층과 무관하고 동일 음성 채널 규칙만 본다 -->
    <NoticeBox v-else variant="gate" icon="headphones" icon-class="text-on-surface-variant">{{ noticeText("must-be-in-same-voice").title }}</NoticeBox>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { useMediaQuery, useResizeObserver } from "@vueuse/core";
import axios from "axios";
import Icon from "./BaseIcon.vue";
import BaseButton from "./BaseButton.vue";
import MoreMenu from "./MoreMenu.vue";
import NoticeBox from "./NoticeBox.vue";
import PlaylistMore from "./PlaylistMore.vue";
import TrackArt from "./TrackArt.vue";
import TimerClose from "./TimerClose.vue";
import { notify, notifyProblem } from "../composables/toasts.ts";
import { useOverflowing } from "../composables/overflowing.ts";
import { iconButton } from "../utils/icon-button.ts";
import { platformColor } from "../utils/platform-color.ts";
import { segmentShape } from "../utils/segment.ts";
import { codeLineOf, noticeText, unansweredCode } from "../utils/problem.ts";
import { LIMIT, failureKind, problemCodeOf, replyOf, statusOf } from "../utils/request.ts";
import { PHONE_QUERY } from "../utils/breakpoints.ts";
import type { PlayerSeen } from "../utils/playback.ts";
import { SHEET_EXPAND } from "../utils/sheet-expand.ts";
import { typedUrl } from "../utils/typed-url.ts";
import { text } from "../text/index.ts";
import { extractVideoId, isHttpLink, parseSoundCloud, parseSpotify, parseYouTube, youtubeWatchUrl } from "../../../src/rules/links.ts";
import { graphemeLength } from "../../../src/rules/clip-text.ts";
import { formatDuration } from "../../../src/ui/format.ts";
import * as labels from "../../../src/ui/text/ko/labels.ts";
import { addedParts, type AddedTracks } from "../../../src/ui/text/ko/added-parts.ts";
import { SEARCH_MAX_LEN, SEARCH_MIN_LEN } from "../../../src/rules/limits.ts";
import type { AddReply, AddedSummary, MoreReply, MoreView, PlayerRead, PlayerState, SearchReply, SearchTrack } from "../../../src/dashboard/contract/player.ts";
const T = text.server;
const P = text.player;
const songTitle = labels.songTitle;

/** queueWindow: 대기열을 펼쳐 둔 만큼(응답도 그만큼 싣는다. 안 그러면 목록이 접힌다) */
const props = defineProps<{ guildId: string; player: PlayerSeen; queueWindow: number }>();
/** state: 응답의 재생 상태(부른 쪽이 넣는다) */
const emit = defineEmits<{ state: [state: PlayerState | PlayerRead] }>();

/** 넣은 곡 한 줄이 떠 있는 시간(ms). 됨 알림과 같다 */
const ADDED_MS = 4000;
/** 패널 셋의 자리: 입력란(48) 바로 아래, 위쪽 가장자리를 기준으로 커진다 */
const PANEL = "absolute top-13 inset-x-0 origin-top";
/** 링크 자체가 잘못돼 다시 넣어도 안 되는 거절. 그 밖(요청 제한, 연결 오류 등)은 같은 링크로 다시 해 볼 수 있다 */
const WRONG_LINK: ReadonlySet<string> = new Set(["yt-unplayable", "unsupported-link", "sc-unsupported", "shoutcast-v1"]);

const url = (path: string) => `/api/guilds/${props.guildId}/player/${path}?queue=${props.queueWindow}`;
// 봇을 부를 칸인가(이 칸에서 봇이 음성 채널에 없으면 사용자는 음성 채널에 있다). 휴대폰은 서버 화면의 바텀 시트와 같은 기준
const calling = computed(() => !props.player.botInVoice);
const isPhone = useMediaQuery(PHONE_QUERY);
// 휴대폰 대기열 시트 안이면 시트를 끝까지 펼치는 손잡이
const expandSheet = inject(SHEET_EXPAND, null);

// ── 입력란 ──

const query = ref("");
const inputEl = ref<HTMLInputElement | null>(null);
// 지금 글이 결과를 띄운 검색어인가(포커스가 돌아오면 다시 연다. 되돌린 링크처럼 넣어 둔 글은 열지 않는다)
let typed = false;

// 입력란의 주소. 스킴을 뺀 주소는 https:// 를 붙여 보낸다(봇은 스킴 없는 주소를 검색어로 받는다). url 이 없으면 아직 주소가 덜 됐다(https:// 까지만).
// list: 재생목록을 가리킨다(유튜브 재생목록, 믹스, 스포티파이 앨범, 재생목록, 사운드클라우드 세트). 봇의 링크 규칙(rules/links)으로 본다
const link = computed(() => {
  const now = query.value.trim();
  if (!typedUrl(now)) return null;
  const full = /^[a-z][\w+.-]*:/i.test(now) ? now : `https://${now}`;
  if (!isHttpLink(full) && !parseSpotify(full)) return { url: null, list: false };
  const sp = parseSpotify(full);
  const list = Boolean(parseYouTube(full)?.listId) || (sp !== null && sp.type !== "track") || parseSoundCloud(full)?.kind === "set";
  return { url: full, list };
});

// 글을 지운다(지우기 버튼). 포커스는 둔다
function clear() {
  closeResults();
  typed = false;
  query.value = "";
}

// ── 검색 결과 ──

const open = ref(false);
const results = ref<SearchTrack[] | null>(null);
// 유튜브가 연령 인증 안내만 주었다
const gated = ref(false);
// 검색이 실패했다. code 는 오류 코드(문제 응답의 코드, 응답이 없으면 화면의 코드, 둘 다 아니면 없음), status 는 HTTP 상태
const failure = ref<{ code?: string; status?: number } | null>(null);
// 고른 결과(처음엔 첫 줄)
const active = ref(0);
// 결과 목록과 줄의 id(입력란이 지금 고른 줄을 가리킨다)
const listId = useId();
const dropEl = ref<HTMLElement | null>(null);
const overflowing = useOverflowing(dropEl);
// 결과가 떠 있는 검색어
let searched = "";
let token = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
// 나가 있는 검색. 새로 치면 끊는다
let inFlight: AbortController | null = null;

// 결과 대신 보일 글. 결과 없음, 연령 인증은 디스코드 /search 와 같은 문장. 실패는 끝 줄에 대시보드의 다른 오류와 같은 꼴의 오류 코드
const message = computed(() => {
  if (failure.value) {
    const { code, status } = failure.value;
    return { ...(code === "rate-limited" ? T.searchLimited : T.searchFailed), codeLine: code ? codeLineOf(code, status) : "" };
  }
  if (results.value?.length !== 0) return null;
  const { title, body } = noticeText(gated.value ? "search-age-gated" : "no-search-results");
  return { title, hint: gated.value ? body : "", codeLine: "" };
});
// 길이 글(대기열 행과 같다): 라이브는 라이브(시작 전이면 예정된 라이브), 모르면 뺀다
const lengthOf = (track: SearchTrack) => (track.isLive ? (track.upcoming ? P.upcoming : P.live) : formatDuration(track.duration, "") || null);

// 서버와 같은 기준. 상한을 넘는 글은 찾지 않는다(보내면 곡 추가로 간다)
const searchable = (now: string) => graphemeLength(now) >= SEARCH_MIN_LEN && now.length <= SEARCH_MAX_LEN && !typedUrl(now);
function onInput(event: Event) {
  added.value = null;
  // 값은 v-model 이 아니라 입력 이벤트에서 바로 받는다. v-model 은 한글 조합이 끝나야 값을 넘겨, 조합 중인 첫 글자에서는 지우기, 보내기가 켜지지 않는다
  query.value = (event.target as HTMLInputElement).value;
  const now = query.value.trim();
  // 붙여넣은 것도 내용으로 본다(곡 제목을 붙여넣었을 수 있다). 주소면 검색하지 않는다
  const show = searchable(now);
  typed = show;
  // 한글은 조합을 끝낼 때(방향키, Enter) 같은 글로 input 이 한 번 더 온다. 검색어가 그대로면 결과와 고른 줄을 둔다
  if (show && open.value && now === searched) return;
  closeResults();
  if (!show) return;
  open.value = true;
  search(now, 300);
}
// 휴대폰 시트를 끝까지 펼친다. 포커스가 돌아오면 쳐서 띄웠던 결과를 다시 연다(받아 둔 결과가 그 검색어 것이면 그대로)
function onFocus() {
  expandSheet?.();
  const now = query.value.trim();
  if (!typed || open.value || !searchable(now)) return;
  if (searched === now && (results.value || failure.value)) {
    open.value = true;
    return;
  }
  closeResults();
  open.value = true;
  search(now, 0);
}
function search(now: string, delay: number) {
  searched = now;
  const mine = token;
  timer = setTimeout(async () => {
    const own = new AbortController();
    inFlight = own;
    try {
      const { data } = await axios.get<SearchReply>(`/api/guilds/${props.guildId}/player/search`, { params: { q: now }, timeout: LIMIT.short, signal: own.signal });
      if (mine !== token) return;
      results.value = data.tracks;
      gated.value = data.gated;
      if (!waiting.value) return;
      // 기다리던 보내기: 고른 줄, 결과가 없으면 봇에게 그 글을
      waiting.value = false;
      if (data.tracks.length) pick(active.value, waitingFirst);
      else void sendText(waitingFirst);
    } catch (e) {
      const kind = failureKind(e);
      if (mine !== token || kind === "aborted") return;
      failure.value = { code: problemCodeOf(replyOf(e)) ?? (kind ? unansweredCode(kind) : undefined), status: statusOf(e) };
      if (!waiting.value) return;
      waiting.value = false;
      void sendText(waitingFirst);
    } finally {
      if (inFlight === own) inFlight = null;
    }
  }, delay);
}
function closeResults() {
  token++;
  clearTimeout(timer);
  inFlight?.abort();
  inFlight = null;
  open.value = false;
  results.value = null;
  active.value = 0;
  searched = "";
  waiting.value = false;
  gated.value = false;
  failure.value = null;
}

// ── 키보드 ──

type Action = "down" | "up" | "pick";
const KEYS: Record<string, Action> = { ArrowDown: "down", ArrowUp: "up", Enter: "pick", NumpadEnter: "pick" };
function onKey(event: KeyboardEvent) {
  // 조합 중에 눌린 키는 입력기가 글자를 끝내는 데 쓰고, 끝낸 뒤 같은 키를 한 번 더 보낸다(크롬, 윈도우 한글 입력기). 그쪽만 받는다
  if (event.isComposing) return;
  // 넣을 자리 메뉴가 열려 있으면 키는 메뉴 몫이다. Esc 는 막지 않아 메뉴가 닫히고(close-layer), 그 밖(Enter 등)은 보내지 않는다
  if (menuOpen.value) {
    if (event.key !== "Escape") event.preventDefault();
    return;
  }
  // Esc 는 막아서(preventDefault) 시트, 판이 함께 닫히지 않게 한다(close-layer). 포커스가 풀린 뒤의 Esc 는 시트를 접는다
  if (event.key === "Escape") {
    event.preventDefault();
    clear();
    inputEl.value?.blur();
    return;
  }
  // key 가 Process 로 오면 자리(code)로 읽는다
  const action = KEYS[event.key === "Process" ? event.code : event.key];
  if (!action) return;
  // Shift+Enter 는 맨 앞에(DJ 만. 아니면 Enter 와 같다)
  const first = action === "pick" && event.shiftKey && canFirst.value;
  // 결과가 떠 있지 않으면 Enter 는 보내기(↑)와 같다
  if (!open.value) {
    if (action !== "pick" || !query.value.trim()) return;
    event.preventDefault();
    submit(first);
    return;
  }
  event.preventDefault();
  act(action, first);
}
function act(action: Action, first = false) {
  if (action === "pick") {
    // 넣는 중이면 끝날 때까지 받지 않는다(기다리게 걸어 두면 결과가 와도 넣지 못해 보내기가 계속 돈다)
    if (busy.value) return;
    // 실패했거나 결과가 없으면 봇에게 그 검색어를 보낸다(봇의 검색이 찾을 수도 있다. 찾으면 1위를 넣는다)
    if (failure.value || results.value?.length === 0) void sendText(first);
    else if (results.value) void pick(active.value, first);
    else {
      waiting.value = true;
      waitingFirst = first;
    }
    return;
  }
  if (!results.value?.length) return;
  active.value = Math.min(Math.max(active.value + (action === "down" ? 1 : -1), 0), results.value.length - 1);
  void nextTick(() => dropEl.value?.querySelector(`[data-i="${active.value}"]`)?.scrollIntoView({ block: "nearest" }));
}

// ── 넣기 ──

// 넣는 중. waiting: 결과가 오기 전에 Enter, 보내기를 눌렀다(오면 고른 줄을 넣는다)
const busy = ref(false);
const waiting = ref(false);
// 기다리던 보내기가 맨 앞에 넣기인가
let waitingFirst = false;
// 보내기가 도는 때
const adding = computed(() => waiting.value || busy.value);
const sendOff = computed(() => adding.value || (link.value ? !link.value.url : !query.value.trim()));
// 이어 넣을 수 있는 재생목록. 서버가 준 상태를 그대로 되돌려 보낸다
const more = ref<MoreView | null>(null);
// 넣기를 보낼 때마다 오른다. 그사이 온 이어 넣기 응답은 닫은 더 넣기 패널을 되살리지 않는다
let sent = 0;
const moreBusy = ref(false);
const queueMax = ref(0);

// ── 넣을 자리 ──
// first: 대기열 맨 앞에(/playfirst). DJ 만(canControl. 서버도 같은 기준으로 다시 본다). 보내는 길마다 끝까지 들고 간다

const canFirst = computed(() => props.player.canControl === true);
// ↑ 와 이어 붙은 버튼 수(한 곡만, ↑, 넣을 자리)와 index 번째의 모양. 하나뿐이면 둥근 단추
const segments = computed(() => (link.value?.list ? 1 : 0) + 1 + (canFirst.value ? 1 : 0));
const shapeOf = (index: number) => (segments.value === 1 ? "motion-toggle rounded-xl" : segmentShape(false, index, segments.value));
// 넣을 자리 메뉴가 열려 있다(키 입력을 메뉴에 양보한다)
const menuOpen = ref(false);
const placeItems = computed(() => [{ label: T.addLast, icon: "arrow_upward" as const, select: () => submit(false) }, { label: T.addFirst, icon: "queue_play_next" as const, select: () => submit(true) }, ...(link.value?.list ? [{ label: T.addOneFirst, icon: "queue_play_next" as const, select: () => send(true, true) }] : [])]);
// 보내기(↑, 메뉴): 주소면 그것 전부, 아니면 고른 결과나 그 글
function submit(first: boolean) {
  if (link.value) send(false, first);
  else sendQuery(first);
}

// 고른 결과(처음엔 맨 위)를 넣는다. 결과가 떠 있지 않으면(한 글자, 결과를 닫은 뒤) 봇에게 그대로 보낸다(/play 와 같다)
function sendQuery(first = false) {
  if (!query.value.trim() || adding.value) return;
  if (open.value) return act("pick", first);
  void sendText(first);
}
const sendText = (first = false) => request({ query: query.value.trim(), single: false, first }, "");
// 결과 하나를 넣는다. 그 곡의 주소를 보낸다(디스코드 /search 의 선택과 같다)
function pick(i: number, first = false) {
  const track = results.value?.[i];
  if (!track || busy.value) return;
  void request({ query: track.url, single: false, first }, track.url);
}
// 주소를 넣는다. one: 한 곡만(곡 + 목록 주소면 그 곡, 목록만이면 첫 곡), 아니면 주소가 가리키는 것 전부(목록은 첫 배치)
function send(one: boolean, first = false) {
  const target = link.value?.url;
  if (!target || busy.value) return;
  void request({ ...(one ? singlePayload(target) : { query: target, single: false }), first }, target);
}
// 한 곡만 넣을 때 보낼 것. 영상 ID 가 링크에 있으면 재생목록 조회 없이 그 영상만 가리키게 바꾼다(빠름). 그 밖(playlist?list= 만)은 single 로 첫 곡
function singlePayload(raw: string) {
  const videoId = extractVideoId(raw);
  return videoId ? { query: youtubeWatchUrl(videoId), single: false } : { query: raw, single: true };
}

// 보낸다. 입력란을 바로 비우고(포커스는 둔다) 더 넣기 패널을 닫는다(넣은 곡 한 줄과 겹친다. 재생목록이면 새 패널이 뜬다).
// retry: 넣지 못했을 때 입력란에 되돌릴 링크
async function request(payload: { query: string; single: boolean; first: boolean }, retry: string) {
  if (busy.value) return;
  clear();
  more.value = null;
  sent++;
  busy.value = true;
  try {
    const res = await axios.post<AddReply>(url("queue"), payload, { timeout: LIMIT.long });
    const { dropped: _dropped, queueLimited: _queueLimited, shortfall, more: nextMore = null, queueMax: max = 0, added: summary, ...state } = res.data;
    emit("state", state);
    queueMax.value = max;
    more.value = nextMore;
    // 다 넣지 못했다(대기열이 찼다, 받을 수 없는 곡을 뺐다): 경고 알림. 문장은 디스코드 추가 안내와 같다
    if (shortfall) notify({ title: shortfall.title, body: shortfall.lines.join("\n"), severity: "warning" });
    if (summary?.count) {
      const line = lineOf(summary, payload.first);
      // 더 넣을 곡이 남았으면 결과는 더 넣기 패널에(제목 자리라 끝 마침표는 뗀다), 아니면 넣은 곡 한 줄로
      if (nextMore) moreAdded.value = line.rest.replace(/\.$/, "");
      else showAdded(line);
    }
  } catch (e) {
    failed(e, retry);
  } finally {
    busy.value = false;
  }
}
// 넣지 못했다: 알림(봇과 같은 문장). 링크 자체가 잘못된 것이 아니면 다시 해 볼 수 있게 그 링크를 입력란에 되돌린다(검색 결과는 그 곡의 링크로).
// 그사이 다음 곡을 치고 있으면 두지 않는다
function failed(e: unknown, retry: string) {
  notifyProblem(e, T.addFailed);
  if (!retry || query.value || WRONG_LINK.has(problemCodeOf(replyOf(e)) ?? "")) return;
  query.value = retry;
}

async function addMore(count: number) {
  if (!more.value || moreBusy.value) return;
  moreAdded.value = null;
  moreBusy.value = true;
  const mine = sent;
  try {
    const res = await axios.post<MoreReply>(url("queue/more"), { ...more.value, count }, { timeout: LIMIT.long });
    const { added: _added, dropped = 0, note, more: nextMore = null, queueMax: max = 0, ...state } = res.data;
    emit("state", state);
    queueMax.value = max;
    if (mine === sent) more.value = nextMore;
    // 디스코드 더 넣기 결과와 같은 글. 대기열이 차서 빠진 곡이 있으면 경고로
    notify({ title: note, severity: dropped > 0 ? "warning" : "success" });
  } catch (e) {
    notifyProblem(e, T.addFailed);
  } finally {
    moreBusy.value = false;
  }
}

const joining = ref(false);
async function joinBot() {
  if (joining.value) return;
  joining.value = true;
  try {
    emit("state", (await axios.post<PlayerRead>(url("join"), undefined, { timeout: LIMIT.long })).data);
  } catch (e) {
    notifyProblem(e, T.joinFailed);
  } finally {
    joining.value = false;
  }
}

// ── 넣은 결과 ──

// 넣은 곡 한 줄: 그림, 곡 이름(한 곡일 때), 나머지 문장(디스코드 추가 안내와 같은 문장)
type AddedLine = { thumbnail: string | null; name: string | null; rest: string };
const added = ref<AddedLine | null>(null);
const showAdded = (line: AddedLine) => (added.value = line);
// 넣은 첫 곡의 제목, 그림은 응답의 요약에서(응답의 대기열은 펼쳐 둔 만큼만 실어 긴 대기열 끝에 넣은 곡이 없을 수 있다)
function lineOf(summary: AddedSummary, first: boolean): AddedLine {
  const addition: AddedTracks = {
    tracks: summary.collection ? Array.from({ length: summary.count }, () => ({})) : [{ title: summary.title }],
    collection: summary.collection ? labels.collection(summary.collection) : null,
    total: summary.total,
    first,
    position: summary.position,
  };
  const { name, rest } = addedParts(addition);
  return { thumbnail: summary.thumbnail, name, rest };
}

// 재생목록 첫 배치를 넣은 결과 문장(더 넣기 패널의 제목 자리). 더 넣거나 패널이 닫히면 지운다
const moreAdded = ref<string | null>(null);
watch(more, (now) => !now && (moreAdded.value = null));

// 패널이 대기열을 덮고 있다(덮는 동안 대기열 스크롤바를 숨긴다: 대기열이 좌우로 8px 더 넓어 패널 밖에 막대가 보인다)
const covered = computed(() => Boolean(open.value || added.value || more.value));

// ── 패널 높이 ──

// 결과 목록의 최대 높이: 입력란 아래부터 창(시트) 바닥까지. 화면 키보드가 올라오면 그 위까지. 창 바닥에 떠 있는 재생 바(--player)는 비킨다(시트는 재생 바 위에 있다)
const root = ref<HTMLElement | null>(null);
const panelMax = ref(320);
// 시트가 움직이는 동안(translate) 잰 위치는 어긋나니 시트가 멈추면(transitionend) 다시 잰다
function measure() {
  const el = root.value;
  const body = el?.parentElement;
  if (!el || !body) return;
  const top = el.getBoundingClientRect().top + 52;
  const view = window.visualViewport;
  let bottom = Math.min(body.getBoundingClientRect().bottom, view ? view.offsetTop + view.height : window.innerHeight);
  if (!expandSheet) bottom -= parseFloat(getComputedStyle(el).getPropertyValue("--player")) || 0;
  panelMax.value = Math.max(120, Math.floor(bottom - top - 8));
}
useResizeObserver(() => root.value?.parentElement ?? null, measure);
watch(open, (now) => now && void nextTick(measure));
let moving: HTMLElement | null = null;
onMounted(() => {
  window.visualViewport?.addEventListener("resize", measure);
  window.visualViewport?.addEventListener("scroll", measure);
  moving = expandSheet ? (root.value?.closest("section") ?? null) : null;
  moving?.addEventListener("transitionend", measure);
});
onBeforeUnmount(() => {
  token++;
  clearTimeout(timer);
  inFlight?.abort();
  window.visualViewport?.removeEventListener("resize", measure);
  window.visualViewport?.removeEventListener("scroll", measure);
  moving?.removeEventListener("transitionend", measure);
});
</script>
