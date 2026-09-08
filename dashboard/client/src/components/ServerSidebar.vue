<template>
  <!-- 인라인 레일 — md 미만 없음 / md~lg 항상 미니 / lg+ 접힘 설정에 따라 미니·펼침 (콘텐츠를 밀어냄).
       md 이상에는 상단바가 없으므로 로고·토글·계정을 전부 레일이 갖는다. -->
  <aside class="hidden md:flex shrink-0 sticky top-0 h-dvh flex-col border-r border-white/7 bg-[rgba(7,11,21,0.45)] backdrop-blur-[20px] transition-[width] duration-300 ease-smooth overflow-hidden" :class="collapsed ? 'w-16' : 'w-16 lg:w-60'">
    <div class="flex items-center h-14 shrink-0 px-2 gap-1" :class="collapsed ? 'justify-center' : 'max-lg:justify-center'">
      <button :class="iconBtn" v-tooltip="'사이드바'" @click="toggleSidebar">
        <Icon name="menu" :size="20" />
      </button>
      <router-link v-if="!collapsed" to="/servers" class="max-lg:hidden flex items-center gap-1.5 font-bold text-fg no-underline tracking-[-0.01em]"><Icon name="music" :size="18" class="text-accent" />MusicBot</router-link>
    </div>

    <div class="px-2 shrink-0">
      <router-link to="/servers" v-tooltip="'서버 목록'" :class="[itemClass(isHome), collapsed ? 'justify-center' : 'max-lg:justify-center']">
        <span class="size-9 shrink-0 flex items-center justify-center"><Icon name="list" :size="19" /></span>
        <span v-if="!collapsed" class="max-lg:hidden flex-1 text-[0.85rem] font-medium">서버 목록</span>
      </router-link>
    </div>

    <div class="mx-3 mt-2 h-px bg-white/7 shrink-0"></div>
    <div class="flex items-center h-8 px-3.5 shrink-0">
      <span v-if="!collapsed" class="max-lg:hidden text-[0.7rem] font-bold uppercase tracking-[0.09em] text-[rgba(196,181,253,0.65)] whitespace-nowrap">서버</span>
    </div>

    <nav :class="navClass">
      <router-link v-for="g in store.guilds" :key="g.id" :to="`/servers/${g.id}`" v-tooltip="g.name" :class="[itemClass(route.params.guildId === g.id), collapsed ? 'justify-center' : 'max-lg:justify-center']">
        <GuildAvatar :guild="g" />
        <span v-if="!collapsed" class="max-lg:hidden flex-1 text-[0.85rem] font-medium overflow-hidden whitespace-nowrap text-ellipsis">{{ g.name }}</span>
      </router-link>

      <div v-if="!store.loading && store.guilds.length === 0 && !collapsed" class="max-lg:hidden text-muted text-[0.8rem] px-1.5 py-2">표시할 서버가 없습니다</div>
    </nav>

    <AccountMenu rail :collapsed="collapsed" />
  </aside>

  <!-- 오버레이 드로어 — lg 미만 전용: 배경 딤 + 왼쪽에서 슬라이드 인 (콘텐츠 위에 겹침).
       상단 오프셋이 구간마다 다르다 — md 미만은 상단바(h-12) 아래, md~lg는 상단바가 없으니 화면 끝까지. -->
  <div class="lg:hidden fixed inset-x-0 top-12 md:top-0 bottom-0 z-140 bg-black/55 transition-opacity duration-300" :class="drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'" @click="closeDrawer"></div>

  <aside class="lg:hidden fixed left-0 top-12 md:top-0 bottom-0 z-150 w-60 flex flex-col bg-[rgba(7,11,21,0.92)] backdrop-blur-2xl backdrop-saturate-[1.8] border-r border-white/10 transition-transform duration-300 ease-smooth" :class="drawerOpen ? 'translate-x-0' : '-translate-x-full'">
    <div class="flex items-center h-14 shrink-0 pl-3.5 pr-2 gap-1">
      <router-link to="/servers" class="flex items-center gap-1.5 flex-1 font-bold text-fg no-underline tracking-[-0.01em]"><Icon name="music" :size="18" class="text-accent" />MusicBot</router-link>
      <button :class="iconBtn" v-tooltip="'닫기'" @click="closeDrawer"><Icon name="close" :size="19" /></button>
    </div>

    <div class="px-2 shrink-0">
      <router-link to="/servers" :class="itemClass(isHome)" @click="closeDrawer">
        <span class="size-9 shrink-0 flex items-center justify-center"><Icon name="list" :size="19" /></span>
        <span class="flex-1 text-[0.85rem] font-medium">서버 목록</span>
      </router-link>
    </div>

    <div class="mx-3 mt-2 h-px bg-white/7 shrink-0"></div>
    <div class="flex items-center h-8 px-3.5 shrink-0">
      <span class="text-[0.7rem] font-bold uppercase tracking-[0.09em] text-[rgba(196,181,253,0.65)] whitespace-nowrap">서버</span>
    </div>

    <nav :class="navClass">
      <router-link v-for="g in store.guilds" :key="g.id" :to="`/servers/${g.id}`" :class="itemClass(route.params.guildId === g.id)" @click="closeDrawer">
        <GuildAvatar :guild="g" />
        <span class="flex-1 text-[0.85rem] font-medium overflow-hidden whitespace-nowrap text-ellipsis">{{ g.name }}</span>
      </router-link>

      <div v-if="!store.loading && store.guilds.length === 0" class="text-muted text-[0.8rem] px-1.5 py-2">표시할 서버가 없습니다</div>
    </nav>

    <AccountMenu />
  </aside>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import Icon from "./BaseIcon.vue";
import GuildAvatar from "./GuildAvatar.vue";
import AccountMenu from "./AccountMenu.vue";
import { useGuildsStore } from "../stores/guilds.js";
import { sidebarCollapsed as collapsed, drawerOpen, closeDrawer, toggleSidebar } from "../composables/sidebarState.js";

const store = useGuildsStore();
const route = useRoute();

// 활성 판정은 라우트로 직접 — 설정 화면(/servers/:id/settings)은 별개 라우트 레코드라 router-link-active가 안 붙고,
// /servers는 하위 경로에도 붙어버려 서버를 보는 동안 목록까지 활성으로 보인다.
const isHome = computed(() => route.path === "/servers");

// 활성/비활성은 색상군을 통째로 교체 (같은 속성 유틸리티 충돌 회피)
function itemClass(active) {
  const base = "flex items-center gap-2.5 rounded-xl p-1.5 no-underline transition-[background-color,color] duration-200";
  return active ? `${base} bg-accent/14 text-[#c4b5fd]` : `${base} text-muted hover:bg-white/6 hover:text-fg`;
}

const iconBtn = "size-9 shrink-0 rounded-lg text-fg-soft cursor-pointer flex items-center justify-center transition-[background-color,color] duration-200 hover:bg-white/6 hover:text-fg";
const navClass = "flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3 flex flex-col gap-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-(--sb-thumb-color) [&::-webkit-scrollbar-thumb]:rounded-[3px]";

onMounted(() => store.subscribe());
onUnmounted(() => store.unsubscribe());
</script>
