<template>
  <!-- 로그인 전(잠금 화면)은 세션 틀 없이. 틀 없이 여는 화면(meta.bare)도 -->
  <router-view v-if="!user.isLoggedIn || route.meta.bare" />

  <!-- 막대가 있는 쪽에만 틀(frame)이 있다(PC · 태블릿은 왼쪽 세로 막대 + 위 막대, 휴대폰은 위 막대만. 세로 막대는 위 막대의 메뉴 단추로 여는 서랍).
       바탕화면(desk)은 나머지 가장자리에 붙고 막대 쪽 모서리만 둥글다(휴대폰은 위 둘, 태블릿 · PC 는 왼쪽 위 · 오른쪽 위 · 왼쪽 아래). 바탕화면만 굴러가고 틀 · 막대 · 재생 바는 제자리.
       배경화면은 화면 전체(틀 밑까지)에 깔고, 틀은 바탕화면 바깥을 덮는 반투명한 막이다(바탕화면의 그림자를 넓게 펴서 둥근 모서리를 따른다).
       --player = 떠 있는 재생 바가 차지하는 높이(화면 아래 여백) -->
  <!-- 휴대폰은 세로 굴리기 · 확대만 브라우저에 맡긴다(가로로 쓸면 서랍이 받는다, composables/drawer-swipe) -->
  <div v-else class="relative h-dvh flex flex-col overflow-hidden [touch-action:pan-y_pinch-zoom] md:touch-auto">
    <AppWallpaper />
    <!-- 권한 수준 오버라이드 중임을 계속 알린다. 틀 맨 위(위 막대 · 세로 막대 위, 폭 전체)에 tertiary 로 칠한 줄을 얹는다. 놓치지 않게 틀과 다른 색으로 눈에 띄게 -->
    <div v-if="user.viewAs" role="status" class="relative z-10 shrink-0 h-7 px-4 flex items-center justify-center gap-1.5 text-xs bg-tertiary text-on-tertiary">
      <Icon name="visibility" :size="16" class="shrink-0" />
      <span class="min-w-0 truncate"
        ><strong class="font-semibold">{{ user.viewAsLabel }}</strong> {{ T.viewingAs }}</span
      >
      <button type="button" class="tap state-layer shrink-0 h-5 px-2.5 rounded-full text-xs font-semibold bg-on-tertiary/16 cursor-pointer" @click="clearViewAs">{{ T.clearViewAs }}</button>
    </div>

    <div class="relative flex-1 min-h-0 flex flex-col md:flex-row">
      <SessionBar vertical class="relative z-10 hidden md:flex" />
      <!-- 휴대폰: 세로 막대를 서랍으로(모달 서랍, 지메일처럼 화면 일부를 덮는다). 위 막대의 메뉴 단추 · 오른쪽으로 쓸기로 열고, 바깥 · Esc · 왼쪽으로 쓸기 · 화면을 옮기면 닫힌다(composables/drawer-swipe).
           모양은 화면 끝에 붙어 위아래를 꽉 채우는 면이라 각지게. 움직임은 M3E: 들어올 때 공간 스프링(살짝 넘쳤다 돌아온다. 넘친 만큼 왼쪽이 비지 않게 같은 색 그림자를 왼쪽에 깐다),
           나갈 때 가속(emphasized accelerate) 짧게. 뒤 막은 효과 스프링으로 넘치지 않게. 끄는 동안은 손가락을 따라오고 움직임을 끈다.
           휴대폰에서는 늘 붙여 두고 화면 밖으로 밀어 둔다(닫힌 동안은 inert). 서랍 부품 자체의 폭 움직임과 섞이지 않게 바깥 상자가 움직인다 -->
      <template v-if="isPhone">
        <div class="fixed inset-0 z-250 bg-black/40" :class="[drawerDrag === null && (drawerOpen ? 'transition-opacity duration-300 ease-effects' : 'transition-opacity duration-200 ease-in'), drawerShown === 0 && 'pointer-events-none']" :style="{ opacity: drawerShown }" @click="drawerOpen = false"></div>
        <div
          ref="drawerEl"
          class="fixed inset-y-0 left-0 z-260 w-72 max-w-[85vw] bg-surface-container-low [touch-action:pan-y_pinch-zoom] **:[touch-action:pan-y_pinch-zoom]"
          :class="[drawerDrag === null && (drawerOpen ? 'transition-[translate] duration-500 ease-spring' : 'transition-[translate] duration-200 ease-[cubic-bezier(0.3,0,0.8,0.15)]'), drawerShown > 0 && 'shadow-[-2rem_0_0_0_var(--md-surface-container-low),0_8px_24px_rgb(0_0_0/0.25)]']"
          :style="{ translate: `${(drawerShown - 1) * 100}% 0` }"
          :inert="!drawerOpen && drawerDrag === null"
        >
          <SessionBar vertical drawer class="h-full" @close="drawerOpen = false" />
        </div>
      </template>

      <div class="flex-1 min-h-0 min-w-0 flex flex-col">
        <!-- 위 막대. 틀의 위쪽 가장자리(휴대폰 48 · 태블릿 · PC 36). 가운데에 보고 있는 서버(서버 화면 · 서버 설정), 모든 서버 화면이면 "서버 목록", 운영자 패널이면 그 이름 -->
        <header class="relative z-10 flex shrink-0 h-(--topbar) items-center justify-center px-4 text-on-surface" :aria-label="T.topBar">
          <div v-if="viewedGuild" class="flex items-center gap-2 min-w-0 max-w-[48%] md:max-w-[60%]">
            <GuildAvatar :guild="viewedGuild" active :status="false" size-class="size-6" text-class="text-2xs" />
            <span class="text-sm font-semibold truncate"
              >{{ viewedGuild.name }}<span v-if="route.path.endsWith('/settings')" class="ml-1 text-on-surface-variant font-medium">{{ T.serverSettingsSuffix }}</span></span
            >
          </div>
          <span v-else-if="route.path === '/servers'" class="text-sm font-semibold">{{ T.serverList }}</span>
          <span v-else-if="route.meta.title" class="text-sm font-semibold">{{ route.meta.title }}</span>
          <div v-else-if="route.path === '/admin'" class="flex items-center gap-2 min-w-0 max-w-[48%] md:max-w-none">
            <span class="size-6 rounded-[30%] bg-tertiary-container text-on-tertiary-container flex items-center justify-center"><Icon name="admin_panel_settings" :size="16" fill /></span>
            <span class="text-sm font-semibold truncate"
              >{{ T.adminPanel }}<span v-if="shell.subtitle" class="md:hidden ml-1 text-on-surface-variant font-medium">- {{ shell.subtitle }}</span></span
            >
          </div>
          <!-- 왼쪽 끝 · 오른쪽 끝: 화면이 넣는 자리(서버 설정의 뒤로가기, 서버 화면의 음성 상태 · 설정). 휴대폰은 왼쪽 맨 앞에 서랍 메뉴, 오른쪽 맨 끝은 늘 알림함 -->
          <div class="absolute left-1 inset-y-0 flex items-center gap-1 max-w-[26%] md:max-w-[35%]">
            <button type="button" :class="TOPBAR_BTN" class="md:hidden" :aria-label="T.openMenu" :aria-expanded="drawerOpen" @click="drawerOpen = true"><Icon name="menu" :size="24" /></button>
            <div id="topbar-start" class="flex items-center gap-1 min-w-0"></div>
          </div>
          <div class="absolute right-3 inset-y-0 flex items-center gap-3 max-w-[26%] md:max-w-[35%]">
            <div id="topbar-end" class="flex items-center gap-3 min-w-0"></div>
            <NotificationInbox />
          </div>
        </header>
        <!-- --desk-h: 바탕화면 높이(px). 제자리에 붙는 칸(운영자 레일)이 재생 바 위까지의 높이를 셈한다 -->
        <div ref="deskEl" :style="{ '--desk-h': `${deskHeight}px` }" class="relative flex-1 min-h-0 overflow-hidden rounded-tl-(--r-desk) rounded-tr-(--r-desk) md:rounded-bl-(--r-desk) shadow-[0_0_0_100vmax_var(--frame-color)]" :class="np.visible ? '[--player:3.5rem] md:[--player:4.5rem]' : '[--player:0px]'">
          <!-- 스크롤바 길은 위를 바탕화면 둥근 모서리가 막대에 닿는 만큼 비운다(--sb-inset-desk. WebKit 계열만). 재생 바 노치는 양옆을 띄워 스크롤바에 닿지 않는다 -->
          <div class="@container/desk absolute inset-0 overflow-y-auto overscroll-contain [touch-action:pan-y_pinch-zoom] md:touch-auto [&::-webkit-scrollbar-track]:mt-(--sb-inset-desk)">
            <router-view v-slot="{ Component, route: r }">
              <component :is="Component" v-if="r.meta.workspace" :key="r.fullPath" />
              <!-- 그 밖의 화면(서버 설정 · 운영자)은 바탕화면 위에 카드를 놓는다. 쿼리(운영자 패널의 ?genre= 등)만 바뀌면 새로 그리지 않게 경로로 붙잡는다 -->
              <div v-else :key="r.path" class="px-(--gap-out) pt-(--gap-out) md:pt-0 pb-[calc(var(--gap-out)+var(--player))]">
                <component :is="Component" />
              </div>
            </router-view>
          </div>
          <NowPlayingDock />
          <!-- 세션 끝 · 연결 안 됨 띠와 알림. 라우터 화면 밖이라 페이지를 옮겨도 남는다. 바탕화면 안 오른쪽 위에 둔다(위 막대 · 알림함 단추를 덮지 않게).
               밀어 치우거나 사라질 때 오른쪽으로 빠지는 것은 바탕화면 끝에서 잘린다 -->
          <div class="absolute right-(--gap-out) top-(--gap-out) z-300 flex flex-col gap-2 w-[min(26rem,calc(100%-2*var(--gap-out)))] pointer-events-none">
            <SessionNotice />
            <ToastStack />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { onKeyStroke, useMediaQuery, useResizeObserver } from "@vueuse/core";
import { useDrawerSwipe } from "./composables/drawer-swipe.ts";
import { PHONE_QUERY } from "./utils/breakpoints.ts";
import { useRoute, useRouter } from "vue-router";
import axios from "axios";
import Icon from "./components/BaseIcon.vue";
import SessionNotice from "./components/SessionNotice.vue";
import ToastStack from "./components/ToastStack.vue";
import AppWallpaper from "./components/AppWallpaper.vue";
import NowPlayingDock from "./shell/NowPlayingDock.vue";
import NotificationInbox from "./shell/NotificationInbox.vue";
import { useNowPlayingStore } from "./stores/now-playing.ts";
import SessionBar from "./shell/SessionBar.vue";
import { shell } from "./shell/shell-state.ts";
import { TOPBAR_BTN } from "./utils/topbar.ts";
import GuildAvatar from "./components/GuildAvatar.vue";
import { useGuildsStore } from "./stores/guilds.ts";
import { useUserStore } from "./stores/user.ts";
import { setReportUrl } from "./utils/problem.ts";
import { setDocsRepo } from "./composables/docs.ts";
import { setBrandColor } from "./theme/theme.ts";
import type { BotInfo } from "../../src/dashboard/contract/identity.ts";
import { text } from "./text/index.ts";
const T = text.shell;

const user = useUserStore();
const np = useNowPlayingStore();
const deskEl = ref<HTMLElement | null>(null);
const deskHeight = ref(0);
useResizeObserver(deskEl, ([entry]) => (deskHeight.value = shell.deskHeight = entry.contentRect.height));
const router = useRouter();
const route = useRoute();
// 휴대폰의 세로 막대 서랍. 화면을 옮기면(서버를 고르면) 닫는다
const drawerOpen = ref(false);
const drawerEl = ref<HTMLElement | null>(null);
const isPhone = useMediaQuery(PHONE_QUERY);
const { drag: drawerDrag } = useDrawerSwipe(drawerOpen, drawerEl, () => isPhone.value);
// 서랍이 열린 정도(끄는 동안은 손가락, 아니면 열림 · 닫힘)
const drawerShown = computed(() => drawerDrag.value ?? (drawerOpen.value ? 1 : 0));
watch(isPhone, (phone) => !phone && (drawerOpen.value = false));
watch(
  () => route.fullPath,
  () => (drawerOpen.value = false),
);
onKeyStroke("Escape", () => (drawerOpen.value = false));
const guilds = useGuildsStore();

// 위 막대 가운데에 띄울, 지금 보고 있는 서버
const viewedGuild = computed(() => {
  const id = route.params.guildId;
  return typeof id === "string" ? (guilds.guilds.find((g) => g.id === id) ?? null) : null;
});

// 해제에 실패하면 오류를 제대로 보여주는 운영자 패널로 넘긴다
async function clearViewAs() {
  try {
    await user.setViewAs(null);
  } catch {
    await router.push("/admin");
  }
}

// 오류 문장의 "봇 개발자에게 보고" 가 가리킬 곳(소스 저장소). 못 받으면 링크 없이 글만 보인다
onMounted(() => {
  axios
    .get<BotInfo>("/api/bot", { quietSession: true })
    .then((res) => {
      setReportUrl(res.data.sourceRepo);
      // 화면에서 저장소 설명서(docs/)로 가는 링크도 같은 저장소로
      setDocsRepo(res.data.sourceRepo);
      // 곡이 없을 때의 화면 색은 운영자가 정한 임베드 색에서(theme)
      setBrandColor(res.data.brandColor);
      shell.botAvatar = res.data.avatarUrl;
    })
    .catch(() => {
      /* 못 받으면 보고할 곳 없이 글만 보인다 */
    });
});
</script>
