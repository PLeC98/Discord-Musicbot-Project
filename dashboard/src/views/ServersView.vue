<template>
  <div class="max-w-275 mx-auto px-3 py-4.5">
    <h1 class="pl-2 text-[1.7rem] font-extrabold mb-1.5 tracking-tight bg-linear-135 from-[#e8eaf6] via-[#c4b5fd] via-55% to-[#a78bfa] bg-clip-text text-transparent">서버 목록</h1>
    <p class="pl-2 text-muted mb-4.5 text-[0.9rem]">재생 상태와 재생 목록을 관리할 서버를 선택하고, Discord와 실시간 동기화하세요.</p>

    <div v-if="loading" class="flex items-center justify-center p-20 text-muted">불러오는 중...</div>

    <div v-else-if="guilds.length === 0" class="text-center px-5 py-15 text-muted">
      <Icon name="music" :size="48" class="mb-3 text-muted" />
      <p class="mb-1.5">사용자가 참가한 서버 중에 봇이 함께 있는 서버가 없습니다.</p>
      <p class="mb-1.5 text-[0.85rem] text-muted">봇을 서버에 초대하거나, 봇이 있는 서버에 참여하세요.</p>
    </div>

    <div v-else class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
      <router-link
        v-for="g in guilds"
        :key="g.id"
        :to="`/servers/${g.id}`"
        class="group flex items-center gap-4 rounded-2xl py-2.5 px-4.5 no-underline text-fg bg-[rgba(12,16,36,0.62)] backdrop-blur-[20px] backdrop-saturate-[1.5] border border-white/8 shadow-[0_2px_14px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.05)] transition-[border-color,transform,box-shadow] duration-300 ease-spring hover:border-accent/45 hover:scale-[1.01] hover:shadow-[0_12px_36px_rgba(0,0,0,0.45),0_0_0_1px_rgba(124,111,246,0.18),inset_0_1px_0_rgba(255,255,255,0.07)]"
      >
        <div class="shrink-0">
          <img v-if="g.icon" :src="g.icon" :alt="g.name" class="size-12.5 rounded-full border-2 border-white/10" />
          <div v-else class="size-12.5 rounded-full border-2 border-white/10 bg-linear-135 from-accent to-accent-2 text-[1.2rem] font-bold flex items-center justify-center">{{ g.name[0] }}</div>
        </div>
        <div class="flex-1 overflow-hidden">
          <div class="text-sm font-semibold mb-0.5 overflow-hidden whitespace-nowrap text-ellipsis">{{ g.name }}</div>
          <div class="text-[0.78rem] mb-0.5 flex items-center gap-1" :class="g.hasPlayer ? 'text-success' : 'text-muted'">
            <Icon :name="g.hasPlayer ? 'music' : 'pause'" :size="13" />
            <span>{{ g.hasPlayer ? "재생 중" : "대기 중" }}</span>
          </div>
        </div>
        <span class="mb-0.5 text-muted text-[1.2rem] transition-[transform,color] duration-300 ease-spring group-hover:translate-x-1 group-hover:text-[rgba(196,181,253,0.8)]">›</span>
      </router-link>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from "vue";
import { useGuildsStore } from "../stores/guilds.js";
import Icon from "../components/BaseIcon.vue";

// 목록 데이터·SSE·폴링은 사이드바와 공유하는 guilds 스토어가 담당 (구독 카운팅으로 연결 단일화)
const store = useGuildsStore();
const guilds = computed(() => store.guilds);
const loading = computed(() => store.loading);

onMounted(() => store.subscribe());
onUnmounted(() => store.unsubscribe());
</script>
