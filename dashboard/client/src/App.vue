<template>
  <div>
    <nav v-if="user.isLoggedIn" class="flex items-center px-4 h-14 gap-2 sticky top-0 z-100 bg-[rgba(7,11,21,0.72)] backdrop-blur-2xl backdrop-saturate-[1.8] border-b border-white/7">
      <button class="size-9 -ml-2 rounded-lg text-fg-soft cursor-pointer flex items-center justify-center transition-[background-color,color] duration-200 hover:bg-white/6 hover:text-fg" title="사이드바" @click="toggleSidebar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <router-link to="/servers" class="flex items-center font-bold text-fg no-underline tracking-[-0.01em] pr-2">🎵 MusicBot</router-link>
      <div class="flex gap-1.5 flex-1 mb-0.5">
        <router-link to="/servers" :class="navLink">서버 목록</router-link>
        <router-link v-if="user.isAdmin" to="/admin" :class="navLink">관리자</router-link>
      </div>
      <div class="flex items-center gap-2.5 text-fg-soft text-[0.85rem]">
        <img v-if="user.avatarUrl" :src="user.avatarUrl" class="size-7.5 rounded-full shadow-[0_0_0_2px_rgba(124,111,246,0.28)]" alt="avatar" />
        <span>{{ user.displayName }}</span>
        <BaseButton variant="danger" size="sm" @click="logout">로그아웃</BaseButton>
      </div>
    </nav>
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
import axios from "axios";
import { useUserStore } from "./stores/user.js";
import BaseButton from "./components/BaseButton.vue";
import ServerSidebar from "./components/ServerSidebar.vue";
import { toggleSidebar, closeDrawer } from "./composables/sidebarState.js";

const user = useUserStore();
const route = useRoute();

async function logout() {
  try {
    await axios.post("/auth/logout");
  } finally {
    window.location.assign("/");
  }
}

// 페이지 이동 시 오버레이 드로어는 닫는다 (네비바 링크 등 드로어 밖 경로 이동 포함)
watch(() => route.fullPath, closeDrawer);

// router-link-active는 [&.router-link-active]: variant로 — 복합 선택자라 기본색을 확실히 이김
const navLink = "text-muted no-underline mx-1 px-2 py-1.5 rounded-lg text-sm font-medium transition-[color,background-color] duration-200 ease-smooth hover:text-fg hover:bg-white/6 [&.router-link-active]:text-[#c4b5fd] [&.router-link-active]:bg-accent/14";
</script>
