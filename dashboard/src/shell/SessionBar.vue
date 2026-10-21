<template>
  <!-- 틀에 붙은 막대. 태블릿 · PC 는 왼쪽 세로, 휴대폰은 위 막대의 메뉴로 여는 사이드 드로어(drawer, 늘 펼친 모양). 가로(vertical 아님)는 지금 쓰지 않는다.
       서버 아이콘은 동그라미이고, 선택한 서버는 둥근 네모로 바뀌며 막대 가장자리에 표시가 선다(올리면 작게 튀어나온다).
       세로 막대는 맨 위(위 막대 높이)에 펼치기 버튼이 있고, 펼치면 아이콘 옆에 서버 이름이 나온다. 아이콘은 막대 폭(--bar)의 영역에 그대로 있어 펼쳐도 움직이지 않는다 -->
  <nav class="shrink-0 flex text-on-surface" :class="vertical ? ['relative flex-col pb-3 gap-3 overflow-hidden', resizing ? '' : 'transition-[width] spring', open ? '' : 'w-(--bar)'] : 'flex-row items-center h-(--bar) px-2 gap-2'" :style="vertical && !drawer && open ? { width: `${shell.sidebarWidth}px` } : undefined" :aria-label="T.serverRail">
    <!-- 펼친 막대의 오른쪽 가장자리를 끌어 폭을 바꾼다(두 번 누르면 기본 폭). 잡는 곳은 가장자리 전체,
         보이는 것은 가운데의 짧은 알약(M3 끌기 핸들). 올리면 나타나고 끄는 동안 길어진다 -->
    <span v-if="vertical && open && !drawer" class="group/resize absolute top-0 right-0 bottom-0 z-10 w-3 cursor-col-resize touch-none select-none flex items-center justify-center" role="separator" aria-orientation="vertical" :aria-label="T.sidebarWidth" @pointerdown="startResize" @dblclick="setSidebarWidth(SIDEBAR_WIDTH.initial, true)">
      <span class="w-1 rounded-full transition-[height,opacity,background-color] spring-fast" :class="resizing ? 'h-16 opacity-100 bg-primary' : 'h-10 opacity-0 bg-on-surface-variant group-hover/resize:opacity-70'"></span>
    </span>
    <!-- 펼치기 버튼은 아이콘 영역(막대 폭)에 그대로 있고, 펼치면 옆에 "사이드바 접기"가 붙는다(글도 누를 수 있다) -->
    <div v-if="vertical" class="shrink-0 h-(--topbar) -mb-2 w-full flex items-center">
      <span class="w-(--bar) shrink-0 flex justify-center">
        <button type="button" class="tap state-layer h-6 w-11 rounded-lg bg-on-surface/8 flex items-center justify-center cursor-pointer text-on-surface-variant" v-tooltip="open ? null : T.sidebarExpand" :aria-label="drawer ? T.closeMenu : open ? T.sidebarCollapse : T.sidebarExpand" :aria-expanded="open" @click="onToggle">
          <Icon :name="open ? 'left_panel_close' : 'left_panel_open'" :size="20" />
        </button>
      </span>
      <span v-if="open" class="min-w-0 flex-1 pr-3 truncate whitespace-nowrap text-xs text-on-surface-variant cursor-pointer select-none" aria-hidden="true" @click="onToggle">{{ drawer ? text.common.close : T.sidebarCollapse }}</span>
    </div>

    <router-link to="/servers" v-tooltip="vertical && !open ? T.allServers : null" :class="item" :aria-label="T.allServers">
      <span :class="pip(isHome)"></span>
      <span :class="slot">
        <!-- 봇 프로필 그림(로그인 화면과 같은 그림). 없거나 못 불러오면 기호 -->
        <span class="size-11 overflow-hidden flex items-center justify-center transition-[border-radius,background-color,color] spring-fast" :class="isHome ? 'rounded-[32%] bg-primary text-on-primary' : 'rounded-[50%] bg-surface-container-high text-on-surface group-hover:rounded-[32%]'">
          <img v-if="shell.botAvatar && !avatarBroken" :src="shell.botAvatar" alt="" class="size-full object-cover" @error="avatarBroken = true" />
          <Icon v-else name="graphic_eq" :size="24" :weight="600" />
        </span>
      </span>
      <span v-if="vertical" :class="label">{{ T.allServers }}</span>
    </router-link>

    <!-- 구분선: 양옆을 "접었을 때 선이 아이콘 영역 가운데 24 가 되는 만큼" 비우고 선은 그 안을 채운다. 펼치면 막대 폭을 따라 길어진다 -->
    <span :class="vertical ? 'w-full flex shrink-0 px-[calc((var(--bar)-1.5rem)/2)]' : 'contents'"><span class="shrink-0 rounded-full bg-outline-variant/70" :class="vertical ? 'h-0.5 w-full' : 'w-0.5 h-6'"></span></span>

    <!-- 서버가 많으면 스크롤된다. 잘리는 가장자리는 곧은 선 대신 흐리게 사라진다(더 있는 쪽만, composables/scroll-fade) -->
    <div ref="listEl" class="flex gap-2 min-w-0 min-h-0 scrollbar-none" :class="vertical ? 'flex-col flex-1 w-full overflow-y-auto py-0.5' : 'flex-row items-center flex-1 overflow-x-auto px-0.5'" :style="listFade">
      <router-link v-for="g in store.guilds" :key="g.id" :to="`/servers/${g.id}`" v-tooltip="vertical && !open ? g.name : null" :aria-label="g.name" :class="item">
        <span :class="pip(isGuild(g.id))"></span>
        <span :class="slot"><GuildAvatar :guild="g" :active="isGuild(g.id)" size-class="size-11" text-class="text-base" /></span>
        <span v-if="vertical" :class="label">{{ g.name }}</span>
      </router-link>
      <!-- 봇 초대(디스코드의 "서버 추가"처럼 목록 끝). 서버 아이콘과 같은 크기, 누르면 초대 화면. 초대할 수 있는 사람만 -->
      <router-link v-if="user.canInvite" to="/invite" v-tooltip="vertical && !open ? text.invite.title : null" :aria-label="text.invite.title" :class="item">
        <span :class="pip(isInvite)"></span>
        <span :class="slot">
          <span class="size-11 flex items-center justify-center transition-[border-radius,background-color,color] spring-fast" :class="isInvite ? 'rounded-[32%] bg-primary text-on-primary' : 'rounded-[50%] bg-surface-container-high text-primary group-hover:rounded-[32%] group-hover:bg-primary group-hover:text-on-primary'">
            <Icon name="add" :size="26" :weight="600" />
          </span>
        </span>
        <span v-if="vertical" :class="label">{{ text.invite.title }}</span>
      </router-link>
    </div>

    <!-- 시계: 마우스로 쓰는 기기(PC)만. 휴대폰 · 태블릿은 OS 의 위 막대에 늘 있다 -->
    <SidebarClock v-if="vertical && prefs.clock" class="hidden pointer-fine:block" />
    <span :class="vertical ? (open ? 'w-full shrink-0 flex px-[calc((var(--bar)-2.25rem)/2-0.375rem)]' : 'w-(--bar) flex justify-center shrink-0') : 'contents'"><AccountMenu compact :labeled="vertical && open" /></span>
  </nav>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import Icon from "../components/BaseIcon.vue";
import AccountMenu from "../components/AccountMenu.vue";
import SidebarClock from "./SidebarClock.vue";
import GuildAvatar from "../components/GuildAvatar.vue";
import { useGuildsStore } from "../stores/guilds.ts";
import { useUserStore } from "../stores/user.ts";
import { prefetchArt, prefs } from "../theme/theme.ts";
import { shell, toggleSidebar, setSidebarWidth, SIDEBAR_WIDTH } from "./shell-state.ts";
import { useScrollFade } from "../composables/scroll-fade.ts";
import { text } from "../text/index.ts";
const T = text.shell;

// drawer: 휴대폰의 사이드 드로어(늘 펼친 모양, 폭 조절 없음, 접기 버튼이 닫기)
const props = withDefaults(defineProps<{ vertical?: boolean; drawer?: boolean }>(), { vertical: false, drawer: false });
const emit = defineEmits<{ close: [] }>();
const open = computed(() => props.drawer || shell.sidebarOpen);
const onToggle = () => (props.drawer ? emit("close") : toggleSidebar());

const listEl = ref<HTMLElement | null>(null);
const listFade = useScrollFade(listEl, () => props.vertical);

const store = useGuildsStore();
const route = useRoute();

const isHome = computed(() => route.path === "/servers");
// 봇 그림을 못 불러왔으면 기호로(그림 주소가 바뀌면 다시 해 본다)
const avatarBroken = ref(false);
watch(
  () => shell.botAvatar,
  () => (avatarBroken.value = false),
);
const isGuild = (id: string) => route.params.guildId === id;
const isInvite = computed(() => route.path === "/invite");
const user = useUserStore();

// 폭 끌기. 끄는 동안은 트랜지션을 끄고 손을 바로 따라간다. 놓을 때 기억한다
const resizing = ref(false);
function startResize(e: PointerEvent) {
  const handle = e.currentTarget as HTMLElement;
  const startX = e.clientX;
  const startWidth = shell.sidebarWidth;
  handle.setPointerCapture(e.pointerId);
  resizing.value = true;
  const move = (ev: PointerEvent) => setSidebarWidth(startWidth + ev.clientX - startX);
  const end = () => {
    resizing.value = false;
    setSidebarWidth(shell.sidebarWidth, true);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

// 서버 · 모든 서버 한 항목. 세로면 [아이콘 영역(막대 폭) | 이름], 가로면 아이콘만
const item = computed(() => (props.vertical ? "group relative shrink-0 w-full flex items-center no-underline text-on-surface" : "group relative shrink-0 no-underline"));
const slot = computed(() => (props.vertical ? "w-(--bar) shrink-0 flex justify-center" : "contents"));
const label = "min-w-0 flex-1 pr-3 truncate text-sm font-medium whitespace-nowrap";

// 막대 가장자리(화면 가장자리 쪽)의 표시. 선택하면 길게, 올리면 짧게. 세로 막대는 왼쪽 끝, 가로 막대는 위 끝
function pip(active: boolean) {
  const base = "absolute rounded-full bg-on-surface transition-[height,width,opacity] spring-fast";
  if (props.vertical) return `${base} left-0 top-1/2 -translate-y-1/2 w-1 rounded-l-none ${active ? "h-8 opacity-100" : "h-2 opacity-0 group-hover:opacity-100 group-hover:h-4"}`;
  return `${base} left-1/2 -top-2.5 -translate-x-1/2 h-1 rounded-t-none ${active ? "w-6 opacity-100" : "w-2 opacity-0"}`;
}

// 서버마다 지금 곡의 그림을 미리 읽어 색을 추출해 둔다. 서버를 옮기는 순간 색이 바로 옮겨 간다(theme)
watch(
  () => store.guilds.map((g) => g.nowPlaying?.thumbnail),
  (urls) => urls.forEach(prefetchArt),
  { immediate: true },
);

onMounted(() => store.subscribe());
onUnmounted(() => store.unsubscribe());
</script>
