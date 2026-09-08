<template>
  <div>
    <!-- 좁은 화면 전용 헤더 — md 이상은 사이드바가 로고·탐색·계정을 전부 가지므로 상단바가 없다.
         md 미만은 레일 자체가 없어서 드로어를 열 통로가 필요하다. 항목을 둘로 줄여 넘칠 여지를 없앤다. -->
    <header v-if="user.isLoggedIn" class="md:hidden flex items-center px-2 h-12 gap-1 sticky top-0 z-100 bg-[rgba(7,11,21,0.72)] backdrop-blur-2xl backdrop-saturate-[1.8] border-b border-white/7">
      <button class="size-9 shrink-0 rounded-lg text-fg-soft cursor-pointer flex items-center justify-center transition-[background-color,color] duration-200 hover:bg-white/6 hover:text-fg" v-tooltip="'메뉴'" @click="toggleSidebar">
        <Icon name="menu" :size="20" />
      </button>
      <router-link to="/servers" class="flex items-center gap-1.5 font-bold text-fg no-underline tracking-[-0.01em]"><Icon name="music" :size="18" class="text-accent" />MusicBot</router-link>
    </header>

    <div class="flex items-start">
      <ServerSidebar v-if="user.isLoggedIn" />
      <main class="flex-1 min-w-0">
        <!-- :key — /servers/A → /servers/B처럼 같은 컴포넌트 간 이동에서도 리마운트해 onMounted(SSE/폴링) 재초기화 -->
        <router-view :key="$route.fullPath" />
      </main>
    </div>
  </div>
</template>

<script setup>
import { watch } from "vue";
import { useRoute } from "vue-router";
import Icon from "./components/BaseIcon.vue";
import { useUserStore } from "./stores/user.js";
import ServerSidebar from "./components/ServerSidebar.vue";
import { toggleSidebar, closeDrawer } from "./composables/sidebarState.js";

const user = useUserStore();
const route = useRoute();

// 페이지 이동 시 오버레이 드로어는 닫는다 (드로어 밖 경로 이동 포함)
watch(() => route.fullPath, closeDrawer);
</script>
