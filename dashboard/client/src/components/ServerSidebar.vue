<template>
  <!-- 인라인 레일 — md 미만 없음 / md~lg 항상 미니 / lg+ 접힘 설정에 따라 미니·펼침 (콘텐츠를 밀어냄) -->
  <aside class="hidden md:flex shrink-0 sticky top-14 h-[calc(100dvh-3.5rem)] flex-col border-r border-white/7 bg-[rgba(7,11,21,0.45)] backdrop-blur-[20px] transition-[width] duration-300 ease-smooth overflow-hidden" :class="collapsed ? 'w-16' : 'w-16 lg:w-60'">
    <div v-if="!collapsed" class="max-lg:hidden flex items-center h-10 px-3.5 shrink-0">
      <span class="text-[0.7rem] font-bold uppercase tracking-[0.09em] text-[rgba(196,181,253,0.65)] whitespace-nowrap">서버</span>
    </div>
    <div class="shrink-0" :class="collapsed ? 'h-3' : 'h-3 lg:hidden'"></div>

    <nav class="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3 flex flex-col gap-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-(--sb-thumb-color) [&::-webkit-scrollbar-thumb]:rounded-[3px]">
      <router-link v-for="g in store.guilds" :key="g.id" :to="`/servers/${g.id}`" v-tooltip="g.name" :class="[linkClass(g.id), collapsed ? 'justify-center' : 'max-lg:justify-center']">
        <span class="relative shrink-0">
          <img v-if="g.icon" :src="g.icon" :alt="g.name" class="size-9 rounded-full border border-white/10 block" />
          <span v-else class="size-9 rounded-full border border-white/10 bg-linear-135 from-accent to-accent-2 text-sm font-bold text-white flex items-center justify-center">{{ g.name[0] }}</span>
          <span v-if="g.hasPlayer" class="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full bg-success border-2 border-[#070b15]" v-tooltip="'재생 중'"></span>
        </span>
        <span v-if="!collapsed" class="max-lg:hidden flex-1 text-[0.85rem] font-medium overflow-hidden whitespace-nowrap text-ellipsis">{{ g.name }}</span>
      </router-link>

      <div v-if="!store.loading && store.guilds.length === 0 && !collapsed" class="max-lg:hidden text-muted text-[0.8rem] px-1.5 py-2">표시할 서버가 없습니다</div>
    </nav>
  </aside>

  <!-- 오버레이 드로어 — lg 미만 전용: 배경 딤 + 왼쪽에서 슬라이드 인 (콘텐츠 위에 겹침) -->
  <div class="lg:hidden fixed inset-x-0 top-14 bottom-0 z-140 bg-black/55 transition-opacity duration-300" :class="drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'" @click="closeDrawer"></div>

  <aside class="lg:hidden fixed left-0 top-14 bottom-0 z-150 w-60 flex flex-col bg-[rgba(7,11,21,0.92)] backdrop-blur-2xl backdrop-saturate-[1.8] border-r border-white/10 transition-transform duration-300 ease-smooth" :class="drawerOpen ? 'translate-x-0' : '-translate-x-full'">
    <div class="flex items-center h-10 px-3.5 shrink-0">
      <span class="text-[0.7rem] font-bold uppercase tracking-[0.09em] text-[rgba(196,181,253,0.65)] whitespace-nowrap">서버</span>
    </div>

    <nav class="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3 flex flex-col gap-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-(--sb-thumb-color) [&::-webkit-scrollbar-thumb]:rounded-[3px]">
      <router-link v-for="g in store.guilds" :key="g.id" :to="`/servers/${g.id}`" :class="linkClass(g.id)" @click="closeDrawer">
        <span class="relative shrink-0">
          <img v-if="g.icon" :src="g.icon" :alt="g.name" class="size-9 rounded-full border border-white/10 block" />
          <span v-else class="size-9 rounded-full border border-white/10 bg-linear-135 from-accent to-accent-2 text-sm font-bold text-white flex items-center justify-center">{{ g.name[0] }}</span>
          <span v-if="g.hasPlayer" class="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full bg-success border-2 border-[#070b15]" v-tooltip="'재생 중'"></span>
        </span>
        <span class="flex-1 text-[0.85rem] font-medium overflow-hidden whitespace-nowrap text-ellipsis">{{ g.name }}</span>
      </router-link>

      <div v-if="!store.loading && store.guilds.length === 0" class="text-muted text-[0.8rem] px-1.5 py-2">표시할 서버가 없습니다</div>
    </nav>
  </aside>
</template>

<script setup>
import { onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { useGuildsStore } from "../stores/guilds.js";
import { sidebarCollapsed as collapsed, drawerOpen, closeDrawer } from "../composables/sidebarState.js";

// 토글 버튼은 네비바(App.vue)의 햄버거 — 화면 폭에 따라 인라인 접힘/드로어를 알아서 구분 (sidebarState 참조)
const store = useGuildsStore();
const route = useRoute();

// 활성 판정은 라우트 파라미터로 — 설정 화면(/servers/:id/settings)은 별개 라우트 레코드라 router-link-active가 안 붙음.
// 활성/비활성은 색상군을 통째로 교체 (같은 속성 유틸리티 충돌 회피)
function linkClass(id) {
  const base = "flex items-center gap-2.5 rounded-xl p-1.5 no-underline transition-[background-color,color] duration-200";
  return route.params.guildId === id ? `${base} bg-accent/14 text-[#c4b5fd]` : `${base} text-muted hover:bg-white/6 hover:text-fg`;
}

onMounted(() => store.subscribe());
onUnmounted(() => store.unsubscribe());
</script>
