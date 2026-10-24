<template>
  <!-- 봇 초대. 서버 목록과 같은 틀(헤더 · 카드 격자)에, 카드는 서버 관리 권한이 있고 봇이 없는 서버. 카드 아래 줄이 지금 곡 대신 초대 버튼이다 -->
  <div class="min-h-full px-(--gap-out) pt-2 md:pt-0 pb-[calc(var(--gap-out)+var(--player))]">
    <header class="flex items-center justify-between gap-4 h-12 md:h-(--strip) mb-1 md:mb-0 px-[calc((var(--r-desk)-var(--gap-out))/2)]">
      <div class="flex items-baseline gap-3 min-w-0">
        <h1 class="text-xl md:text-lg font-semibold">{{ T.title }}</h1>
        <span v-if="list?.state === 'ready'" class="text-sm text-on-surface-variant nums">{{ T.count(list.guilds.length) }}</span>
      </div>
      <button v-if="list?.state !== 'relogin'" type="button" class="tap state-layer size-10 shrink-0 rounded-full flex items-center justify-center text-on-surface-variant cursor-pointer disabled:opacity-50" v-tooltip="T.refresh" :aria-label="T.refresh" :disabled="loading" @click="load(true)">
        <Icon name="refresh" :size="22" :class="loading ? 'animate-spin' : ''" />
      </button>
    </header>

    <div v-if="!list && loading" class="grid gap-(--gap-in) grid-cols-[repeat(auto-fill,minmax(min(19rem,100%),1fr))]">
      <div v-for="n in 3" :key="n" class="h-38 rounded-(--r-window) bg-surface-container animate-pulse"></div>
    </div>

    <div v-else-if="!list" class="rounded-(--r-window) bg-surface-container flex flex-col items-center text-center gap-3 px-6 py-16">
      <p class="text-base font-semibold">{{ T.failed }}</p>
    </div>

    <div v-else-if="list.state === 'relogin'" class="rounded-(--r-window) bg-surface-container flex flex-col items-center text-center gap-3 px-6 py-16">
      <span class="size-20 rounded-[30%] bg-secondary-container text-on-secondary-container flex items-center justify-center"><Icon name="login" :size="40" /></span>
      <p class="text-xl font-round font-semibold">{{ T.relogin.title }}</p>
      <p class="text-sm text-on-surface-variant max-w-sm">{{ T.relogin.body }}</p>
      <button type="button" class="tap state-layer h-10 px-5 rounded-full bg-primary text-on-primary text-sm font-semibold cursor-pointer" @click="openLoginWindow">{{ T.relogin.action }}</button>
    </div>

    <div v-else-if="list.guilds.length === 0" class="rounded-(--r-window) bg-surface-container flex flex-col items-center text-center gap-3 px-6 py-16">
      <span class="size-20 rounded-[30%] bg-secondary-container text-on-secondary-container flex items-center justify-center"><Icon name="check_circle" :size="40" /></span>
      <p class="text-xl font-round font-semibold">{{ T.empty.title }}</p>
      <p class="text-sm text-on-surface-variant max-w-sm">{{ T.empty.body }}</p>
    </div>

    <div v-else class="grid gap-(--gap-in) grid-cols-[repeat(auto-fill,minmax(min(19rem,100%),1fr))]">
      <div v-for="g in list.guilds" :key="g.id" class="flex flex-col gap-3 rounded-(--r-window) bg-surface-container p-4 text-on-surface">
        <div class="flex items-center gap-3">
          <GuildAvatar :guild="{ name: g.name, icon: g.icon, hasPlayer: false }" :status="false" size-class="size-13" text-class="text-lg" />
          <div class="min-w-0 flex-1 text-base font-semibold truncate">{{ g.name }}</div>
        </div>
        <!-- 서버 카드의 지금 곡 줄과 같은 자리 · 높이. 누르면 새 탭에서 디스코드 승인 화면 -->
        <a :href="g.inviteUrl" target="_blank" rel="noopener noreferrer" class="tap state-layer flex items-center justify-center gap-2 h-14 rounded-(--r-inner) bg-secondary-container text-on-secondary-container no-underline text-sm font-semibold" v-tooltip="T.opensNewTab"> <Icon name="add" :size="20" :weight="600" />{{ T.invite }}<Icon name="open_in_new" :size="16" class="opacity-70" /> </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import axios from "axios";
import type { InviteList } from "../../../src/dashboard/contract/invite.ts";
import { useGuildsStore } from "../stores/guilds.ts";
import { useUserStore } from "../stores/user.ts";
import { onSignedIn, openLoginWindow } from "../composables/session.ts";
import Icon from "../components/BaseIcon.vue";
import GuildAvatar from "../components/GuildAvatar.vue";
import { text } from "../text/index.ts";
const T = text.invite;

const list = ref<InviteList | null>(null);
const loading = ref(false);

// fresh: 갱신 버튼. 서버가 잠깐 들고 있는 목록을 건너뛰고 디스코드에서 다시 받는다
async function load(fresh = false) {
  loading.value = true;
  try {
    const res = await axios.get<InviteList>("/api/invite", { params: fresh ? { fresh: 1 } : undefined });
    list.value = res.data;
  } catch {
    // 지금 목록을 둔다. 처음이면 실패 문구
  } finally {
    loading.value = false;
  }
}

// 봇이 서버에 들거나 나가면 서버 목록(실시간 신호)이 바뀐다. 그때 다시 받아 카드를 빼거나 돌려놓는다
const store = useGuildsStore();
watch(
  () => store.guilds.map((g) => g.id).join(),
  (now, before) => {
    if (before !== undefined && now !== before) void load();
  },
);

// 다시 로그인을 마치면 다시 받는다. 다른 계정이면 resumeSession 이 페이지를 새로 연다
const user = useUserStore();
let stopListening: (() => void) | null = null;

onMounted(() => {
  store.subscribe();
  void load();
  stopListening = onSignedIn(() => {
    void user.resumeSession().then((same) => {
      if (same) void load(true);
    });
  });
});
onUnmounted(() => {
  store.unsubscribe();
  stopListening?.();
});
</script>
