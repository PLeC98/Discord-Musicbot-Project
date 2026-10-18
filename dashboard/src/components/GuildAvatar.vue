<template>
  <!-- 서버 아이콘. 선택한 서버는 동그라미에서 둥근 네모로 모양이 바뀐다(Hyprland 작업 공간 알약처럼). 봇이 음성 채널에 있으면 오른쪽 아래에 상태 표시.
       재생 중의 막대는 그림(18×16, 2배 해상도)을 마스크(mask)로 써 색은 상태 색을 따른다. 요소로 그리면 1.5px 간격이 화면 배율에 따라 들쭉날쭉해진다.
       재생 중 움직이는 그림(14 프레임/초)은 제 프레임이 바뀔 때만 다시 그린다(CSS 애니메이션은 매 프레임). 같은 그림은 모든 아이콘이 한 시계로 돈다 -->
  <span class="relative shrink-0 inline-flex" :class="sizeClass">
    <img v-if="guild.icon" :src="guild.icon" :alt="guild.name" class="size-full object-cover transition-[border-radius] spring" :class="active ? 'rounded-[32%]' : 'rounded-[50%]'" />
    <span v-else class="size-full flex items-center justify-center font-round font-semibold transition-[border-radius,background-color,color] spring" :class="[active ? 'rounded-[32%] bg-primary text-on-primary' : 'rounded-[50%] bg-secondary-container text-on-secondary-container', textClass]">{{ guild.name[0] }}</span>
    <!-- 바탕은 상태 색: 곡이 걸려 있으면(재생 중 · 일시정지) 초록, 음성 채널에 있지만 곡이 없으면 노랑.
         막대는 재생 중에만. 일시정지 · 대기 중은 기호로(멈춘 막대는 움직임 줄이기의 재생 중과 같아진다) -->
    <span v-if="status && guild.hasPlayer" v-tooltip="playing ? T.playing : paused ? T.paused : T.waitingInVoice" class="absolute -right-1 -bottom-1 size-4 rounded-full ring-2 ring-surface flex items-center justify-center" :class="playing || paused ? 'bg-(--status-play) text-(--on-status-play)' : 'bg-(--status-wait) text-(--on-status-wait)'">
      <template v-if="playing">
        <i class="block w-2.25 h-2 bg-current motion-reduce:hidden" :style="mask(eqBars)"></i>
        <!-- 움직임 줄이기: 멈춘 재생 막대 -->
        <i class="hidden motion-reduce:block w-2.25 h-2 bg-current" :style="mask(eqStill)"></i>
      </template>
      <Icon v-else :name="paused ? 'pause' : 'schedule'" :size="12" fill :weight="600" />
    </span>
  </span>
</template>

<script setup lang="ts">
import type { GuildRow } from "../../../src/dashboard/contract/guilds.ts";

import { computed } from "vue";
import Icon from "./BaseIcon.vue";
import eqBars from "../assets/eq-bars.webp";
import eqStill from "../assets/eq-still.webp";
import { text } from "../text/index.ts";
const T = text.servers;

const props = withDefaults(defineProps<{ guild: Pick<GuildRow, "name" | "icon" | "hasPlayer"> & Partial<Pick<GuildRow, "state">>; active?: boolean; status?: boolean; sizeClass?: string; textClass?: string }>(), {
  active: false,
  status: true,
  sizeClass: "size-10",
  textClass: "text-body",
});

const playing = computed(() => props.guild.state === "playing");
const paused = computed(() => props.guild.state === "paused");
const mask = (url: string) => ({ maskImage: `url(${url})`, maskSize: "100% 100%" });
</script>
