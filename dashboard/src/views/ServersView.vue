<template>
  <!-- 모든 서버. 서버마다 같은 크기의 카드: 아이콘 · 이름 · 상태, 그 아래 지금 곡 한 줄. 내가 듣는 서버는 맨 앞에 두고 테두리로 구분한다 -->
  <div class="min-h-full px-(--gap-out) pt-2 md:pt-0 pb-[calc(var(--gap-out)+var(--player))]">
    <!-- 바탕화면 둥근 모서리 쪽으로 글을 조금 안쪽으로 민다(위 · 옆 막대의 곡선과 맞춘다. 휴대폰도 위 모서리가 둥글어 같다) -->
    <header class="flex items-center justify-between gap-4 h-12 md:h-(--strip) mb-1 md:mb-0 px-[calc((var(--r-desk)-var(--gap-out))/2)]">
      <div class="flex items-baseline gap-3 min-w-0">
        <h1 class="text-xl md:text-lg font-semibold">{{ T.title }}</h1>
        <span class="text-sm text-on-surface-variant nums">{{ T.count(guilds.length) }}</span>
      </div>
      <span class="hidden @2xl/desk:block text-sm text-on-surface-variant truncate">{{ greeting }}</span>
    </header>

    <div v-if="loading" class="grid gap-(--gap-in) grid-cols-[repeat(auto-fill,minmax(min(19rem,100%),1fr))]">
      <div v-for="n in 3" :key="n" class="h-38 rounded-(--r-window) bg-surface-container animate-pulse"></div>
    </div>

    <div v-else-if="guilds.length === 0" class="rounded-(--r-window) bg-surface-container flex flex-col items-center text-center gap-3 px-6 py-16">
      <span class="size-20 rounded-[30%] bg-secondary-container text-on-secondary-container flex items-center justify-center"><Icon name="music_off" :size="40" /></span>
      <p class="text-xl font-round font-semibold">{{ T.empty.title }}</p>
      <p class="text-sm text-on-surface-variant max-w-sm">{{ T.empty.body }}</p>
    </div>

    <div v-else class="grid gap-(--gap-in) grid-cols-[repeat(auto-fill,minmax(min(19rem,100%),1fr))]">
      <router-link v-for="g in ordered" :key="g.id" :to="`/servers/${g.id}`" class="group state-layer flex flex-col gap-3 rounded-(--r-window) bg-surface-container p-4 no-underline text-on-surface transition-[border-radius] spring hover:rounded-xl" :class="g.listening ? 'ring-2 ring-primary/70' : ''">
        <div class="flex items-center gap-3">
          <GuildAvatar :guild="g" size-class="size-13" text-class="text-lg" />
          <div class="min-w-0 flex-1">
            <div class="text-base font-semibold truncate">{{ g.name }}</div>
            <div class="text-xs text-on-surface-variant nums">{{ T.members(g.memberCount) }}</div>
          </div>
          <!-- 칩은 나와의 관계("듣는 중")만. 서버 상태는 아이콘의 상태 점과 아래 줄이 말한다 -->
          <span v-if="g.listening" class="h-6 px-3 rounded-full bg-primary text-on-primary text-xs font-semibold inline-flex items-center gap-1 shrink-0"><Icon name="headphones" :size="14" fill />{{ T.listening }}</span>
        </div>
        <!-- 지금 곡. 없으면 같은 높이로 비워 둔다(카드 높이를 맞춘다) -->
        <div class="flex items-center gap-3 h-14 rounded-(--r-inner) bg-surface-container-high px-2">
          <template v-if="g.nowPlaying">
            <TrackArt :track="g.nowPlaying" size-class="size-10 rounded-sm" :icon-size="20" />
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate">{{ songTitle(g.nowPlaying.title) }}</div>
              <div class="text-xs text-on-surface-variant truncate">{{ g.nowPlaying.artist }}</div>
            </div>
            <!-- 재생 중이면 재생(▶), 일시정지면 일시정지. 누구나 아는 기호라 툴팁은 두지 않는다(▶ 는 눌러 그 서버로 간다는 느낌도 준다) -->
            <Icon :name="g.state === 'paused' ? 'pause' : 'play_arrow'" :size="20" fill class="shrink-0 mr-1" :class="g.state === 'paused' ? 'text-on-surface-variant' : 'text-primary'" />
          </template>
          <span v-else class="flex items-center gap-1 pl-2 text-xs text-on-surface-variant"><Icon :name="g.hasPlayer ? 'headphones' : 'bedtime'" :size="14" />{{ g.hasPlayer ? T.waitingInVoiceLong : T.resting }}</span>
        </div>
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useGuildsStore } from "../stores/guilds.ts";
import { useUserStore } from "../stores/user.ts";
import Icon from "../components/BaseIcon.vue";
import GuildAvatar from "../components/GuildAvatar.vue";
import TrackArt from "../components/TrackArt.vue";
import { songTitle } from "../../../src/ui/text/ko/labels.ts";
import { text } from "../text/index.ts";
const T = text.servers;

// 목록 데이터·SSE·폴링은 막대와 공유하는 guilds 스토어가 담당 (구독 카운팅으로 연결 단일화)
const store = useGuildsStore();
const user = useUserStore();
const guilds = computed(() => store.guilds);
const loading = computed(() => store.loading);
// 내가 듣는 서버를 맨 앞에
const ordered = computed(() => [...store.guilds].sort((a, b) => Number(b.listening) - Number(a.listening)));

const greeting = computed(() => {
  return T.greeting(new Date().getHours(), user.displayName);
});

onMounted(() => store.subscribe());
onUnmounted(() => store.unsubscribe());
</script>
