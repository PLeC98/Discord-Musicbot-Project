<template>
  <!-- 레이아웃 상수 세 개.
       --chrome = 위쪽 고정 높이(오버라이드 배너)
       --player = 아래쪽 고정 높이(전역 재생 바). 사이드바 하단 계정 블록(h-16)과 같은 값이라
                  둘이 한 줄로 이어져 보인다.
       --rail   = 사이드바 폭. 바가 사이드바를 덮지 않고 그 옆에서 시작하도록.
       사이드바 높이와 본문 여백이 이 값들을 빼고 계산되므로 문서가 뷰포트보다 길어지지 않는다. -->
  <div :class="[user.viewAs ? '[--chrome:1.75rem]' : '[--chrome:0px]', nowPlaying.visible ? '[--player:3.5rem] md:[--player:4rem]' : '[--player:0px]', railVars]">
    <!-- 권한 수준 오버라이드 중임을 계속 알린다 — 낮춘 계층에서 막히는 동작을 버그로 오해하지 않도록 -->
    <div v-if="user.viewAs" class="sticky top-0 z-200 flex items-center gap-2 h-7 px-3 text-[0.8rem] bg-[rgba(251,191,36,0.13)] border-b border-[rgba(251,191,36,0.28)] text-[#fcd34d]">
      <Icon name="warning" :size="14" />
      <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
        ><strong>{{ user.viewAsLabel }}</strong> 권한으로 보는 중</span
      >
      <button class="ml-auto shrink-0 px-2 py-0.5 rounded-lg font-semibold cursor-pointer bg-[rgba(251,191,36,0.16)] hover:bg-[rgba(251,191,36,0.28)] transition-[background-color] duration-200" @click="clearViewAs">해제</button>
    </div>

    <!-- 좁은 화면 전용 헤더 — md 이상은 사이드바가 로고·탐색·계정을 전부 가지므로 상단바가 없다.
         md 미만은 레일 자체가 없어서 드로어를 열 통로가 필요하다. 항목을 둘로 줄여 넘칠 여지를 없앤다. -->
    <header v-if="user.isLoggedIn" class="md:hidden flex items-center px-2 h-12 gap-1 sticky top-[var(--chrome)] z-100 bg-[rgba(7,11,21,0.72)] backdrop-blur-2xl backdrop-saturate-[1.8] border-b border-white/7">
      <button class="size-9 shrink-0 rounded-lg text-fg-soft cursor-pointer flex items-center justify-center transition-[background-color,color] duration-200 hover:bg-white/6 hover:text-fg" v-tooltip="'메뉴'" @click="toggleSidebar">
        <Icon name="menu" :size="20" />
      </button>
      <router-link to="/servers" class="flex items-center gap-1.5 font-bold text-fg no-underline tracking-[-0.01em]"><Icon name="music" :size="18" class="text-accent" />MusicBot</router-link>
    </header>

    <div class="flex items-start">
      <ServerSidebar v-if="user.isLoggedIn" />
      <main class="flex-1 min-w-0 pb-[var(--player)]">
        <!-- :key — /servers/A → /servers/B처럼 같은 컴포넌트 간 이동에서도 리마운트해 onMounted(SSE/폴링) 재초기화 -->
        <router-view :key="$route.fullPath" />
      </main>
    </div>

    <NowPlayingBar v-if="user.isLoggedIn" />
  </div>
</template>

<script setup>
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Icon from "./components/BaseIcon.vue";
import { useUserStore } from "./stores/user.js";
import ServerSidebar from "./components/ServerSidebar.vue";
import NowPlayingBar from "./components/NowPlayingBar.vue";
import { useNowPlayingStore } from "./stores/nowPlaying.js";
import { sidebarCollapsed, toggleSidebar, closeDrawer } from "./composables/sidebarState.js";

const user = useUserStore();
const nowPlaying = useNowPlayingStore();
const route = useRoute();
const router = useRouter();

// 해제에 실패하면 오류를 제대로 보여주는 운영자 패널로 넘긴다
async function clearViewAs() {
  try {
    await user.setViewAs(null);
  } catch {
    router.push("/admin");
  }
}

// 사이드바 폭 — ServerSidebar의 `collapsed ? 'w-16' : 'w-16 lg:w-60'`과 같은 규칙이어야
// 재생 바 왼쪽 끝이 레일 오른쪽 경계에 정확히 붙는다. md 미만은 레일이 없으므로 0.
const railVars = computed(() => {
  if (!user.isLoggedIn) return "[--rail:0px]";
  return sidebarCollapsed.value ? "[--rail:0px] md:[--rail:4rem]" : "[--rail:0px] md:[--rail:4rem] lg:[--rail:15rem]";
});

// 페이지 이동 시 오버레이 드로어는 닫는다 (드로어 밖 경로 이동 포함)
watch(() => route.fullPath, closeDrawer);
</script>
