<template>
  <!-- 태블릿 · PC: 왼쪽 끝에 탭 레일(M3 내비게이션 레일), 오른쪽에 내용(폭을 다 쓴다).
       휴대폰: 탭을 고르지 않았으면 탭 고르는 화면(묶음별 목록), 고르면 그 페이지(위 막대에 ← · "운영자 패널 - 탭 이름").
       고른 탭은 주소 ?tab= 에 두고 옮길 때마다 방문 기록을 쌓는다(뒤로가기 = 앞의 탭, 휴대폰은 고르는 화면) -->
  <div class="md:pt-(--gap-out) md:flex md:items-start md:gap-(--gap-in)">
    <Teleport to="#topbar-start" defer>
      <button v-if="(isPhone && tab) || detailOpen" type="button" :class="TOPBAR_BTN" :aria-label="T.back" @click="goBack"><Icon name="arrow_back" /></button>
    </Teleport>

    <!-- 휴대폰: 탭 고르는 화면 -->
    <div v-if="isPhone && !tab && !loading" class="flex flex-col gap-(--gap-in)">
      <section v-for="(group, gi) in TAB_GROUPS" :key="gi" class="pane rounded-(--r-window) p-2">
        <template v-for="(t, ti) in group" :key="t.id">
          <!-- 구분선: 아이콘 칸(안쪽 여백 12 + 아이콘 40 + 틈 16)을 비우고 글자 시작부터 -->
          <div v-if="ti" class="h-px ml-17 mr-3 bg-outline-variant/60" aria-hidden="true"></div>
          <button type="button" class="tap state-layer w-full flex items-center gap-4 min-h-14 px-3 py-2 rounded-(--r-row) cursor-pointer text-left" @click="setTab(t.id)">
            <span class="relative size-10 shrink-0 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center"><Icon :name="t.icon" :size="24" /><span v-if="unsaved.has(t.id)" class="absolute top-0 right-0 size-2 rounded-full bg-warning" v-tooltip="T.unsavedTab"></span></span>
            <span class="flex-1 min-w-0 text-body font-medium text-on-surface">{{ t.label }}</span>
            <Icon name="chevron_right" :size="20" class="shrink-0 text-on-surface-variant" />
          </button>
        </template>
      </section>
    </div>
    <!-- 탭 레일. 내용이 길어도 제자리에 붙어 있다. 고른 표시(알약)는 하나를 두고 고른 칸으로 미끄러뜨린다.
         높이는 바탕화면 위아래 틈 사이 전부(재생 바 노치는 가운데에 떠 있어 레일과 겹치지 않는다).
         페이지 아래 여백에 든 재생 바 높이만큼은 음수 여백으로 돌려줘 레일 때문에 페이지가 구르지 않게 한다.
         탭이 많아 넘치면 레일 안에서 구르고 가장자리가 흐려진다 -->
    <nav v-if="!loading" class="pane hidden md:flex sticky top-(--gap-out) shrink-0 w-(--rail) flex-col overflow-hidden rounded-(--r-window) h-[calc(var(--desk-h)-var(--gap-out)*2)] -mb-(--player)" :aria-label="T.tabsLabel">
      <div ref="railEl" class="relative min-h-0 flex flex-col items-stretch gap-1 py-3 overflow-y-auto overscroll-contain scrollbar-none" :style="railFade">
        <span aria-hidden="true" class="absolute top-0 left-1/2 w-14 h-8 rounded-2xl bg-secondary-container" :class="railReady && 'transition-transform spring'" :style="{ transform: `translate(-50%, ${pillY}px)` }"></span>
        <template v-for="(group, gi) in TAB_GROUPS" :key="gi">
          <span v-if="gi > 0" aria-hidden="true" class="shrink-0 h-px mx-5 my-1 bg-outline-variant"></span>
          <button v-for="t in group" :key="t.id" :ref="(el) => railItem(t.id, el)" type="button" class="group relative shrink-0 flex flex-col items-center gap-1 py-1 cursor-pointer" :aria-current="tab === t.id ? 'page' : undefined" @click="setTab(t.id)">
            <span data-ind class="relative w-14 h-8 rounded-2xl flex items-center justify-center transition-colors duration-150" :class="tab === t.id ? 'text-on-secondary-container' : 'text-on-surface-variant group-hover:bg-on-surface/8'">
              <Icon :name="t.icon" :size="24" :fill="tab === t.id" />
              <span v-if="unsaved.has(t.id)" class="absolute top-1 right-3 size-1.5 rounded-full bg-warning" v-tooltip="T.unsavedTab"></span>
            </span>
            <span class="px-1 text-2xs leading-4 text-center" :class="tab === t.id ? 'font-semibold text-on-surface' : 'font-medium text-on-surface-variant'">{{ t.label }}</span>
          </button>
        </template>
      </div>
    </nav>

    <!-- 탭을 옮겨 새 페이지가 미끄러져 들어오는 동안만 세로로 잘라 둔다. 아래로 삐져나간 몫이 바탕화면 스크롤 높이를 늘려 스크롤바가 잠깐 생겼다 사라지며 화면이 덜컥이지 않게(clip 은 스크롤 칸을 만들지 않는다).
         늘 자르면 포커스 링 테두리까지 잘려서 움직이는 동안만. 재생 바 밑으로 내려간 창 끝(실시간 로그 · 봇 정보)은 잘리지 않게 자르는 상자를 재생 바 높이만큼 아래로 넓힌다 -->
    <!-- 휴대폰의 탭 고르는 화면 동안에도 지우지 않고 숨긴다(저장하지 않은 편집 · 로그 · 스크롤을 지킨다) -->
    <div v-show="tab" class="@container/content flex-1 min-w-0" :class="sliding && 'overflow-y-clip pb-(--player) -mb-(--player)'" :data-dir="pageDir">
      <div v-if="loading" class="flex items-center justify-center p-20"><Icon name="progress_activity" :size="40" class="animate-spin text-primary" /></div>

      <template v-else>
        <!-- 탭. 카드가 늘어나 한 화면에 다 두면 찾기 어렵다.
           v-if가 아니라 v-show인 이유: 로그 뷰어의 누적 로그와 스크롤 위치가 탭을 오갈 때 날아가면 안 된다.

           바깥이 스크롤러, 안쪽 줄이 경계선을 갖는다. 경계선을 스크롤러에 두면 가로 스크롤바가
           그 안쪽(선 위)에 그려진다. overflow-y를 명시하지 않으면 visible이 auto로 바뀌어,
           버튼의 -mb-px 1px 때문에 모든 해상도에서 세로 스크롤바가 상시로 생긴다. -->
        <div class="admin-page" v-show="tab === 'status'">
          <BotStatus v-if="status" :status="status" :updated-at="statusAt" :stale="statusStale" @open-logs="setTab('logs')" @open-db="setTab('db')" />
        </div>

        <div class="admin-page" v-show="tab === 'info'">
          <BotInfo v-if="status" :status="status" />
        </div>

        <div class="admin-page" v-show="tab === 'logs'">
          <LiveLogs :logs="logs" :connected="sseConnected" :server-level="status?.logLevel" :active="tab === 'logs'" @clear="logs = []" />
        </div>

        <div class="admin-page" v-show="tab === 'guilds'">
          <ServerManage :guilds="guilds" @changed="onGuildsChanged" />
        </div>

        <!-- DB 브라우저: 신규 기능이라 2차 17단계에서 검토해 만든다(지금은 자리만, 저장 공간 카드의 "DB 브라우저" 버튼이 여기로 온다) -->
        <div class="admin-page" v-show="tab === 'db'">
          <section class="pane rounded-(--r-window) p-(--pad-window) flex flex-col items-center justify-center gap-3 min-h-60 text-center text-on-surface-variant">
            <Icon name="database" :size="40" />
            <p class="text-sm">{{ T.dbNotYet }}</p>
          </section>
        </div>

        <div class="admin-page" v-show="tab === 'autoplay'">
          <!-- settings.db 의 "genres" 문서. 저장 번호가 낡았으면 저장을 거절한다 -->
          <ConfigGenres v-if="opened.has('autoplay')" />
        </div>

        <div class="admin-page" v-show="tab === 'presence'">
          <!-- settings.db 의 "status" 문서 -->
          <ConfigPresence v-if="opened.has('presence')" />
        </div>

        <div class="admin-page" v-show="tab === 'appearance'">
          <!-- 올린 그림은 봇이 사람이 건드리지 않는 저장 자리에 둔다(파일로 넣는 길은 없다) -->
          <ConfigAppearance v-if="opened.has('appearance')" />
        </div>

        <div class="admin-page" v-show="tab === 'ai'">
          <!-- settings.db 의 "ai" · "ai-prompt" 문서. API 키는 비밀 표에 있고 여기로 내려오지 않는다 -->
          <ConfigAI v-if="opened.has('ai')" />
        </div>

        <!-- 자리가 정해지지 않은 설정을 모아 두는 탭. 메뉴를 다시 짤 때 나눈다. 값은 쓰기 전용이라 여기로 내려오지 않는다 -->
        <div class="admin-page" v-show="tab === 'settings'">
          <ConfigTunables v-if="opened.has('settings')" :can-restart="status?.env.launcher ?? false" class="mb-(--gap-in)" />
          <ConfigServiceKeys v-if="opened.has('settings')" />
          <!-- 유튜브 쿠키는 쿠키를 파일로 읽을 때만 쓸모가 있다. 판정 근거는 상태 응답에 이미 실려 온다 -->
          <ConfigCookies v-if="opened.has('settings') && status?.youtube?.cookies === 'file'" class="mt-(--gap-in)" />
        </div>

        <div class="admin-page" v-show="tab === 'dev'">
          <DevOptions v-if="opened.has('dev')" />
        </div>
      </template>
    </div>

    <!-- 봇 다시 시작 창. 봇 상태 탭 단추 · 설정 탭 저장 막대가 함께 쓴다 -->
    <BotRestartDialog />
    <ConfirmDialog :model-value="leaveOpen" icon="edit_off" :title="T.leaveConfirm.title" :body="T.leaveConfirm.body" :confirm-label="T.leaveConfirm.confirm" @update:model-value="(v) => !v && answerLeave(false)" @confirm="answerLeave(true)" />
  </div>
</template>

<script setup lang="ts">
import { session, live } from "../composables/session.ts";
import { notifyProblem } from "../composables/toasts.ts";
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { eventLink } from "../utils/event-link.ts";
import { unsaved } from "../composables/unsaved.ts";
import { useScrollFade } from "../composables/scroll-fade.ts";
import { readStored, writeStored } from "../utils/storage.ts";
import { useMediaQuery } from "@vueuse/core";
import { shell } from "../shell/shell-state.ts";
import { TOPBAR_BTN } from "../utils/topbar.ts";
import { PHONE_QUERY } from "../utils/breakpoints.ts";
import { singlePane } from "../composables/list-detail.ts";
import { goUp, pushDown } from "../utils/up-nav.ts";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import axios from "axios";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import Icon from "../components/BaseIcon.vue";
import ConfigGenres from "../components/ConfigGenres.vue";
import BotStatus from "../components/BotStatus.vue";
import BotInfo from "../components/BotInfo.vue";
import ServerManage from "../components/ServerManage.vue";
import LiveLogs from "../components/LiveLogs.vue";
import ConfigPresence from "../components/ConfigPresence.vue";
import ConfigAI from "../components/ConfigAI.vue";
import ConfigCookies from "../components/ConfigCookies.vue";
import ConfigServiceKeys from "../components/ConfigServiceKeys.vue";
import ConfigTunables from "../components/ConfigTunables.vue";
import BotRestartDialog from "../components/BotRestartDialog.vue";
import ConfigAppearance from "../components/ConfigAppearance.vue";
import DevOptions from "../components/DevOptions.vue";
import { KEPT_LINES, type WireEntry } from "../../../src/infra/log/levels.ts";
import type { AdminGuilds, AdminStatus } from "../../../src/dashboard/contract/admin.ts";
import type { IconName } from "../icons.ts";
import { text } from "../text/index.ts";
const T = text.admin;

/** 탭 하나 */
/** group: 레일에서 선으로(휴대폰 탭 고르는 화면은 창으로) 나누는 묶음. 묶음 이름은 쓰지 않는다 */
type Tab = { id: string; label: string; icon: IconName; group: "status" | "watch" | "outside" | "autoplay" | "dev" };

// ── 탭 ────────────────────────────────────────────────────────────────────────
// 선택은 새로고침을 넘겨 유지한다. 권한 수준을 바꾸면 페이지가 다시 로드되는데 그때마다
// 첫 탭으로 튕기면 쓰기 나쁘다.
const ALL_TABS: Tab[] = [
  { id: "status", label: T.tabs.status, icon: "smart_toy", group: "status" },
  { id: "guilds", label: T.tabs.guilds, icon: "public", group: "watch" },
  { id: "db", label: T.tabs.db, icon: "database", group: "watch" },
  { id: "logs", label: T.tabs.logs, icon: "queue_music", group: "watch" },
  // 자리가 정해지지 않은 설정(서비스 키 · 유튜브 쿠키)을 모아 둔다
  { id: "settings", label: T.tabs.settings, icon: "settings", group: "outside" },
  // id를 "status"로 못 쓴다. 맨 위 "봇 상태" 탭이 이미 쓰고 있다
  { id: "presence", label: T.tabs.presence, icon: "headphones", group: "outside" },
  { id: "appearance", label: T.tabs.appearance, icon: "palette", group: "outside" },
  { id: "autoplay", label: T.tabs.autoplay, icon: "music_note", group: "autoplay" },
  { id: "ai", label: T.tabs.ai, icon: "campaign", group: "autoplay" },
  { id: "info", label: T.tabs.info, icon: "info", group: "dev" },
  { id: "dev", label: T.tabs.dev, icon: "build", group: "dev" },
];
const TAB_KEY = "admin:tab";
const savedTab = readStored(TAB_KEY);
// 목록 · 상세 편집기의 탭은 고른 줄을 주소에 둔다(composables/list-detail). 주소에 그 표식이 있으면 그 탭으로 연다
const TAB_PARAM: Record<string, string> = { autoplay: "genre", presence: "presence", ai: "ai" };
const route = useRoute();
const router = useRouter();
// 휴대폰(md 아래)은 탭을 안 골랐으면 탭 고르는 화면
const isPhone = useMediaQuery(PHONE_QUERY);
// 주소의 탭(?tab=). 없으면 편집기 표식(?genre= 등)으로, 그것도 없으면 휴대폰은 고르는 화면 · 태블릿 · PC 는 지난번 탭
const tab = computed<string | null>(() => {
  const q = route.query.tab;
  if (typeof q === "string" && ALL_TABS.some((t) => t.id === q)) return q;
  const byParam = Object.keys(TAB_PARAM).find((id) => route.query[TAB_PARAM[id]]);
  if (byParam) return byParam;
  if (isPhone.value) return null;
  return savedTab && ALL_TABS.some((t) => t.id === savedTab) ? savedTab : "status";
});
// 설정 편집기는 처음 연 때 만들고 그 뒤로는 숨기기만 한다. 탭을 옮겨도 저장하지 않은 편집이 남는다
const opened = ref(new Set(tab.value ? [tab.value] : []));
// 휴대폰 위 막대 제목 뒤에 지금 탭
watch(
  tab,
  (id) => {
    if (id && !opened.value.has(id)) opened.value = new Set(opened.value).add(id);
    if (id) writeStored(TAB_KEY, id);
    shell.subtitle = ALL_TABS.find((t) => t.id === id)?.label ?? "";
  },
  { immediate: true },
);
onUnmounted(() => (shell.subtitle = ""));

// 탭을 옮기면 내용이 레일 차례 방향으로 미끄러져 들어온다(아래 탭이면 아래에서 위로). 숨겨 둔 탭이 다시 보일 때 애니메이션이 새로 돈다
const pageDir = ref<"down" | "up">("down");
// 미끄러지는 동안(page-in 460ms, style.css). 처음 열 때도 한 번 돈다
const sliding = ref(true);
let slideTimer = window.setTimeout(() => (sliding.value = false), 520);
function slide() {
  sliding.value = true;
  clearTimeout(slideTimer);
  slideTimer = window.setTimeout(() => (sliding.value = false), 520);
}

// 탭을 옮기면 방문 기록을 한 칸 쌓는다. 떠나는 탭의 표식(?genre= 등)은 걷는다(남기면 뒤로가기가 다른 탭에서 그 편집을 되살린다)
function setTab(id: string) {
  // 지금 탭을 다시 누르면 그 탭에 처음 온 것처럼(상세를 닫고 목록 · 첫 화면으로)
  if (id === tab.value) return closeDetail();
  const query = Object.fromEntries(Object.entries(route.query).filter(([k]) => !Object.values(TAB_PARAM).includes(k) || k === TAB_PARAM[id]));
  void pushDown(router, route, { query: { ...query, tab: id } });
}
// 위 막대 ← (화면 안에 따로 "목록으로"를 두지 않는다): 늘 상위로(utils/up-nav). 상세 표식(?genre= 등)이 있으면 그것을 걷어 목록으로,
// 없으면 탭을 걷어 고르는 화면으로. 상위가 바로 앞 기록이면 기록을 무르고(기기 뒤로와 같다), 아니면 바꿔치기(화면 크기가 바뀌어 한 단 ↔ 두 단이 뒤집혀도 늘 상위로).
// 누른 뒤 화면이 바뀔 때까지 다시 누른 것은 무시한다(두 칸 건너뜀 막기)
let backing = false;
watch(
  () => route.fullPath,
  () => (backing = false),
);
function goBack() {
  if (backing) return;
  backing = true;
  // 화면이 안 바뀌는 경우(되돌릴 기록이 없는 등)에도 다시 누를 수 있게
  window.setTimeout(() => (backing = false), 1000);
  if (detailParam.value && route.query[detailParam.value]) return closeDetail();
  const drop = ["tab", ...Object.values(TAB_PARAM)];
  void goUp(router, { query: Object.fromEntries(Object.entries(route.query).filter(([k]) => !drop.includes(k))) });
}
// 지금 탭의 상세 표식(?genre= 등)
const detailParam = computed(() => (tab.value ? TAB_PARAM[tab.value] : undefined));
// 한 단으로 상세를 보고 있는지(태블릿에서도 위 막대 ← 를 띄운다, composables/list-detail 의 singlePane)
const detailOpen = computed(() => Boolean(detailParam.value && route.query[detailParam.value] && singlePane[detailParam.value]));
// 상세를 닫고 목록(첫 화면)으로: 늘 상위로(목록에서 연 상세면 기록을 무르고, 아니면 표식만 걷는다)
function closeDetail() {
  const param = detailParam.value;
  if (!param || !route.query[param]) return;
  void goUp(router, { query: Object.fromEntries(Object.entries(route.query).filter(([k]) => k !== param)) });
}
// 탭이 바뀌면(누르기 · 뒤로가기) 레일 차례 방향으로 미끄러져 들어온다
watch(tab, (now, before) => {
  if (!now || !before || now === before) return;
  const list = ALL_TABS.map((t) => t.id);
  pageDir.value = list.indexOf(now) < list.indexOf(before) ? "up" : "down";
  slide();
});

// 저장하지 않은 설정이 있으면 페이지를 떠날 때 묻는다. 다른 화면으로는 우리 확인 대화상자로, 창 닫기 · 새로고침은 브라우저가 묻는다(beforeunload)
const leaveOpen = ref(false);
let leaveAnswer: ((go: boolean) => void) | null = null;
onBeforeRouteLeave(() => {
  if (!unsaved.size) return;
  leaveOpen.value = true;
  return new Promise<boolean>((resolve) => (leaveAnswer = resolve));
});
/** 확인 대화상자의 답(떠나기 · 취소 · 바깥 누르기) */
function answerLeave(go: boolean) {
  leaveOpen.value = false;
  leaveAnswer?.(go);
  leaveAnswer = null;
}
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!unsaved.size) return;
  e.preventDefault();
  e.returnValue = "";
}

// ── 봇 상태 ───────────────────────────────────────────────

const loading = ref(true);
// 봇 상태. 받기 전에는 없다. statusAt: 마지막으로 받은 때, statusStale: 마지막 요청이 실패했다(아래 값은 statusAt 의 것)
const status = ref<AdminStatus | null>(null);
const statusAt = ref<number | null>(null);
const statusStale = ref(false);

const TAB_GROUPS = (["status", "watch", "outside", "autoplay", "dev"] as const).map((g) => ALL_TABS.filter((t) => t.group === g)).filter((g) => g.length > 0);

// 레일의 고른 표시. 고른 칸 아이콘 자리(data-ind)의 높이로 옮긴다. 처음 자리를 잡기 전에는 미끄러지지 않게 railReady 로 막는다
const railEl = ref<HTMLElement | null>(null);
const railItems = new Map<string, HTMLElement>();
const pillY = ref(0);
const railReady = ref(false);
function railItem(id: string, el: unknown) {
  if (el instanceof HTMLElement) railItems.set(id, el);
  else railItems.delete(id);
}
function placePill() {
  const item = tab.value ? railItems.get(tab.value) : undefined;
  const ind = item?.querySelector<HTMLElement>("[data-ind]");
  if (!item || !ind) return;
  pillY.value = item.offsetTop + ind.offsetTop;
  if (!railReady.value) requestAnimationFrame(() => (railReady.value = true));
  // 레일이 굴러 고른 칸이 가려져 있으면 보이게 한다(바탕화면은 건드리지 않게 레일만 굴린다)
  const rail = railEl.value;
  if (rail) {
    const top = item.offsetTop - 12;
    const bottom = item.offsetTop + item.offsetHeight + 12;
    if (top < rail.scrollTop) rail.scrollTo({ top, behavior: "smooth" });
    else if (bottom > rail.scrollTop + rail.clientHeight) rail.scrollTo({ top: bottom - rail.clientHeight, behavior: "smooth" });
  }
}
const railFade = useScrollFade(railEl, () => true);
watch([tab, railEl], () => void nextTick(placePill), { flush: "post" });

async function fetchStatus() {
  try {
    const res = await axios.get<AdminStatus>("/api/admin/status");
    status.value = res.data;
    statusAt.value = Date.now();
    statusStale.value = false;
    loading.value = false;
  } catch (e) {
    statusStale.value = true;
    // 3초마다 묻는다. 같은 까닭이면 알림 하나가 남아 있다
    notifyProblem(e, T.failed.status);
    loading.value = false;
  }
}

// ── 서버 관리 ─────────────────────────────────────────
type AdminGuild = AdminGuilds["guilds"][number];
const guilds = ref<AdminGuild[]>([]);

async function fetchGuilds() {
  try {
    const res = await axios.get<AdminGuilds>("/api/admin/guilds");
    guilds.value = res.data.guilds;
  } catch (e) {
    notifyProblem(e, T.failed.guilds);
  }
}

// 서버에서 나갔으면 목록과 봇 상태(서버 수 · 플레이어)를 다시 읽는다
function onGuildsChanged() {
  void Promise.all([fetchGuilds(), fetchStatus()]);
}

// ── 로그 보기 ──────────────────────────────────────────────
const logs = ref<WireEntry[]>([]);
const sseConnected = ref(false);
// 마지막으로 받은 줄의 SSE id("기동표.번호"). 다시 열 때 그 뒤부터 받는다
let lastLogEventId = "";
let lastLogId = 0;
// 붙을 때 쌓인 줄(KEPT_LINES)이 줄마다 따로 온다. 줄마다 목록을 다시 그리면 그만큼 그려 브라우저가 멎는다.
// 한 프레임 동안 모았다가 한 번에 넣는다
let pendingLogs: WireEntry[] = [];
let flushFrame: number | null = null;
function queueLog(entry: WireEntry) {
  pendingLogs.push(entry);
  flushFrame ??= requestAnimationFrame(flushLogs);
}
function flushLogs() {
  flushFrame = null;
  const next = logs.value.concat(pendingLogs);
  pendingLogs = [];
  logs.value = next.length > KEPT_LINES ? next.slice(-KEPT_LINES) : next;
}

watch(tab, () => {
  poll(); // 새 탭이 최대 한 주기 동안 옛 값을 보여주지 않도록
  syncLogs();
});

// 로그 연결은 로그 탭이 보일 때만 연다. 닫았다 다시 열면 마지막으로 받은 줄 뒤부터 받는다(서버가 500줄까지 들고 있다)
const wantLogs = () => tab.value === "logs" && live();
// 끊기면 브라우저가 마지막 id 를 실어 다시 붙고, 닫히면(200 이 아닌 답) 늘려 가는 간격으로 다시 연다(utils/event-link)
const logLink = eventLink({
  url: () => `/api/admin/logs/stream?after=${encodeURIComponent(lastLogEventId)}`,
  open: (url) => new EventSource(url, { withCredentials: true }),
  check: async () => (await axios.get("/api/me")).status === 200,
  onState: (state) => (sseConnected.value = state === "open"),
  events: {
    // 봇을 다시 켜 줄 번호가 처음부터다. 지금 목록은 옛 실행의 것이라 비운다
    reset: () => {
      logs.value = [];
      pendingLogs = [];
      lastLogId = 0;
    },
    message: (e) => {
      const entry = JSON.parse(String(e.data)) as WireEntry;
      lastLogEventId = e.lastEventId || lastLogEventId;
      if (entry.id <= lastLogId) return; // 이미 받은 줄
      lastLogId = entry.id;
      queueLog(entry);
    },
  },
});
function syncLogs() {
  if (wantLogs()) logLink.start();
  else closeLogs();
}
function closeLogs() {
  logLink.stop();
  sseConnected.value = false;
}

// ── 수명 ────────────────────────────────────────────────
// status는 실시간 값(uptime·메모리·자식 프로세스)이라 대응 SSE가 없어 폴링이 유일한 갱신 수단.
// 디스코드 rate limit과 무관하고(우리 Express만 친다) 보는 사람이 운영자 한 명이라 주기를
// 좁혀도 부담이 없다. 자식 프로세스가 뜨고 지는 걸 보려면 10초는 너무 성기다.
//
// 대신 낭비를 두 곳에서 막는다: 탭이 숨으면(아무도 안 보면) 멈추고, 보이는 탭이 쓰지 않는
// 데이터는 아예 받지 않는다. 로그 탭은 SSE가 밀어주므로 폴링할 것이 없다.
const POLL_MS = 3000;
let timer: ReturnType<typeof setInterval> | null = null;
let visHandler: (() => void) | null = null;
function poll() {
  if (tab.value === "status" || tab.value === "info") void fetchStatus();
  else if (tab.value === "guilds") void fetchGuilds();
}
function startPoll() {
  if (!timer) timer = setInterval(poll, POLL_MS);
}
function stopPoll() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
let stopSessionWatch: (() => void) | null = null;
onMounted(() => {
  // 첫 진입만은 탭과 무관하게 둘 다 받는다. 화면 전체의 loading 해제가 fetchStatus에 달려 있다.
  void fetchStatus();
  void fetchGuilds();
  // 탭이 숨거나 세션이 끝나면 폴링 · 로그 연결을 접는다
  const onVisibility = () => {
    if (!live()) stopPoll();
    else {
      poll();
      startPoll();
    }
    syncLogs();
  };
  visHandler = onVisibility;
  document.addEventListener("visibilitychange", onVisibility);
  stopSessionWatch = watch(() => session.ended, onVisibility);
  window.addEventListener("beforeunload", onBeforeUnload);
  if (live()) startPoll();
  syncLogs();
});
onUnmounted(() => {
  window.removeEventListener("beforeunload", onBeforeUnload);
  if (visHandler) {
    document.removeEventListener("visibilitychange", visHandler);
    visHandler = null;
  }
  stopSessionWatch?.();
  stopPoll();
  closeLogs();
});
</script>
